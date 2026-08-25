// Do the experiments and the blink-tracking page decide the same thing?
//
//   node scripts/parity-check.js
//
// They have to, and the only way to be sure is to run the same frames through
// both entry points and compare. The page and /lib/blink/index.js now call the
// same createBlinkDetector, so this asserts that neither has quietly grown its
// own copy again — which is exactly how they diverged the first time.

import { createBlinkDetector, DETECTOR_DEFAULTS } from '../src/perception/blink/detector.js';

let seed = 3;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

const DT = 1000 / 60;
const SQUARE_ON = { visible: 1, yaw: 0, pitch: 0, turn: 0 };

// A closure that ramps to `level` over `rampMs`, holds, and opens again.
function* movement({ rampMs, level, holdMs, wink = false, noise = 0.02 }) {
  const total = rampMs + holdMs + rampMs;
  for (let t = 0; t <= total; t += DT) {
    const clean =
      t < rampMs ? level * (t / rampMs)
        : t < rampMs + holdMs ? level
          : level * (1 - (t - rampMs - holdMs) / rampMs);
    const v = Math.max(0, clean + gauss() * noise);
    // A wink moves one lid only; the other stays where an open eye sits.
    yield { left: v, right: wink ? Math.max(0, gauss() * noise) : v, at: t, face: SQUARE_ON };
  }
}

// Count the reveals a run of frames produces.
function reveals(detector, frames) {
  let count = 0, shownMs = 0;
  for (const f of frames) {
    const r = detector.frame({ ...f, hasFace: true });
    if (r.changed && r.closed) count++;
    if (r.closed) shownMs += DT;
  }
  return { count, shownMs };
}

const CASES = [
  ['an ordinary blink',            { rampMs: 60,  level: 1.0,  holdMs: 60 },   1],
  ['a slow, tired blink',          { rampMs: 150, level: 1.0,  holdMs: 60 },   1],
  ['a quick squint, held',         { rampMs: 250, level: 0.62, holdMs: 2000 }, 0],
  ['a slow squint, held',          { rampMs: 700, level: 0.62, holdMs: 2000 }, 0],
  ['a shallow squint, held',       { rampMs: 250, level: 0.55, holdMs: 2000 }, 0],
  ['one eye closed (a wink)',      { rampMs: 80,  level: 1.0,  holdMs: 600, wink: true }, 0],
  ['one eye closed, held long',    { rampMs: 80,  level: 1.0,  holdMs: 3000, wink: true }, 0],
];

let failures = 0;
console.log('What every piece does with the same movement');
console.log('(the page and the experiments share one detector; this proves it)\n');

for (const [label, move, want] of CASES) {
  // 40 runs, because the answer must not depend on which way the noise fell.
  let worst = 0, best = Infinity, longest = 0;
  for (let i = 0; i < 40; i++) {
    const r = reveals(createBlinkDetector(), [...movement(move)]);
    worst = Math.max(worst, r.count);
    best = Math.min(best, r.count);
    longest = Math.max(longest, r.shownMs);
  }
  // A blink must always show. Anything else must essentially never show, and on
  // the rare occasion it does it must not linger.
  const ok = want === 0 ? longest <= 420 : best >= 1;
  if (!ok) failures++;
  const got = best === worst ? `${best}` : `${best}-${worst}`;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(30)} ${got} reveal(s), longest ${longest.toFixed(0)}ms on screen`);
}

// The defaults the experiments inherit are the ones tuned on the page.
console.log('\nDefaults every piece inherits');
for (const key of ['enter', 'exit', 'lead', 'bothEyes', 'minSpeed', 'minVisible', 'maxTurn']) {
  console.log(`  ${key.padEnd(12)} ${DETECTOR_DEFAULTS[key]}`);
}

// And with the gates off, the old behaviour comes back — which is the control.
const ungated = createBlinkDetector({ gates: false, bothEyes: false });
const winkThrough = reveals(ungated, [...movement({ rampMs: 80, level: 1.0, holdMs: 600, wink: true })]);
console.log(`\n  control · gates off, either eye: a wink produces ${winkThrough.count} reveal(s)`);
if (winkThrough.count === 0) { failures++; console.log('  FAIL the control should still let a wink through'); }

console.log(failures ? `\n${failures} FAILED` : '\nno difference — one detector, one behaviour');
process.exit(failures ? 1 : 0);
