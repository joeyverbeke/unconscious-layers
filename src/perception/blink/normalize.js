// Whose eyes count as open.
//
// MediaPipe's eyeBlink score is not a measure of how shut an eye is. It is how
// far that eye has departed from the model's canonical open eye — and the
// canonical open eye belongs to a particular face. A monolid, an epicanthic
// fold, deep-set eyes, a head tilted back so the lids ride low, someone simply
// tired: all of them read as partly closed while looking straight at you.
// Resting scores of 0.2-0.4 are ordinary in real use.
//
// Thresholding that raw score at an absolute 0.5, which is what every piece here
// used to do, therefore asks a different question of every face. For a face the
// model considers canonical it asks "are your eyes shut?". For a face resting at
// 0.4 it asks "have your eyes moved a sixth of the way shut?" — and once a
// resting level climbs past the *opening* threshold the question stops being
// answerable at all: the detector latches closed and never releases, because by
// its lights the eyes never open.
//
// The fix is to stop reading the score as an absolute and start reading it as a
// position between two levels measured on the person in front of the camera:
//
//   rest    where this eye sits when it is open. A low percentile of the last
//           ~10s of scores. Blinks are brief and high, so the bottom tenth of a
//           ten-second window is open eye, whatever the face.
//   shut    where this eye gets to when it closes. The median of the closure
//           peaks actually observed. Median rather than max: one bad frame, or
//           one occluded eye during a head turn, must not define "shut".
//
//   closure = (raw - rest) / (shut - rest)
//
// so 0 is this person's open and 1 is this person's shut, and a threshold means
// the same thing on every face. The estimate is per eye, because the two are not
// symmetric on most people and are very asymmetric on some.
//
// Two properties worth stating, because they are what make this safe to put
// underneath every piece:
//
//   It starts as the identity. Until there is a rest window it uses rest = 0,
//   and until it has seen blinks it uses the canonical shut of 1 — which is
//   exactly (raw - 0) / 1. A face that the model already considers canonical
//   then stays within a few hundredths of the identity forever, because that is
//   what its measurements come out as.
//
//   It cannot run away. rest is capped, the span has a floor, so the gain has a
//   ceiling. A squinter whose eyes never fully shut gets a bounded correction
//   rather than an amplifier.
//
// Deliberately free of imports so it runs unchanged in the browser and under
// node, where scripts/discovery-sim.js drives it.

export const NORMALIZE_DEFAULTS = {
  windowMs: 10000,      // how much history the resting level is read from
  sampleMs: 50,         // decimated: 60fps of history is no better and costs more
  recomputeMs: 250,     // the levels move slowly; no need to sort every frame
  restPercentile: 0.1,  // bottom tenth of the window is open eye
  restSmoothing: 0.3,   // ease onto a new reading rather than stepping to it
  maxRest: 0.65,        // past here it is not a resting eye, it is a held closure
  minSpan: 0.35,        // floor on shut - rest, so the gain cannot exceed ~2.9
  minRestSamples: 40,   // 2s before the resting level is believed at all
  minPeaks: 3,          // and three closures before the shut level is
  peakWindow: 24,       // rolling; the person can change how they are sitting
  // The canonical shut, counted as this many observed closures' worth of prior
  // evidence. A median over the handful of blinks a visit actually contains
  // wanders by a few percent every time a new one lands, and because the level
  // is a *scale*, every wander rescales everything measured against it — which
  // reads downstream as the person's blinks quietly changing shape. Shrinking
  // toward the canonical steadies it, and it is the right direction to be wrong
  // in: it errs toward the identity, which is where the old behaviour lives.
  shutPrior: 6,
  peakEnter: 0.55,      // fractions of the current span, not absolute scores,
  peakExit: 0.3,        // so peak-finding works on a face that never reads 1.0
  canonicalShut: 1,     // what the model thinks a shut eye scores
  // Closure is allowed past 1 on purpose. Shut is a *median* of peaks, so a
  // fuller-than-usual closure genuinely is more than shut, and the discovery
  // detector reads exactly that difference to tell a deliberate blink from an
  // ordinary one. Clamping at 1 would flatten the signal it works from.
  ceiling: 1.4,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// One eye. The two are tracked separately and never averaged: a face can rest
// lopsided, and reading one eye's level onto the other is how a wink becomes a
// blink again.
function createEye(config) {
  let samples;      // { at, value }, decimated
  let peaks;        // closure peaks, rolling
  let rest;
  let shut;
  let restReady;
  let shutReady;
  let lastSampleAt;
  let lastRecomputeAt;
  let inPeak;
  let peakValue;

  function reset() {
    samples = [];
    peaks = [];
    rest = 0;
    shut = config.canonicalShut;
    restReady = false;
    shutReady = false;
    lastSampleAt = null;
    lastRecomputeAt = null;
    inPeak = false;
    peakValue = 0;
  }
  reset();

  // Never narrower than the floor, so a person whose eyes barely move still gets
  // a bounded correction instead of a divide-by-nearly-nothing.
  const span = () => Math.max(config.minSpan, shut - rest);

  function recompute() {
    if (samples.length >= config.minRestSamples) {
      const sorted = samples.map((sample) => sample.value).sort((a, b) => a - b);
      const index = clamp(
        Math.floor(config.restPercentile * (sorted.length - 1)),
        0,
        sorted.length - 1
      );
      const target = clamp(sorted[index], 0, config.maxRest);
      rest = restReady ? rest + config.restSmoothing * (target - rest) : target;
      restReady = true;
    }
    if (peaks.length >= config.minPeaks) {
      const measured = median(peaks);
      const n = peaks.length;
      shut = (config.shutPrior * config.canonicalShut + n * measured) / (config.shutPrior + n);
      shutReady = true;
    }
    // The floor is applied to the estimate itself, not just to the division, so
    // the peak-finding thresholds below move with it too.
    if (shut < rest + config.minSpan) shut = rest + config.minSpan;
  }

  return {
    reset,
    // `update` is false when there is no face: the score is meaningless then and
    // a stretch of nobody-there would otherwise teach the resting level a zero.
    map(raw, at, update = true) {
      if (update) {
        if (lastSampleAt === null || at - lastSampleAt >= config.sampleMs) {
          lastSampleAt = at;
          samples.push({ at, value: raw });
          while (samples.length && at - samples[0].at > config.windowMs) samples.shift();
        }
        if (lastRecomputeAt === null || at - lastRecomputeAt >= config.recomputeMs) {
          lastRecomputeAt = at;
          recompute();
        }

        // Closures, for the shut level. Measured in fractions of the current
        // span rather than at fixed scores, which is the whole point: on a face
        // resting at 0.4 a fixed 0.55 is barely a movement.
        const width = span();
        if (!inPeak && raw >= rest + config.peakEnter * width) {
          inPeak = true;
          peakValue = raw;
        } else if (inPeak) {
          peakValue = Math.max(peakValue, raw);
          if (raw <= rest + config.peakExit * width) {
            inPeak = false;
            peaks.push(peakValue);
            if (peaks.length > config.peakWindow) peaks.shift();
          }
        }
      }
      return clamp((raw - rest) / span(), 0, config.ceiling);
    },
    levels: () => ({
      rest,
      shut,
      span: span(),
      ready: restReady && shutReady,
      restReady,
      shutReady,
      peaks: peaks.length,
    }),
  };
}

export function createEyeNormalizer(overrides = {}) {
  const config = { ...NORMALIZE_DEFAULTS, ...overrides };
  const left = createEye(config);
  const right = createEye(config);

  return {
    config,
    // Always safe to call, whether or not the caller intends to use the result:
    // keeping the estimate warm while normalisation is switched off is what lets
    // it be switched back on mid-blink without a settling period.
    map({ left: rawLeft = 0, right: rawRight = 0, at, hasFace = true }) {
      return {
        left: left.map(rawLeft, at, hasFace),
        right: right.map(rawRight, at, hasFace),
      };
    },
    levels: () => ({ left: left.levels(), right: right.levels() }),
    reset() {
      left.reset();
      right.reset();
    },
  };
}
