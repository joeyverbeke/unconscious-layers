// Headless checks for the glue this project adds around repo B's blink core:
// blinkPipeline (normalize -> readFace -> detector) and the engagement gate.
//
// The ported modules themselves are covered by parity-check and discovery-sim;
// this covers the code that is new here.
import { createBlinkPipeline } from '../src/perception/blinkPipeline.js';
import { createEngagement } from '../src/experience/engagement.js';
import { createTierGovernor } from '../src/settings/tiers.js';
import { createDiscovery } from '../src/perception/blink/discovery.js';
import { mapDiscoverySettings } from '../src/perception/tuning.js';
import { DEFAULT_SETTINGS } from '../src/settings/defaults.js';

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

console.log('\nEngagement — face scale, with hysteresis and dwell\n');
{
  const settings = {
    enterFaceScale: 0.22, exitFaceScale: 0.17,
    engageDwellMs: 600, disengageDwellMs: 900,
  };
  const events = [];
  const gate = createEngagement({ settings, onChange: (s) => events.push(s.engaged) });
  let at = 0;
  const step = (scale, hasFace, ms = 100) => {
    at += ms;
    gate.updateFace({ hasFace, scale, at });
  };

  // In the room, but across it — their face is small.
  for (let i = 0; i < 12; i++) step(0.10, true);
  ok('somebody across the room does not engage', gate.engaged === false, gate.snapshot.reason);

  // Close enough, but only just arrived — the dwell should hold it off.
  step(0.30, true, 100);
  step(0.30, true, 100);
  ok('engagement waits out the dwell', gate.engaged === false);

  for (let i = 0; i < 8; i++) step(0.30, true);
  ok('engaged once the face is close enough, past the dwell', gate.engaged === true);

  // Between the exit and enter thresholds: hysteresis should keep them engaged.
  for (let i = 0; i < 15; i++) step(0.19, true);
  ok('hysteresis keeps a wavering signal engaged', gate.engaged === true);

  // A face lost entirely.
  for (let i = 0; i < 15; i++) step(0, false);
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

// ---------------------------------------------------------------------------
// rearm() keeps the person, reset() forgets them.
//
// After the sentence comes down the SAME person is still standing there. If
// re-arming used reset(), they would have to spend two blinks and four seconds
// teaching the determiner their face again before hold or squint could speak.
// ---------------------------------------------------------------------------
console.log('\nRe-arming the determiner without forgetting the face\n');
{
  const STEP = 1000 / 60, REST = 0.05, SHUT = 0.95;
  const level = (start, t, span = 140) => {
    const u = (t - start) / span;
    if (u < 0 || u > 1) return 0;
    return u < 0.36 ? u / 0.36 : u < 0.58 ? 1 : (1 - u) / 0.42;
  };
  const drive = (d, starts, ms, from = 0) => {
    for (let t = from; t < from + ms; t += STEP) {
      let v = 0;
      for (const s of starts) v = Math.max(v, level(s, t));
      const val = REST + (SHUT - REST) * v;
      d.frame({ at: t, left: val, right: val, hasFace: true, pose: { turn: 4, pitch: 2 } });
    }
    return from + ms;
  };
  const person = () => {
    const d = createDiscovery();
    const ordinary = [];
    for (let t = 800; t < 30000; t += 3400) ordinary.push(t);   // their own rhythm
    drive(d, ordinary, 30000);
    return d;
  };
  const burstFrom = (at) => {
    const b = [];
    for (let i = 0; i < 9; i++) b.push(at + 300 + i * 430);
    return b;
  };

  const d = person();
  ok('an ordinary visitor calibrates and is not suspected',
     d.report().calibration.settled === true && d.report().discovered === false);
  const learnedIbi = d.report().baseline.ibi;

  const after = drive(d, burstFrom(30000), 6000, 30000);
  ok('a deliberate burst is found out', d.report().discovered === true);

  d.rearm();
  const armed = d.report();
  ok('rearm clears the finding', armed.discovered === false && armed.score === 0);
  ok('rearm clears the evidence it rested on',
     Object.values(armed.evidence).every((v) => v === 0));
  ok('but they are STILL calibrated', armed.calibration.settled === true);
  ok('and their own blink rate is remembered',
     Math.round(armed.baseline.ibi) === Math.round(learnedIbi), `${armed.baseline.ibi}`);

  drive(d, burstFrom(after + 200), 6000, after);
  ok('so a second burst is found out too, with no recalibration',
     d.report().discovered === true && d.report().calibration.settled === true);

  // The contrast: reset() is for a different face.
  const other = person();
  drive(other, burstFrom(30000), 6000, 30000);
  other.reset();
  ok('reset, by contrast, forgets the face entirely',
     other.report().calibration.settled === false && other.report().baseline.samples === 0);
}

// ---------------------------------------------------------------------------
// The tuning THIS PIECE uses — not repo B's, which discovery-sim still guards.
//
// The bar is deliberately lower here: somebody who works out that blinking does
// something may only ever do the ONE thing, so any single deliberate signal has
// to be enough on its own. What must NOT move is the other half of the bargain:
// people who are simply standing there blinking are never accused.
// ---------------------------------------------------------------------------
console.log('\nThis piece\'s discovery tuning\n');
{
  const CFG = mapDiscoverySettings(DEFAULT_SETTINGS);
  const STEP = 1000 / 60, REST = 0.05, SHUT = 0.95;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const blinkAt = (start, t, span = 140) => {
    const u = (t - start) / span;
    if (u < 0 || u > 1) return 0;
    return u < 0.36 ? u / 0.36 : u < 0.58 ? 1 : (1 - u) / 0.42;
  };
  const heldAt = (start, t, shutMs) => {
    const u = t - start;
    if (u < 0) return 0;
    if (u < 60) return u / 60;
    if (u < 60 + shutMs) return 1;
    const d = (u - 60 - shutMs) / 70;
    return d < 1 ? 1 - d : 0;
  };
  const drive = (d, at, ms, shape) => {
    for (let t = at; t < at + ms; t += STEP) {
      const { l, r } = shape(t);
      d.frame({
        at: t,
        left: REST + (SHUT - REST) * l + rnd() * 0.012,
        right: REST + (SHUT - REST) * r + rnd() * 0.012,
        hasFace: true, pose: { turn: 4, pitch: 2 },
      });
    }
  };
  // Somebody who has stood there long enough to be calibrated.
  const person = () => {
    const d = createDiscovery(CFG);
    const s = [];
    for (let t = 800; t < 30000; t += 3400) s.push(t);
    drive(d, 0, 30000, (t) => { let v = 0; for (const x of s) v = Math.max(v, blinkAt(x, t)); return { l: v, r: v }; });
    return d;
  };
  const perform = (ms, shape) => { const d = person(); drive(d, 30000, ms, shape); return d.report(); };

  // Each signal, once, clearly — every one of them enough on its own.
  ok('eyes held shut for a second is enough by itself',
     perform(3000, (t) => { const v = heldAt(30300, t, 1000); return { l: v, r: v }; }).discovered);
  ok('one eye is enough by itself',
     perform(2500, (t) => (t >= 30300 && t < 31300) ? { l: 0.92, r: 0.05 } : { l: 0, r: 0 }).discovered);
  ok('a held squint is enough by itself',
     perform(2500, (t) => (t >= 30300 && t < 31500) ? { l: 0.55, r: 0.55 } : { l: 0, r: 0 }).discovered);
  ok('so is a short run of rapid blinking', (() => {
     const b = []; for (let i = 0; i < 5; i++) b.push(30300 + i * 430);
     return perform(4000, (t) => { let v = 0; for (const x of b) v = Math.max(v, blinkAt(x, t)); return { l: v, r: v }; }).discovered;
  })());

  // ...but a bar remains. A blink-length closure is not a held one.
  ok('a 0.7s closure is suspected, not concluded', (() => {
     const r = perform(2500, (t) => { const v = heldAt(30300, t, 700); return { l: v, r: v }; });
     return r.discovered === false && r.score > 0;
  })());

  // The half that must not move. Its own seed, so the sample does not depend on
  // how many random numbers the checks above happened to consume.
  {
    let vseed = 20260825;
    const vrnd = () => ((vseed = (vseed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let accused = 0, visitors = 0;
    const scores = [];
    for (let i = 0; i < 120; i++) {
      const perMin = [6, 10, 14, 18, 22, 26, 32][i % 7];
      const ibi = 60000 / perMin;
      const d = createDiscovery(CFG);
      const st = [];
      for (let t = 800; t < 45000; t += ibi * (0.5 + vrnd())) st.push(t);
      for (let t = 0; t < 45000; t += STEP) {
        let v = 0;
        for (const x of st) v = Math.max(v, blinkAt(x, t, 110 + vrnd() * 160));
        const raw = REST + (SHUT - REST) * v + vrnd() * 0.012;
        d.frame({ at: t, left: raw, right: raw, hasFace: true, pose: { turn: 4, pitch: 2 } });
      }
      const r = d.report();
      visitors += 1;
      if (r.discovered) accused += 1;
      scores.push(r.peak);
    }
    scores.sort((a, b) => a - b);
    const pct = (q) => scores[Math.floor(q * (scores.length - 1))];
    const worst = scores[scores.length - 1];

    ok('nobody merely blinking is ever accused', accused === 0, `${accused}/${visitors}`);
    ok('and almost none of them even raise suspicion',
       pct(0.99) < DEFAULT_SETTINGS.discoverySuspect + 0.15,
       `99th percentile ${pct(0.99).toFixed(2)}`);
    ok('the second-time bar clears their 99th percentile',
       DEFAULT_SETTINGS.discoveryRetrigger > pct(0.99),
       `bar ${DEFAULT_SETTINGS.discoveryRetrigger} vs ${pct(0.99).toFixed(2)}`);
    // The tail is what an occasional unwanted second sentence would cost. It is
    // allowed to touch the second-time bar; it must never touch the first.
    ok('and their very worst never reaches the first-time bar',
       worst < DEFAULT_SETTINGS.discoveryDiscovered,
       `worst ${worst.toFixed(2)} vs ${DEFAULT_SETTINGS.discoveryDiscovered}`);
  }

  // -------------------------------------------------------------------------
  // CALIBRATION MUST COMPLETE, for faces that do not read 1.0.
  //
  // This guards a bug that shipped: raising closeEnter to 0.9 to separate
  // closures from squints looked right and broke everything. normalize.js
  // shrinks a person's "shut" toward the canonical 1.0 with a prior of 6, so a
  // face whose raw eyeBlink peaks below ~0.95 never produces a normalized
  // closure that high — no blinks counted, so no calibration, no baseline, and
  // no rapid channel. It passed every test at the time, because every test
  // simulated an eye that reads 0.95.
  // -------------------------------------------------------------------------
  {
    let cseed = 991;
    const crnd = () => ((cseed = (cseed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const visit = (rawPeak, seconds, ibi) => {
      const d = createDiscovery(CFG);
      const st = [];
      for (let t = 800; t < seconds * 1000; t += ibi) st.push(t);
      for (let t = 0; t < seconds * 1000; t += STEP) {
        let v = 0;
        for (const x of st) v = Math.max(v, blinkAt(x, t, 150));
        const raw = 0.04 + (rawPeak - 0.04) * v + crnd() * 0.01;
        d.frame({ at: t, left: raw, right: raw, hasFace: true, pose: { turn: 3, pitch: 2 } });
      }
      const r = d.report();
      return { counted: r.blinks, real: st.length, settled: r.calibration.settled };
    };

    for (const rawPeak of [0.65, 0.75, 0.85, 0.95]) {
      const v = visit(rawPeak, 30, 3200);
      ok(`a face reading ${rawPeak} has every blink counted`,
         v.counted === v.real, `${v.counted}/${v.real}`);
    }
    ok('and calibration finishes inside a thirty-second visit',
       [0.65, 0.75, 0.85, 0.95].every((p) => visit(p, 30, 3200).settled));
  }

  // A gallery visit is thirty seconds if you are lucky, and somebody looking at
  // a painting blinks slowly. hold and squint are gated on calibration, so how
  // long that takes decides whether they can speak during the visit at all.
  {
    let kseed = 5;
    const krnd = () => ((kseed = (kseed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const timeToCalibrate = (perMin) => {
      const d = createDiscovery(CFG);
      const ibi = 60000 / perMin;
      const st = [];
      for (let t = 1000; t < 60000; t += ibi) st.push(t);
      for (let t = 0; t < 60000; t += STEP) {
        let v = 0;
        for (const x of st) v = Math.max(v, blinkAt(x, t, 150));
        const raw = 0.04 + 0.76 * v + krnd() * 0.01;
        d.frame({ at: t, left: raw, right: raw, hasFace: true, pose: { turn: 3, pitch: 2 } });
        if (t % 200 < STEP && d.report().calibration.settled) return t / 1000;
      }
      return Infinity;
    };
    const slow = timeToCalibrate(6);
    ok('a slow blinker is calibrated well inside a gallery visit',
       slow < 15, `${slow.toFixed(1)}s at 6 blinks/min`);
    const typical = timeToCalibrate(15);
    ok('and a typical one within a few seconds',
       typical < 7, `${typical.toFixed(1)}s at 15 blinks/min`);
  }

  // Every signal must work AGAIN, and again, for as long as they stay. The
  // failure this guards: re-arming re-opened the guard that stops a burst
  // teaching the baseline, so each rapid burst taught its own 0.4s gaps as the
  // person's normal rate. baselineIbi collapsed toward 400ms, the rapid ceiling
  // (half of it) fell below any human blink interval, and rapid died for the
  // rest of the visit — after firing perfectly the first time.
  {
    let rseed = 5;
    const rrnd = () => ((rseed = (rseed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const settled = () => {
      const d = createDiscovery(CFG);
      const st = [];
      for (let t = 1000; t < 30000; t += 3200) st.push(t);
      for (let t = 0; t < 30000; t += STEP) {
        let v = 0;
        for (const x of st) v = Math.max(v, blinkAt(x, t, 150));
        const raw = 0.04 + 0.76 * v + rrnd() * 0.01;
        d.frame({ at: t, left: raw, right: raw, hasFace: true, pose: { turn: 3, pitch: 2 } });
      }
      return d;
    };
    const repeat = (label, perform) => {
      const d = settled();
      let at = 30000, fired = 0;
      for (let n = 0; n < 8; n++) {
        at = perform(d, at);
        if (d.report().discovered) fired += 1;
        d.rearm();
        for (let t = at; t < at + 1200; t += STEP) {
          d.frame({ at: t, left: 0.05, right: 0.05, hasFace: true, pose: { turn: 3, pitch: 2 } });
        }
        at += 1200;
      }
      ok(`${label} works every time, not just the first`, fired === 8, `${fired}/8`);
      return d;
    };

    const d = repeat('rapid blinking', (d, at) => {
      const b = [];
      for (let i = 0; i < 6; i++) b.push(at + 300 + i * 430);
      for (let t = at; t < at + 3600; t += STEP) {
        let v = 0;
        for (const x of b) v = Math.max(v, blinkAt(x, t, 150));
        const raw = 0.04 + 0.76 * v + rrnd() * 0.01;
        d.frame({ at: t, left: raw, right: raw, hasFace: true, pose: { turn: 3, pitch: 2 } });
      }
      return at + 3600;
    });
    ok('and their own blink rate was never taught the burst',
       d.report().baseline.ibi > 2000, `${Math.round(d.report().baseline.ibi)}ms`);

    repeat('eyes held shut', (d, at) => {
      const s = at + 400;
      for (let t = at; t < at + 3000; t += STEP) {
        const u = t - s;
        let v = 0;
        if (u >= 0) v = u < 60 ? u / 60 : u < 1060 ? 1 : ((u - 1060) / 70 < 1 ? 1 - (u - 1060) / 70 : 0);
        const raw = 0.04 + 0.76 * v + rrnd() * 0.01;
        d.frame({ at: t, left: raw, right: raw, hasFace: true, pose: { turn: 3, pitch: 2 } });
      }
      return at + 3000;
    });

    repeat('a held squint', (d, at) => {
      for (let t = at; t < at + 2500; t += STEP) {
        const on = t >= at + 300 && t < at + 1600;
        const raw = 0.04 + 0.76 * (on ? 0.55 : 0) + rrnd() * 0.01;
        d.frame({ at: t, left: raw, right: raw, hasFace: true, pose: { turn: 3, pitch: 2 } });
      }
      return at + 2500;
    });
  }

  // Weights are readable as "what one performance is worth".
  ok('shape alone stays corroboration, never proof',
     CFG.weights.shape < CFG.discovered);
  ok('every other signal alone clears the bar',
     ['rapid', 'hold', 'wink', 'squint'].every((c) => CFG.weights[c] >= CFG.discovered));

  // The bands that used to overlap, which is what silenced squint entirely.
  ok('a closure and a squint can no longer be the same thing',
     CFG.squintBand[1] < CFG.closeEnter,
     `squint tops out at ${CFG.squintBand[1]}, shut starts at ${CFG.closeEnter}`);
}

console.log(failures === 0 ? '\nall passed\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
