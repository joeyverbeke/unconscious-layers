// Working out that someone has worked it out.
//
// Somebody standing in front of one of these pieces goes through a fairly
// reliable arc: they blink, something changes, they are not sure it changed,
// and then they start experimenting on the machine to find out. The point of
// this module is to notice the experimenting.
//
// Four behaviours, watched separately, because any one of them alone is thin
// evidence and people arrive at the discovery by different routes:
//
//   rapid    sustained rapid blinking — a run of short gaps, one after another.
//            The most likely behaviour, and now the only practical way left to
//            test the piece, so it is the primary signal and needs nothing else
//            to corroborate it.
//   shape    blinks that stop looking like that person's ordinary ones: longer,
//            or shutting more completely. Corroboration, not a requirement.
//   hold     eyes kept shut well past a blink. Usually someone holding it open
//            for a friend to look at.
//   wink     one eye shut, the other watching. Both-eyes detection means this no
//            longer produces a reveal, but it is still someone probing.
//   squint   a slow partial closure, held. The old way to cheat the threshold.
//
// The gates in the page suppress most of these from producing a reveal. That is
// the point: the detector reads the raw eye signal underneath, so the behaviour
// still counts as evidence even though it no longer earns a picture. The thing
// being denied is the reward, not the observation.
//
// ---------------------------------------------------------------------------
// Telling deliberate blinking from ordinary blinking
//
// Spontaneous and voluntary blinking differ in four measurable ways: interval
// regularity, rate against that person's own baseline, duration, and how
// completely the lid travels. An earlier version of this file leaned on the last
// two — the literature is clear that voluntary blinks are longer and fuller — and
// required them before any amount of rapid blinking counted for anything.
//
// That was wrong in practice, and wrong in a way worth recording. Whether the
// difference exists in a person is not the question; the question is whether it
// survives into MediaPipe's eyeBlink score, and on a real face watching a real
// trace it frequently does not. Blinking deliberately at a screen does not
// reliably look different from blinking at it — it just happens more often. The
// simulation had agreed only because it was built on the same assumption it was
// being used to check.
//
// So the two are separated, and only one of them is load-bearing:
//
//   rapid   counts consecutive gaps under a ceiling. Nothing about shape. This is
//           the signal, and it can reach certainty on its own.
//   shape   watches for blinks that stop resembling that person's own, and needs
//           several in a row before it says anything, so one long blink is not
//           evidence of anything. It corroborates; it never gates.
//
// The ceiling and the run lengths are measured rather than guessed. Across 20,000
// simulated two-minute visits, a run of four consecutive gaps under 900ms never
// occurs at 6–18 blinks per minute. It does occur for the genuinely fast blinker —
// about 19% of visits at 32/min — so the ladder shifts up by one whole step for
// anyone whose own baseline is already short. Someone who naturally blinks twice a
// second has to do more before it means anything, which is only fair.
// ---------------------------------------------------------------------------
//
// ---------------------------------------------------------------------------
// Whose eyes count as open
//
// eyeBlink is not a measure of how shut an eye is. It is a measure of how far
// the eye departs from the model's canonical open eye, and that canonical eye is
// somebody in particular. A monolid or an epicanthic fold reads as partly closed
// at rest; so does tilting the head back, which changes the aperture the camera
// sees without the lid moving at all. Both were reported from real use: a viewer
// lying back, and an East Asian viewer, each judged to be squinting while doing
// nothing of the kind.
//
// An absolute band cannot be made fair by moving it. A resting score of 0.3 sits
// inside any band that catches a real squint, and it sits there with no slope,
// which is exactly the signature being looked for. Lowering the threshold only
// changes whose face is misread.
//
// So openness is calibrated per person, per eye, the same way blink rate already
// is. Their resting level is the low percentile of the last few seconds — where
// their eye sits when nothing is happening — and their shut level is the median
// peak of blinks actually observed. Everything downstream works on
//
//     closure = (raw - rest) / (shut - rest)
//
// which is 0 when their eyes are open, whatever number that is for them, and 1
// when their eyes are as shut as they get. For a face the model was built around
// this is very nearly the identity; for one it was not, it is the whole fix.
//
// Until both ends of that scale are known, the channels that depend on level —
// squint and hold — say nothing at all. It is better to notice nothing about
// somebody than to decide they are cheating because of the shape of their eyes.
// ---------------------------------------------------------------------------
//
// Evidence accumulates and decays rather than latching on one observation, and
// the channels combine as a noisy-OR: each behaviour is an independent argument
// that the person has worked it out, and the score is the chance that at least
// one of those arguments holds. No single channel's weight reaches 1, so one
// behaviour on its own can raise strong suspicion but two are needed for
// certainty — which is the intended bar for "confidently".

import { createEyeNormalizer } from './normalize.js';

export const DEFAULTS = {
  // Closure detection, run independently of the page's reveal logic so the
  // gates cannot hide behaviour from the detector.
  closeEnter: 0.5,
  closeExit: 0.35,

  blinkMaxMs: 600,      // longer than this is not a blink, it is a hold
  holdMinMs: 700,
  holdFullMs: 2000,     // a hold this long is as much evidence as a hold can be

  // A wink: one lid down, the other clearly not, and held long enough that it is
  // not just the two eyes closing slightly out of step, which they always do.
  winkHigh: 0.55,
  winkGap: 0.33,
  winkMs: 300,

  // Per-person calibration of what open and shut mean for this face.
  // Off, this reads the raw score the way the first version did — worth being
  // able to switch so the correction can be compared rather than asserted.
  normalize: true,
  restWindowMs: 10000,     // long enough to be robust, short enough to follow a pose change
  restPercentile: 0.15,    // blinks are a small minority of any window
  restSampleMs: 50,
  minRange: 0.3,           // below this the signal has no usable dynamic range
  calibrationBlinks: 2,    // their shut level is not known until they have blinked
  calibrationMs: 4000,

  // A squint: parked between open and shut, going nowhere. On their own scale,
  // and well clear of it — the lower edge used to sit where a resting monolid
  // lives. Longer, too: a squint people hold on purpose is held.
  squintBand: [0.42, 0.88],
  squintMs: 900,
  squintSlope: 0.004,   // per ms; a real blink runs 3–5x this

  // Level-dependent channels stay quiet while the head is off-axis. Tilting back
  // or turning away changes the aperture the camera sees without the lid moving,
  // and the resting estimate needs a moment to follow.
  poseMaxTurn: 22,
  poseMaxPitch: 20,

  // "Held shut" should mean shut, not merely past a threshold.
  holdClosure: 0.9,

  // Rapid blinking: the primary signal. A "run" is consecutive gaps under the
  // ceiling; three gaps is four blinks. Measured against 20,000 simulated visits
  // — see scripts/discovery-sim.js and the note above.
  rapidMaxMs: 900,
  rapidRelative: 0.5,     // and clearly under their own rate, whatever it is
  rapidStaleMs: 3000,     // a run that stopped is no longer a run
  rapidMinRun: 2,         // three blinks before this says anything at all
  // Nobody blinks to a metronome. Requiring strictly consecutive short gaps let
  // one hesitation mid-burst reset the run to nothing, which is the likeliest
  // reason deliberate blinking failed to register at all. One longer gap is
  // stepped over — it does not count towards the run, but it does not end it.
  // Measured: at 6-18 blinks a minute this costs nothing, no run length becomes
  // any more likely by accident. Only the very fast blinker pays, and the ladder
  // already moves up a step for them.
  rapidTolerance: 1,
  fastBlinkerIbi: 2500,   // below this the whole ladder shifts up a step

  cvFloor: 0.5,           // CV at or above this reads as ordinary irregularity

  // Shape: corroboration only. Several blinks in a row have to stop looking like
  // that person's own before this says anything, so one odd blink is not a signal.
  shapeThreshold: 0.45,
  shapeOfLast: 5,
  shapeMinCount: 3,

  priorIbiMs: 4000,       // until the person has shown us their own rate
  baselineBlinks: 20,     // rolling window for their medians

  tauMs: 25000,         // evidence half-life, near enough
  absentResetMs: 2500,  // no face for this long and it is somebody else

  gains: { rapid: 1.0, shape: 0.6, hold: 0.8, wink: 0.7, squint: 0.6 },
  weights: { rapid: 0.85, shape: 0.55, hold: 0.8, wink: 0.75, squint: 0.65 },

  suspect: 0.35,
  discovered: 0.7,
};

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function createDiscovery(overrides = {}) {
  const config = { ...DEFAULTS, ...overrides };
  const listeners = [];

  // Their own scale: 0 is this person's eye open, 1 their eye shut. Declared
  // before reset(), which clears it along with everything else.
  const normalizer = createEyeNormalizer();

  let state;

  function reset() {
    normalizer.reset();
    state = {
      startedAt: null,
      lastAt: null,
      absentSince: null,

      closed: false,
      closureStart: null,
      closurePeak: 0,
      closureAsym: 0,
      onsetSlope: 0,
      prevScore: 0,
      slopeAvg: 0,
      inBand: 0,          // ms parked in the squint band
      winkFor: 0,         // ms of sustained asymmetry
      winkArmed: true,
      rapidBest: 0,

      blinkStarts: [],    // recent closure onsets, for the rhythm
      durations: [],      // that person's blink durations — frozen once suspicious
      peaks: [],          // and how completely they close — likewise
      intervals: [],

      recentGaps: [],     // { at, gap } — always updated, unlike the baseline
      volitions: [],      // how deliberate each recent blink looked

      // What open and shut mean for this particular face, per eye.
      poseOk: true,

      evidence: { rapid: 0, shape: 0, hold: 0, wink: 0, squint: 0 },
      detail: {
        rapid: 'no run', shape: 'nothing unusual',
        hold: 'none', wink: 'none', squint: 'none',
      },
      rapidNow: null,
      shapeNow: null,
      shapeArmed: true,
      log: [],
      score: 0,
      peakScore: 0,
      level: 'observing',
      discovered: false,
      discoveredAt: null,
      blinks: 0,
    };
  }
  reset();

  const note = (at, text) => {
    state.log.unshift({ at, text });
    if (state.log.length > 7) state.log.pop();
  };

  const shutLevel = (eye) => normalizer.levels()[eye].shut;
  const restLevel = (eye) => normalizer.levels()[eye].rest;

  // Both ends of that scale have to be known before anything that reads a level
  // is allowed to speak. Until then squint and hold say nothing at all: better to
  // notice nothing about somebody than to decide they are cheating because of the
  // shape of their eyes.
  function calibrated() {
    const levels = normalizer.levels();
    return (
      config.normalize === false ||
      (levels.left.ready &&
        levels.right.ready &&
        state.blinks >= config.calibrationBlinks &&
        state.startedAt !== null &&
        state.lastAt - state.startedAt >= config.calibrationMs)
    );
  }

  // Once there is real suspicion the person's "normal" is frozen, so a long
  // deliberate burst cannot redefine it and disappear into it.
  const learning = () => state.score < config.suspect;

  const baselineIbi = () =>
    state.intervals.length >= 4 ? median(state.intervals) : config.priorIbiMs;
  const baselineDuration = () => (state.durations.length >= 4 ? median(state.durations) : 120);
  const baselinePeak = () => (state.peaks.length >= 4 ? median(state.peaks) : 0.8);

  function raise(channel, strength, at, text) {
    const gain = config.gains[channel];
    state.evidence[channel] = clamp(state.evidence[channel] + gain * strength);
    if (text) note(at, text);
  }

  // How much a finished closure looks like it was done on purpose, from its
  // length and how fully the lid travelled — both against that person's own norm.
  function volition(duration, peak) {
    const longer = clamp((duration / baselineDuration() - 1.05) / 0.55);
    const fuller = clamp((peak - baselinePeak()) / 0.15);
    return clamp(0.6 * longer + 0.4 * fuller);
  }

  // The primary signal: consecutive short gaps, one after another. Deliberately
  // knows nothing about the shape of a blink — see the note at the top of the
  // file. Rate and regularity only refine a run that already exists.
  function rapid(at) {
    const gaps = state.recentGaps;
    const last = gaps[gaps.length - 1];
    if (!last || at - last.at > config.rapidStaleMs) {
      state.rapidNow = null;
      state.detail.rapid = 'no run';
      return null;
    }

    // Short in absolute terms, and clearly short for this person. The second
    // condition only bites on someone whose own rate is already very fast.
    const ceiling = Math.min(config.rapidMaxMs, baselineIbi() * config.rapidRelative);
    let run = 0;
    let hesitations = 0;
    for (let i = gaps.length - 1; i >= 0; i--) {
      if (gaps[i].gap <= ceiling) run += 1;
      else if (hesitations < config.rapidTolerance && gaps[i].gap <= ceiling * 2) hesitations += 1;
      else break;
    }

    // Someone who naturally blinks twice a second reaches a run of four without
    // meaning anything by it, so for them the whole ladder moves up a step.
    const offset = baselineIbi() < config.fastBlinkerIbi ? 1 : 0;
    const effective = run - offset;

    if (run < config.rapidMinRun || effective < config.rapidMinRun) {
      state.rapidNow = { run, effective, ceiling, blinks: run + 1 };
      state.detail.rapid =
        run > 0
          ? `${run + 1} quick blinks — needs ${config.rapidMinRun + offset + 1}`
          : 'no run';
      return null;
    }

    const runGaps = gaps
      .slice(-(run + hesitations))
      .map((g) => g.gap)
      .filter((gap) => gap <= ceiling);
    const mean = runGaps.reduce((a, b) => a + b, 0) / runGaps.length;
    const sd = Math.sqrt(runGaps.reduce((a, b) => a + (b - mean) ** 2, 0) / runGaps.length);
    const cv = mean > 0 ? sd / mean : 1;
    const regularity = runGaps.length >= 3 ? clamp(1 - cv / config.cvFloor) : 0;
    const rateRatio = baselineIbi() / mean;

    // Three blinks is common enough in ordinary blinking to be worth almost
    // nothing; six in a row is worth everything.
    const base = clamp(0.45 + 0.2 * (effective - 2));
    const strength = clamp(base + 0.12 * regularity);

    state.rapidNow = {
      run,
      effective,
      blinks: run + 1,
      ceiling,
      mean,
      cv,
      regularity,
      rateRatio,
      offset,
      hesitations,
      strength,
    };
    state.detail.rapid =
      `${run + 1} in a row, every ${(mean / 1000).toFixed(2)}s · ${rateRatio.toFixed(1)}× their rate` +
      (hesitations ? ` · ${hesitations} hesitation stepped over` : '') +
      (offset ? ' · fast blinker, bar raised' : '');
    return strength;
  }

  // Corroboration only. Several blinks in a row have to stop looking like this
  // person's own before this says anything at all, so one long blink — a yawn, a
  // moment of tiredness — is not evidence of a discovery.
  function shape() {
    const recent = state.volitions.slice(-config.shapeOfLast);
    if (state.durations.length < 5 || recent.length < config.shapeOfLast) {
      state.shapeNow = null;
      state.detail.shape = 'learning what theirs look like';
      return null;
    }
    const odd = recent.filter((v) => v > config.shapeThreshold);
    if (odd.length < config.shapeMinCount) {
      state.shapeNow = { odd: odd.length, of: recent.length };
      state.detail.shape = `${odd.length} of last ${recent.length} unlike their usual`;
      return null;
    }
    const strength = clamp(odd.reduce((a, b) => a + b, 0) / odd.length);
    state.shapeNow = { odd: odd.length, of: recent.length, strength };
    state.detail.shape =
      `${odd.length} of last ${recent.length} longer or fuller than their own`;
    return strength;
  }

  function score(at) {
    // Noisy-OR: each channel is an independent argument, and the score is the
    // chance that at least one of them holds. No weight reaches 1, so a single
    // behaviour can raise strong suspicion but two are needed for certainty.
    let product = 1;
    for (const [channel, evidence] of Object.entries(state.evidence)) {
      product *= 1 - config.weights[channel] * evidence;
    }
    state.score = clamp(1 - product);
    state.peakScore = Math.max(state.peakScore, state.score);

    const level =
      state.score >= config.discovered ? 'discovered'
        : state.score >= config.suspect ? 'suspected'
          : 'observing';

    if (level === 'discovered' && !state.discovered) {
      state.discovered = true;
      state.discoveredAt = at;
      note(at, 'figured it out');
      const snapshot = report();
      for (const listener of listeners) listener(snapshot);
    }
    // Once someone has worked it out they do not un-work it out. It clears when
    // they leave and somebody else walks up.
    state.level = state.discovered ? 'discovered' : level;
  }

  function frame({ at, left, right, hasFace, pose = null }) {
    if (state.startedAt === null) state.startedAt = at;
    const dt = state.lastAt === null ? 16 : Math.max(0, at - state.lastAt);
    state.lastAt = at;

    // Somebody walking away and somebody else walking up.
    if (!hasFace) {
      if (state.absentSince === null) state.absentSince = at;
      else if (at - state.absentSince > config.absentResetMs) reset();
      return;
    }
    state.absentSince = null;

    // Evidence fades, so a single odd moment does not stay on the books.
    const decay = Math.exp(-dt / config.tauMs);
    for (const channel of Object.keys(state.evidence)) state.evidence[channel] *= decay;

    // Calibrate first, then work entirely on their own scale. Sampling uses the
    // raw values; everything below uses closure, where 0 is this person's eyes
    // open — whatever number that happens to be for them.
    const mapped = config.normalize === false
      ? { left: clamp(left), right: clamp(right) }
      : normalizer.map({ left, right, at, hasFace });
    const closureLeft = mapped.left;
    const closureRight = mapped.right;

    const combined = Math.min(closureLeft, closureRight);
    const highest = Math.max(closureLeft, closureRight);
    const slope = dt > 0 ? (combined - state.prevScore) / dt : 0;

    // Tilting the head back or turning it changes the aperture the camera sees
    // without a lid moving, and the resting estimate takes a few seconds to
    // follow. The channels that read a level wait until it has.
    state.poseOk =
      !pose ||
      ((pose.turn == null || pose.turn <= config.poseMaxTurn) &&
        (pose.pitch == null || Math.abs(pose.pitch) <= config.poseMaxPitch));
    const levelsTrustworthy = calibrated() && state.poseOk;
    // Lightly averaged, because a single frame's slope is mostly noise, but not
    // heavily, because it is consulted at one instant — the crossing.
    state.slopeAvg = 0.6 * state.slopeAvg + 0.4 * slope;

    // --- wink: sustained asymmetry, not the ordinary half-frame of it --------
    const asymmetric = highest > config.winkHigh && highest - combined > config.winkGap;
    if (asymmetric) {
      state.winkFor += dt;
      if (state.winkFor >= config.winkMs && state.winkArmed) {
        state.winkArmed = false;
        raise('wink', 1, at, 'one eye held shut');
      }
      state.detail.wink = `${(state.winkFor / 1000).toFixed(1)}s of one eye`;
    } else {
      state.winkFor = 0;
      state.winkArmed = true;
      state.detail.wink = 'none';
    }

    // --- squint: parked between open and shut, going nowhere ----------------
    const [bandLow, bandHigh] = config.squintBand;
    const parked = combined > bandLow && combined < bandHigh && Math.abs(slope) < config.squintSlope;
    if (parked && !state.closed && !asymmetric && levelsTrustworthy) {
      state.inBand += dt;
      if (state.inBand >= config.squintMs) {
        state.inBand = 0;
        raise('squint', 1, at, 'held a squint');
      }
      state.detail.squint = `${(state.inBand / 1000).toFixed(1)}s parked at ${combined.toFixed(2)}`;
    } else if (!parked || asymmetric || !levelsTrustworthy) {
      state.inBand = 0;
      if (!asymmetric) {
        state.detail.squint = !calibrated()
          ? 'waiting to learn their eyes'
          : !state.poseOk
            ? 'head off-axis — not judging'
            : 'none';
      }
    }

    // --- closures: blinks and holds -----------------------------------------
    if (!state.closed && combined >= config.closeEnter) {
      state.closed = true;
      state.closureStart = at;
      state.closurePeak = combined;
      state.closureAsym = highest - combined;
      state.onsetSlope = state.slopeAvg;
    } else if (state.closed) {
      state.closurePeak = Math.max(state.closurePeak, combined);
      state.closureAsym = Math.max(state.closureAsym, highest - combined);
      if (combined <= config.closeExit) {
        state.closed = false;
        const duration = at - state.closureStart;

        const slowOnset = state.onsetSlope < config.squintSlope;
        const lopsided = state.closureAsym > config.winkGap;
        if (slowOnset && duration >= 400 && !lopsided) {
          // Crept there rather than blinked there. The level it reached does not
          // matter; a squint that settles above the threshold is still a squint.
          const strength = clamp((duration - 400) / 1200, 0.4, 1);
          raise('squint', strength, at, `crept shut and held ${(duration / 1000).toFixed(1)}s`);
          state.detail.squint = `slow closure, ${(duration / 1000).toFixed(1)}s`;
        } else if (duration >= config.holdMinMs) {
          // Only if the eyes actually went all the way shut, on their own scale,
          // and only once that scale is known. A long partial closure is not
          // somebody holding their eyes closed for a friend — it is very often
          // just a face the model reads as half shut to begin with.
          if (state.closurePeak >= config.holdClosure && levelsTrustworthy) {
            const strength = clamp(
              (duration - config.holdMinMs) / (config.holdFullMs - config.holdMinMs),
              0.3,
              1
            );
            raise('hold', strength, at, `eyes shut for ${(duration / 1000).toFixed(1)}s`);
            state.detail.hold = `last hold ${(duration / 1000).toFixed(1)}s`;
          } else {
            state.detail.hold = !calibrated()
              ? 'waiting to learn their eyes'
              : !state.poseOk
                ? 'head off-axis — not judging'
                : `${(duration / 1000).toFixed(1)}s but only ${Math.round(
                    state.closurePeak * 100
                  )}% shut`;
          }
        } else if (duration <= config.blinkMaxMs) {
          state.blinks += 1;
          state.blinkStarts.push(state.closureStart);
          if (state.blinkStarts.length > 24) state.blinkStarts.shift();

          const previous = state.blinkStarts[state.blinkStarts.length - 2];
          if (previous !== undefined) {
            const gap = state.closureStart - previous;
            if (gap > 120 && gap < 30000) {
              state.recentGaps.push({ at: state.closureStart, gap });
              if (state.recentGaps.length > 16) state.recentGaps.shift();
            }
          }
          state.volitions.push(volition(duration, state.closurePeak));
          if (state.volitions.length > 8) state.volitions.shift();

          // A run in progress must not teach the baseline. It is the baseline that
          // sets the run's own ceiling, so letting a burst into it drags the median
          // down, tightens the ceiling and breaks the very run being measured —
          // the longer someone blinks, the less it would count. Two gaps slip in
          // before a run is recognised, which a median absorbs.
          if (previous !== undefined && learning() && state.rapidBest === 0) {
            const gap = state.closureStart - previous;
            // Intervals still learn from everything in a sane range — the median
            // is what makes "their own rate" meaningful, and a burst of five
            // cannot move a twenty-sample median far.
            if (gap > 150 && gap < 30000) {
              state.intervals.push(gap);
              if (state.intervals.length > config.baselineBlinks) state.intervals.shift();
            }
          }

          const gapBefore = previous === undefined ? Infinity : state.closureStart - previous;
          if (learning() && gapBefore >= 1200) {
            state.durations.push(duration);
            state.peaks.push(state.closurePeak);
            if (state.durations.length > config.baselineBlinks) state.durations.shift();
            if (state.peaks.length > config.baselineBlinks) state.peaks.shift();
          }
        }
      }
    }

    // --- rapid blinking, and the shape of it --------------------------------
    const rapidStrength = rapid(at);
    if (rapidStrength !== null) {
      // Top up as the run grows rather than banking the first reading: three
      // blinks say little, six say everything, and the run only reveals itself
      // one blink at a time.
      if (rapidStrength > state.rapidBest + 0.02) {
        const first = state.rapidBest === 0;
        raise('rapid', rapidStrength - state.rapidBest, at,
          first ? `rapid blinking · ${state.rapidNow.blinks} in a row` : null);
        state.rapidBest = rapidStrength;
      }
    } else {
      state.rapidBest = 0;
    }

    const shapeStrength = shape();
    if (shapeStrength !== null) {
      if (state.shapeArmed) {
        state.shapeArmed = false;
        raise('shape', shapeStrength, at,
          `blinks unlike their own · ${state.shapeNow.odd} of ${state.shapeNow.of}`);
      }
    } else {
      state.shapeArmed = true;
    }

    state.lastClosureLeft = closureLeft;
    state.lastClosureRight = closureRight;
    state.prevScore = combined;
    score(at);
  }

  // Everything the page needs to explain the current determination.
  function report() {
    return {
      score: state.score,
      peak: state.peakScore,
      level: state.level,
      discovered: state.discovered,
      discoveredAt: state.discoveredAt,
      blinks: state.blinks,
      learning: learning(),
      evidence: { ...state.evidence },
      weights: { ...config.weights },
      detail: { ...state.detail },
      rapid: state.rapidNow,
      shape: state.shapeNow,
      baseline: {
        ibi: baselineIbi(),
        known: state.intervals.length >= 4,
        samples: state.intervals.length,
        duration: baselineDuration(),
        peak: baselinePeak(),
      },
      calibration: {
        settled: calibrated(),
        poseOk: state.poseOk,
        rest: { left: restLevel('left'), right: restLevel('right') },
        shut: { left: shutLevel('left'), right: shutLevel('right') },
        range: Math.min(
          shutLevel('left') - restLevel('left'),
          shutLevel('right') - restLevel('right')
        ),
        known: normalizer.levels().left.ready && normalizer.levels().right.ready,
      },
      closure: { left: state.lastClosureLeft ?? 0, right: state.lastClosureRight ?? 0 },
      log: [...state.log],
      thresholds: { suspect: config.suspect, discovered: config.discovered },
    };
  }

  return {
    frame,
    report,
    reset,
    config,
    onDiscovered: (listener) => listeners.push(listener),
  };
}
