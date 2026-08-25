// Replays the blink-tracking state machine over a synthetic blink, so the timing
// question can be argued about without a face in front of a camera.
//
//   node scripts/blink-timing.js
//
// The model of a blink is deliberately plain — lids down over 60 ms, shut for
// 40, up over 90 — and the eyeBlink score is assumed to track it directly. What
// is being tested is not the model but the machinery around it: what each of the
// camera rate, the capture delay, and the release mode does to where the reveal
// window lands relative to the eye.
//
// Keep this in step with public/methods/blink-tracking/index.html. If the state
// machine there changes, change it here and re-run.

const RAW_THRESHOLD = 0.5;    // what /lib/blink.js uses, kept as the baseline
const DEFAULT_LENGTH = 130;   // assumed blink length until real ones are seen

// Ground truth: the lids cover the eye from 30 ms to 145 ms. Half-closed either
// side of that, which is close enough to the point where an image would start
// and stop being visible.
const TRUE_ON = 30;
const TRUE_OFF = 145;

const trueScore = (t) =>
  t < 0 ? 0 : t < 60 ? t / 60 : t < 100 ? 1 : t < 190 ? 1 - (t - 100) / 90 : 0;

function run({ delay, fps, lead, release, enter = 0.45, exit = 0.7, noise = 0.03, blinks = 6 }) {
  const step = 1000 / fps;
  const lengths = [];
  const learned = () =>
    lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : DEFAULT_LENGTH;

  let rng = 987;
  const jitter = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2;

  let last = {};
  for (let b = 0; b < blinks; b++) {
    const t0 = b * 1000;
    let score = 0, velocity = 0, prevScore = null, prevAt = null, peak = 0;
    let closed = false, rawClosed = false, dueAt = null, rawOn = null;
    // One reveal per closure — see the latch in the page.
    let latched = false;
    const e = {};

    for (let at = t0; at < t0 + 700; at += step) {
      // What we see now was captured `delay` ms ago. That is the whole problem.
      const raw = Math.max(0, Math.min(1, trueScore(at - t0 - delay) + jitter() * noise));
      const dt = prevAt === null ? step : Math.max(1, at - prevAt);
      score = raw;
      const instant = prevScore === null ? 0 : (score - prevScore) / dt;
      velocity = 0.35 * velocity + 0.65 * instant;
      prevScore = score;
      prevAt = at;
      const pred = Math.max(0, Math.min(1.2, score + velocity * lead));

      // The predicted release is a timer, so it can land between frames.
      if (closed && dueAt !== null && at >= dueAt) {
        closed = false;
        latched = true;
        e.off ??= dueAt;
        dueAt = null;
      }

      if (!closed) {
        if (pred < enter) latched = false;
        else if (!latched) {
          closed = true;
          peak = pred;
          e.on ??= at;
          e.reveals = (e.reveals ?? 0) + 1;
          if (release === 'predicted') dueAt = at + Math.max(30, learned() - lead);
        }
      } else {
        peak = Math.max(peak, pred);
        if ((peak >= exit && pred <= exit) || pred <= enter) {
          closed = false;
          latched = true;
          e.off ??= at;
          dueAt = null;
        }
      }

      if (!rawClosed && raw > RAW_THRESHOLD) {
        rawClosed = true;
        rawOn = at;
        e.rawOn ??= at;
      } else if (rawClosed && raw <= RAW_THRESHOLD) {
        rawClosed = false;
        e.rawOff ??= at;
        const length = at - rawOn;
        if (length > 40 && length < 500) {
          lengths.push(length);
          if (lengths.length > 8) lengths.shift();
        }
      }
    }

    last = {
      on: e.on - t0,
      off: e.off - t0,
      rawOn: e.rawOn - t0,
      rawOff: e.rawOff - t0,
      reveals: e.reveals,
    };
  }
  return last;
}

const pad = (v) => (Number.isFinite(v) ? String(Math.round(v)).padStart(4) : '  --');

console.log('Steady state after 6 blinks. "late" is ms after the lids actually moved,');
console.log('so a negative number on the closing edge is the reveal beating the eye.\n');

for (const fps of [30, 60]) {
  for (const delay of [50, 90]) {
    for (const release of ['detected', 'predicted']) {
      const r = run({ delay, fps, lead: 60, release });
      const lateOff = r.off - TRUE_OFF;
      console.log(
        `${fps}fps  capture ${String(delay).padStart(2)}ms  ${release.padEnd(9)} | ` +
          `reveal ${pad(r.on)} →${pad(r.off)} (${pad(r.off - r.on)} long) | ` +
          `baseline ${pad(r.rawOn)} →${pad(r.rawOff)} | ` +
          `late ${pad(r.on - TRUE_ON)} /${pad(lateOff)}` +
          (r.reveals > 1 ? `   ${r.reveals}x FLASHED` : '') +
          (lateOff <= 0 ? '   shuts before the lids part' : '')
      );
    }
  }
}
