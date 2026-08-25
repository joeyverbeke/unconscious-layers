// The blink state machine — the one that decides whether a closure counts.
//
// This is the loop that was developed and tuned on the blink-tracking method
// page, lifted out of it unchanged so that the page and every experiment run the
// same code rather than two implementations that drift apart. The page keeps only
// its trace and its sliders; the decisions all happen here.
//
// It is a pure function of per-frame numbers — no camera, no DOM, no model — so
// it can be driven from a real landmarker or from a test.
//
//   const detector = createBlinkDetector();
//   const result = detector.frame({ left, right, face, at });
//   if (result.changed) ...           // result.closed is the new state
//
// What it does, in the order it does it:
//
//   combine     the smaller of the two eye scores, so a wink cannot pass as a
//               blink. This is why one-eye rejection works: a winking eye never
//               moves the minimum.
//   smooth      optional; off by default, because smoothing costs latency at the
//               one moment latency is being fought.
//   velocity    the slope, lightly averaged. A single frame's slope is mostly
//               noise, and the squint gate reads it at exactly one instant.
//   predict     the score extrapolated forward by `lead` ms along that slope, so
//               a crossing is called early enough to pay back the pipeline delay.
//   gate        at the moment of crossing only: both lids down, fast enough to be
//               a blink rather than a squint, eyes visibly there. One decision per
//               closure — a closure the gates turned down stays turned down until
//               the eye opens again, which is what should happen to a held squint.
//   release     when the score has been all the way up and fallen back past `exit`,
//               or dropped under `enter` outright. Arming on the peak rather than
//               on a negative slope matters: the slope is an average and takes a
//               frame or two to change sign, and those frames land exactly on the
//               edge being fixed.

import { GATE_DEFAULTS, combine, checkGates } from './gates.js';

export const DETECTOR_DEFAULTS = {
  ...GATE_DEFAULTS,
  enter: 0.45,      // closure at which a closure begins
  exit: 0.7,        // and, having been above it, at which it is over
  lead: 60,         // ms of extrapolation along the current slope
  smooth: 0,        // 0 is none; it costs latency where latency is the problem
  slopeSmoothing: 0.35,
  gates: true,
  // A blink is over in a fraction of a second and goes all the way shut. A
  // closure that has outlasted that *and* never reached `exit` was not a blink —
  // it is a squint being held. Without this, a squint that slips past the speed
  // gate leaves the image up for as long as it is held, because the release wants
  // a peak it will never see. That is what makes a rare false positive look like
  // a constant one.
  maxPartialMs: 400,
};

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export function createBlinkDetector(overrides = {}) {
  const config = { ...DETECTOR_DEFAULTS, ...overrides };
  const blocked = { turned: 0, slow: 0, wink: 0 };

  let score = 0;
  let velocity = 0;
  let previous = null;
  let previousAt = null;
  let closed = false;
  let latched = false;
  let peak = 0;
  let closedAt = 0;
  let winkArmed = false;
  let reason = null;

  function reset() {
    score = velocity = peak = closedAt = 0;
    previous = previousAt = null;
    closed = latched = winkArmed = false;
    reason = null;
    blocked.turned = blocked.slow = blocked.wink = 0;
  }

  function frame({ left = 0, right = 0, face = null, at, hasFace = true }) {
    const raw = hasFace ? combine(left, right, config.bothEyes) : 0;

    const dt = previousAt === null ? 16 : Math.max(1, at - previousAt);
    score = config.smooth * score + (1 - config.smooth) * raw;
    const instant = previous === null ? 0 : (score - previous) / dt;
    velocity = config.slopeSmoothing * velocity + (1 - config.slopeSmoothing) * instant;
    previous = score;
    previousAt = at;

    const pred = clamp(score + velocity * config.lead, 0, 1.2);
    const was = closed;
    let blockedNow = false;

    if (!closed) {
      if (pred < config.enter) {
        latched = false;
      } else if (!latched) {
        reason = checkGates({
          face,
          speed: velocity,
          config: { ...config, enabled: config.gates },
        });
        if (reason) {
          latched = true;
          blockedNow = true;
          if (reason === 'too slow') blocked.slow += 1;
          else if (reason === 'turned away') blocked.turned += 1;
        } else {
          closed = true;
          closedAt = at;
          peak = pred;
        }
      }
    } else {
      peak = Math.max(peak, pred);
      const heldTooLong =
        peak < config.exit && at - closedAt > config.maxPartialMs;
      if ((peak >= config.exit && pred <= config.exit) || pred <= config.enter || heldTooLong) {
        closed = false;
        latched = true;
        if (heldTooLong) blocked.slow += 1;
      }
    }

    // A wink is not blocked so much as never seen, since taking the smaller score
    // means it never crosses. Counted separately so the rule can be shown to be
    // earning its place.
    const either = Math.max(left, right);
    if (config.bothEyes && config.gates && hasFace) {
      if (!winkArmed && either > config.enter && Math.min(left, right) < config.enter) {
        winkArmed = true;
        blocked.wink += 1;
      } else if (either <= config.enter) {
        winkArmed = false;
      }
    }

    return {
      closed,
      changed: closed !== was,
      value: raw,
      score,
      pred,
      velocity,
      blockedNow,
      reason: blockedNow ? reason : null,
      blocked,
    };
  }

  return { frame, reset, config, blocked };
}
