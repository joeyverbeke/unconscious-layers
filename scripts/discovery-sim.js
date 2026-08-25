// Feeds the discovery detector synthetic people and checks it does not libel the
// innocent.
//
//   node scripts/discovery-sim.js
//
// The false-positive case matters more than the true-positive one: a piece that
// decides an ordinary visitor has "figured it out" is worse than one that misses
// somebody who has. So most of this is ordinary blinking, across the whole range
// of natural rates, and the bar is that none of it ever reaches the threshold.
//
// The blink model is deliberately plain — spontaneous blinks are short, often
// incomplete, and scattered on a long-tailed interval; deliberate ones are longer,
// fully shut, and close to a beat. Those are the differences the detector is built
// on, so this cannot prove the detector right, only keep it honest about its own
// assumptions and catch a calibration change that quietly breaks it.
//
// Keep this in step with public/lib/blink/discovery.js.
import { createDiscovery } from '../src/perception/blink/discovery.js';

// --- a seeded generator so runs are comparable ------------------------------
let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
// Blink intervals are long-tailed, not normal.
const logNormal = (medianMs, cv) => medianMs * Math.exp(gauss() * Math.sqrt(Math.log(1 + cv * cv)));

// --- blink waveforms --------------------------------------------------------
// A trapezoid: down, briefly shut, back up. The measured closure (time above
// 0.5) comes to about 0.56 of the whole thing, which is what puts an ordinary
// blink at the 100-150ms everyone reports.
function level(blink, t) {
  const { start, span, peak } = blink;
  const dt = t - start;
  if (dt < 0 || dt > span) return 0;
  if (blink.flat) {           // a deliberate hold: 150ms each way, shut between
    if (dt < 150) return peak * (dt / 150);
    if (dt > span - 150) return peak * ((span - dt) / 150);
    return peak;
  }
  if (blink.slow) {           // a squint: creeps in over 600ms and stays
    if (dt < 600) return peak * (dt / 600);
    if (dt > span - 250) return peak * ((span - dt) / 250);
    return peak;
  }
  const rise = span * 0.35, hold = span * 0.2;
  if (dt < rise) return peak * (dt / rise);
  if (dt < rise + hold) return peak;
  return peak * (1 - (dt - rise - hold) / (span - rise - hold));
}

// spontaneous: irregular, quick, often incomplete
const spontaneous = (start) => ({
  start, span: 200 + gauss() * 30, peak: clamp(0.86 + gauss() * 0.07), lag: 10 + rnd() * 25,
});
// deliberate, in the textbook sense: longer and fully shut
const deliberate = (start) => ({
  start, span: 400 + gauss() * 40, peak: clamp(0.98 + gauss() * 0.02), lag: 10 + rnd() * 25,
});
// deliberate, as observed: exactly the same shape, just far more often. This is
// the case the detector actually has to catch, and the one the old design missed.
const sameShape = (start) => ({
  start, span: 200 + gauss() * 30, peak: clamp(0.86 + gauss() * 0.07), lag: 10 + rnd() * 25,
});
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

// --- run a stream of blinks past the detector at 60fps ----------------------
function hold(start, shutMs) {   // quick down, held, quick up
  return { start, span: shutMs + 300, peak: 0.97, flat: true };
}
function creep(start, shutMs, level = 0.62) {  // a squint: ramps in over ~600ms
  return { start, span: shutMs, peak: level, slow: true };
}

// Some faces sit well away from zero with their eyes wide open — a monolid, an
// epicanthic fold, a head tilted back. `rest` is where their eyeBlink score lives
// when nothing at all is happening; `tilt` ramps it partway through, the way a
// head going back does.
function run(blinks, {
  durationMs, wink = [], squint = [], gap = null, existing = null,
  rest = 0, tilt = null, pose = null,
} = {}) {
  const d = existing ?? createDiscovery();
  const step = 1000 / 60;
  for (let t = 0; t < durationMs; t += step) {
    if (gap && t >= gap[0] && t < gap[1]) {           // nobody in front of the camera
      d.frame({ at: t, left: 0, right: 0, hasFace: false });
      continue;
    }
    let value = 0;
    for (const blink of blinks) value = Math.max(value, level(blink, t));

    // The two lids never move in perfect lockstep; the right lags a little.
    let left = value, right = 0;
    for (const blink of blinks) right = Math.max(right, level(blink, t - (blink.lag ?? 18)));
    for (const w of wink) {
      if (t >= w.start && t < w.start + w.span) { left = 0.92; right = w.other ?? 0.05; }
    }
    for (const s of squint) if (t >= s.start && t < s.start + s.span) { left = right = 0.55; }

    // A blink rides on top of wherever their eyes sit, rather than starting at 0.
    let floor = rest;
    if (tilt) {
      const through = clamp((t - tilt.start) / tilt.rampMs);
      floor = rest + (tilt.to - rest) * (t < tilt.start ? 0 : through);
    }
    const lift = (v) => clamp(floor + (0.93 - floor) * (v / 0.93));

    const jitter = () => clamp(Math.max(left, right) === 0 ? Math.abs(gauss()) * 0.015 : 0);
    d.frame({
      at: t,
      left: clamp(lift(left) + jitter()),
      right: clamp(lift(right) + jitter()),
      hasFace: true,
      pose: tilt && t >= tilt.start ? { turn: 10, pitch: tilt.pitch ?? 0 } : pose,
    });
  }
  return d;
}

// Ordinary blinking at a given rate, for a given length of time.
function ordinary(durationMs, perMinute, cv = 0.8) {
  const medianIbi = 60000 / perMinute;
  const blinks = [];
  let t = logNormal(medianIbi, cv);
  while (t < durationMs) {
    blinks.push(spontaneous(t));
    t += Math.max(400, logNormal(medianIbi, cv));
  }
  return blinks;
}

// A run of deliberate blinks, near enough to a beat.
function burst(startAt, count, everyMs = 700, make = deliberate) {
  const blinks = [];
  let at = startAt;
  for (let i = 0; i < count; i++) {
    blinks.push(make(at));
    at += Math.max(280, everyMs + gauss() * 90);   // a beat, loosely kept
  }
  return blinks;
}

let failures = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? `  ${extra}` : ''}`);
};
const pct = (v) => `${(v * 100).toFixed(0)}%`;

// === 1. ordinary visitors, across the range of natural blink rates ==========
console.log('Ordinary blinking — nobody here has figured anything out\n');
for (const rate of [6, 12, 18, 25]) {
  let worst = 0, discovered = 0;
  const people = 25;
  for (let p = 0; p < people; p++) {
    const d = run(ordinary(120000, rate), { durationMs: 120000 });
    const r = d.report();
    worst = Math.max(worst, r.peak);
    if (r.discovered) discovered++;
  }
  check(
    `${String(rate).padStart(2)}/min · ${people} people · 2 min each`,
    discovered === 0,
    `worst peak ${pct(worst)}, ${discovered} false positives`
  );
}

// === 2. the awkward one: a naturally fast, unusually regular blinker =========
const steady = run(ordinary(120000, 20, 0.45), { durationMs: 120000 });
check('fast and fairly regular natural blinker', !steady.report().discovered,
  `peak ${pct(steady.report().peak)}`);

// The hardest innocent case: someone who genuinely blinks twice a second.
let fastWorst = 0, fastFalse = 0;
for (let p = 0; p < 30; p++) {
  const d = run(ordinary(120000, 32, 0.9), { durationMs: 120000 });
  fastWorst = Math.max(fastWorst, d.report().peak);
  if (d.report().discovered) fastFalse++;
}
check('32/min natural blinker · 30 people', fastFalse === 0,
  `worst peak ${pct(fastWorst)}, ${fastFalse} false positives`);

// === 3. rapid blinking, in the shape it actually arrives in =================
console.log('\nDeliberate behaviour — this is what should be caught\n');
const base = ordinary(60000, 12);

// The case that matters: blinking far more often, with blinks shaped exactly
// like their own. Shape tells us nothing here, and it must not have to.
const four = run([...base, ...burst(62000, 4, 650, sameShape)], { durationMs: 70000 });
const r4 = four.report();
check('4 rapid blinks, identical shape → suspicion', r4.peak >= r4.thresholds.suspect,
  `peak ${pct(r4.peak)} (${r4.level})`);

const six = run([...base, ...burst(62000, 6, 620, sameShape)], { durationMs: 72000 });
const r6 = six.report();
check('6 rapid blinks, identical shape → certainty on its own', r6.discovered,
  `peak ${pct(r6.peak)}`);

const nine = run([...base, ...burst(62000, 9, 600, sameShape)], { durationMs: 76000 });
check('9 rapid blinks → certainty', nine.report().discovered, `peak ${pct(nine.report().peak)}`);

// Three is common enough in ordinary blinking that it must not be enough.
const three = run([...base, ...burst(62000, 3, 700, sameShape)], { durationMs: 70000 });
check('3 rapid blinks alone is not enough', !three.report().discovered,
  `peak ${pct(three.report().peak)}`);

// Drifting from ordinary blinking into deliberate blinking, which is how it
// actually happens rather than starting cold.
const drift = run([...ordinary(40000, 12), ...burst(42000, 7, 750, sameShape)], { durationMs: 52000 });
check('ordinary → intentional transition is caught', drift.report().discovered,
  `peak ${pct(drift.report().peak)}`);

// And the textbook version still works, now via two channels.
const textbook = run([...base, ...burst(62000, 6, 650, deliberate)], { durationMs: 72000 });
const rT = textbook.report();
check('longer, fuller deliberate blinks → certainty', rT.discovered,
  `peak ${pct(rT.peak)} via ${Object.entries(rT.evidence).filter(([, e]) => e > 0.15)
    .map(([c]) => c).join(' + ')}`);

// === 4. the other three behaviours ==========================================
const held = run([...base, hold(62000, 2600)], { durationMs: 70000 });
check('holding the eyes shut counts', held.report().peak >= held.report().thresholds.suspect,
  `peak ${pct(held.report().peak)}`);

const winked = run(base, { durationMs: 70000, wink: [{ start: 62000, span: 900 }] });
check('a clean wink counts', winked.report().peak > 0.3, `peak ${pct(winked.report().peak)}`);

// The realistic wink: the other eye drifts half shut, which used to be read as
// a squint instead.
const sloppy = run(base, { durationMs: 70000, wink: [{ start: 62000, span: 900, other: 0.42 }] });
const rS = sloppy.report();
check('a sloppy wink reads as a wink, not a squint',
  rS.evidence.wink > rS.evidence.squint,
  `wink ${pct(rS.evidence.wink)} vs squint ${pct(rS.evidence.squint)}`);

const squinted = run([...base, creep(62000, 1800)], { durationMs: 70000 });
check('a held squint counts', squinted.report().peak > 0.2, `peak ${pct(squinted.report().peak)}`);

// === 5. a realistic discovery ===============================================
const arc = run([...base, ...burst(62000, 4, 700, sameShape), hold(68000, 2400)],
  { durationMs: 76000 });
const rArc = arc.report();
check('rapid blinking then a hold — discovered', rArc.discovered,
  `peak ${pct(rArc.peak)} via ${Object.entries(rArc.evidence).filter(([, e]) => e > 0.15)
    .map(([c]) => c).join(' + ')}`);

// === 5b. faces the model was not built around ===============================
// Both of these were reported from real use, and both are the same bug: eyeBlink
// measures departure from a canonical open eye, and that canonical eye is
// somebody in particular.
console.log('\nFaces that sit away from zero — none of this is squinting\n');

for (const restLevel of [0.22, 0.32, 0.42]) {
  const d = run(ordinary(120000, 14), { durationMs: 120000, rest: restLevel });
  const r = d.report();
  check(
    `resting eyeBlink ${restLevel.toFixed(2)} · ordinary blinking`,
    r.evidence.squint < 0.05 && r.evidence.hold < 0.05 && !r.discovered,
    `squint ${pct(r.evidence.squint)}, hold ${pct(r.evidence.hold)}, ` +
      `peak ${pct(r.peak)}, rest learned ${r.calibration.rest.left.toFixed(2)}, ` +
      `${r.blinks} blinks still counted`
  );
}

// Lying back, so the head goes back and the aperture the camera sees narrows.
const tilted = run(ordinary(120000, 14), {
  durationMs: 120000,
  rest: 0.05,
  tilt: { start: 40000, rampMs: 3000, to: 0.36, pitch: 26 },
});
const rTilt = tilted.report();
check('head tilted back mid-visit',
  rTilt.evidence.squint < 0.05 && rTilt.evidence.hold < 0.05,
  `squint ${pct(rTilt.evidence.squint)}, hold ${pct(rTilt.evidence.hold)}, ` +
    `rest followed to ${rTilt.calibration.rest.left.toFixed(2)}`);

// The correction must not make these faces invisible to the detector either.
const restingFast = run([...ordinary(50000, 14), ...burst(52000, 7, 640, sameShape)],
  { durationMs: 62000, rest: 0.32 });
check('resting 0.32 · deliberate rapid blinking still caught',
  restingFast.report().discovered, `peak ${pct(restingFast.report().peak)}`);

const restingHold = run([...ordinary(50000, 14), hold(52000, 2600)],
  { durationMs: 62000, rest: 0.32 });
check('resting 0.32 · a real hold still counts',
  restingHold.report().evidence.hold > 0.2,
  `hold ${pct(restingHold.report().evidence.hold)}`);

// The same visitors, judged the way the first version judged them. Kept as a
// demonstration that the tests above are not vacuous: an absolute band really
// does convict a resting face, and it is worth being able to see it do so.
console.log('\n  the same faces, before the correction:');
const BEFORE = {
  normalize: false, squintBand: [0.28, 0.85], squintMs: 600,
  calibrationBlinks: 0, calibrationMs: 0, holdClosure: 0,
  poseMaxPitch: 999, poseMaxTurn: 999,
};
for (const restLevel of [0.22, 0.32, 0.42]) {
  const before = run(ordinary(120000, 14), {
    durationMs: 120000, rest: restLevel, existing: createDiscovery(BEFORE),
  }).report();
  const note = before.blinks === 0
    ? 'no blinks counted at all — eyes read as permanently shut'
    : before.evidence.squint > 0.5
      ? 'judged to be squinting, while doing nothing'
      : 'no false positive';
  console.log(`    rest ${restLevel.toFixed(2)} → squint ${pct(before.evidence.squint)}, ` +
    `score ${pct(before.peak)}, ${before.blinks} blinks · ${note}`);
}

// === 6. somebody else walks up ==============================================
const swapped = run([...base, ...burst(62000, 6, 650, sameShape)],
  { durationMs: 100000, gap: [80000, 90000] });
const rSwap = swapped.report();
check('a new person clears the determination', !rSwap.discovered && rSwap.score < 0.1,
  `score ${pct(rSwap.score)} after the camera was empty for 10s`);

// === 7. evidence fades ======================================================
const faded = run([...base, ...burst(62000, 4, 650, sameShape)], { durationMs: 160000 });
check('a lone burst fades over a couple of minutes', faded.report().score < r4.peak,
  `${pct(r4.peak)} → ${pct(faded.report().score)}`);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
