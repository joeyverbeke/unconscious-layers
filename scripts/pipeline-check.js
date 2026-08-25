// Headless checks for the glue this project adds around repo B's blink core:
// blinkPipeline (normalize -> readFace -> detector) and the engagement gate.
//
// The ported modules themselves are covered by parity-check and discovery-sim;
// this covers the code that is new here.
import { createBlinkPipeline } from '../src/perception/blinkPipeline.js';
import { createEngagement } from '../src/experience/engagement.js';
import { createTierGovernor } from '../src/settings/tiers.js';

let failures = 0;
const ok = (label, condition, detail = '') => {
  console.log(`${condition ? 'ok  ' : 'FAIL'}   ${label}${detail ? '  ' + detail : ''}`);
  if (!condition) failures += 1;
};

// A face squarely on to the camera: the two eye-corner gaps are equal, so
// facing() reads 1 and the visibility gate passes.
const squareOnFace = () => {
  const points = [];
  for (let i = 0; i < 478; i++) points[i] = { x: 0.5, y: 0.5, z: 0 };
  points[168] = { x: 0.50, y: 0.45, z: 0 }; // bridge
  points[33] = { x: 0.40, y: 0.45, z: 0 };  // right outer corner
  points[263] = { x: 0.60, y: 0.45, z: 0 }; // left outer corner
  return points;
};
// Rotation matrix looking straight at the camera: forward column = (0,0,1).
const squareOnMatrix = { data: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] };

console.log('\nBlink pipeline — a blink is seen, a slow squint is not\n');
{
  const pipe = createBlinkPipeline({ config: {}, normalize: false });
  const points = squareOnFace();
  let at = 0;
  const transitions = [];
  const feed = (value, stepMs = 16) => {
    at += stepMs;
    const r = pipe.frame({ left: value, right: value, points, matrix: squareOnMatrix, at, hasFace: true });
    if (r.changed) transitions.push({ closed: r.closed, at });
    return r;
  };

  for (let i = 0; i < 40; i++) feed(0.02);         // resting, eyes open
  for (const v of [0.2, 0.5, 0.85, 0.95]) feed(v); // lids down fast (~64ms)
  for (const v of [0.9, 0.6, 0.3, 0.05]) feed(v);  // and back up
  for (let i = 0; i < 20; i++) feed(0.02);

  ok('a fast blink produces one closed and one open transition',
     transitions.length === 2 && transitions[0].closed === true && transitions[1].closed === false,
     JSON.stringify(transitions.map(t => t.closed)));
}
{
  const pipe = createBlinkPipeline({ config: {}, normalize: false });
  const points = squareOnFace();
  let at = 0;
  let changes = 0;
  for (let i = 0; i < 40; i++) { at += 16; pipe.frame({ left: 0.02, right: 0.02, points, matrix: squareOnMatrix, at, hasFace: true }); }
  // A slow squint: same depth, taken 40x longer. The speed gate should refuse it.
  for (let i = 1; i <= 120; i++) {
    at += 16;
    const r = pipe.frame({ left: i / 120, right: i / 120, points, matrix: squareOnMatrix, at, hasFace: true });
    if (r.changed) changes += 1;
  }
  ok('a slow squint is refused by the speed gate', changes === 0, `${changes} transitions`);
}
{
  const pipe = createBlinkPipeline({ config: {}, normalize: false });
  const points = squareOnFace();
  let at = 0;
  let changes = 0;
  for (let i = 0; i < 40; i++) { at += 16; pipe.frame({ left: 0.02, right: 0.02, points, matrix: squareOnMatrix, at, hasFace: true }); }
  // One eye only. combine() takes the min, so a wink never reaches the threshold.
  for (const v of [0.2, 0.6, 0.95, 0.9, 0.4, 0.05]) {
    at += 16;
    const r = pipe.frame({ left: v, right: 0.02, points, matrix: squareOnMatrix, at, hasFace: true });
    if (r.changed) changes += 1;
  }
  ok('a wink is not a blink', changes === 0, `${changes} transitions`);
}
{
  // Somebody walks away mid-blink: with no face the detector must release, or
  // the full-bleed reveal image would stay up over an empty room.
  const pipe = createBlinkPipeline({ config: {}, normalize: false });
  const points = squareOnFace();
  let at = 0;
  let closed = false;
  for (let i = 0; i < 40; i++) { at += 16; pipe.frame({ left: 0.02, right: 0.02, points, matrix: squareOnMatrix, at, hasFace: true }); }
  for (const v of [0.2, 0.5, 0.85, 0.95]) { at += 16; closed = pipe.frame({ left: v, right: v, points, matrix: squareOnMatrix, at, hasFace: true }).closed; }
  ok('eyes read as closed before they vanish', closed === true);
  for (let i = 0; i < 10; i++) { at += 16; closed = pipe.frame({ left: 0, right: 0, points: null, matrix: null, at, hasFace: false }).closed; }
  ok('the reveal releases on its own when the face disappears', closed === false);
}

console.log('\nEngagement — both signals, with hysteresis and dwell\n');
{
  const settings = {
    enterCoverage: 0.02, exitCoverage: 0.01,
    enterFaceScale: 0.22, exitFaceScale: 0.17,
    engageDwellMs: 600, disengageDwellMs: 900,
  };
  const events = [];
  const gate = createEngagement({ settings, onChange: (s) => events.push(s.engaged) });
  let at = 0;
  const step = (coverage, scale, hasFace, ms = 100) => {
    at += ms;
    gate.updateCoverage(coverage, at);
    gate.updateFace({ hasFace, scale, at });
  };

  // Far away: plenty of body in frame, but the face is small.
  for (let i = 0; i < 12; i++) step(0.05, 0.10, true);
  ok('a big silhouette with a small face does not engage', gate.engaged === false, gate.snapshot.reason);

  // A face close enough, but only just arrived — the dwell should hold it off.
  step(0.05, 0.30, true, 100);
  step(0.05, 0.30, true, 100);
  ok('engagement waits out the dwell', gate.engaged === false);

  for (let i = 0; i < 8; i++) step(0.05, 0.30, true);
  ok('engaged once both signals hold past the dwell', gate.engaged === true);

  // Between the exit and enter thresholds: hysteresis should keep them engaged.
  for (let i = 0; i < 15; i++) step(0.015, 0.19, true);
  ok('hysteresis keeps a wavering signal engaged', gate.engaged === true);

  // Actually leaving.
  for (let i = 0; i < 15; i++) step(0.001, 0, false);
  ok('disengaged after they leave', gate.engaged === false);
  ok('exactly one engage and one disengage were emitted',
     events.length === 2 && events[0] === true && events[1] === false,
     JSON.stringify(events));
}

console.log('\nTier governor — one step down, once, and only early on\n');
{
  const dropped = [];
  const g = createTierGovernor({ tier: 'high', onDowngrade: (t) => dropped.push(t) });
  let at = 0;

  // Startup: the pool is still being built and nothing has been drawn.
  for (let i = 0; i < 24; i++) { at += 250; g.sample(0, at); }
  ok('a stalled frame rate during warmup is not held against it', g.tier === 'high');

  at += 9000; // out of the warmup window
  for (let i = 0; i < 20; i++) { at += 250; g.sample(60, at); }
  ok('a machine that keeps up is left alone', g.tier === 'high' && dropped.length === 0);

  for (let i = 0; i < 10; i++) { at += 250; g.sample(15, at); } // 2.5s — not yet
  ok('a brief slow patch is not enough', g.tier === 'high');

  for (let i = 0; i < 12; i++) { at += 250; g.sample(15, at); } // past 5s sustained
  ok('sustained low frame rate steps down one tier', g.tier === 'medium', dropped.join(','));

  for (let i = 0; i < 60; i++) { at += 250; g.sample(5, at); }
  ok('and never steps again, however bad it gets', g.tier === 'medium' && dropped.length === 1);
}
{
  const g = createTierGovernor({ tier: 'high' });
  let at = 9000;
  for (let i = 0; i < 20; i++) { at += 250; g.sample(60, at); }
  at += 80000; // past the opening window
  for (let i = 0; i < 40; i++) { at += 250; g.sample(5, at); }
  ok('slowness later in the evening is left alone', g.tier === 'high' && g.spent === true);
}
{
  // ?tier=low is a decision, not a starting guess.
  const g = createTierGovernor({ tier: 'low', enabled: false });
  let at = 9000;
  for (let i = 0; i < 60; i++) { at += 250; g.sample(2, at); }
  ok('an explicitly chosen tier is never overruled', g.tier === 'low');
}
{
  const g = createTierGovernor({ tier: 'low' });
  let at = 9000;
  for (let i = 0; i < 40; i++) { at += 250; g.sample(2, at); }
  ok('the lowest tier has nowhere to go', g.tier === 'low');
}

console.log(failures === 0 ? '\nall passed\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
