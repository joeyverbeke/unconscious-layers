// What has to be true before a closure counts as a blink.
//
// The eye-closed score alone cannot tell a blink from three other things people
// do in front of these pieces, two of them on purpose:
//
//   one eye     the detector used to take the *larger* of the two eye scores, so
//               a wink read exactly like a blink. Taking the smaller means both
//               lids have to be down. Nearly free, and it quietly helps with the
//               head turn as well — when the far eye is occluded its score climbs
//               on its own, and the near eye holds the minimum down.
//
//   squinting   people work out that a slow enough squint reads as closed and
//               hold it there. There is no separate squint signal to read, but
//               there is a difference in the movement: a blink shuts in 50-70ms,
//               a deliberate squint ramps over several hundred. So the gate is on
//               *speed* at the moment of crossing, not on any level.
//
//   turning away  the worst of them, and the reason the eyes have to be known to
//               be *there* rather than merely scoring high. As a head turns, the
//               far eye is occluded and its score climbs by itself. `visible`
//               compares how far each eye's outer corner sits from the bridge of
//               the nose — level when facing the camera, lopsided as soon as it
//               turns. Read straight off the landmarks, so it does not depend on
//               getting a rotation-matrix convention right. `turn`, which does,
//               is the looser second opinion.
//
// Every gate is switchable and every rejection is counted, because a gate that
// quietly eats real blinks is worse than the false positive it was put in to
// stop.
//
// Speeds are in closure units per millisecond. Closure is normalised — 0 is this
// person's open eye and 1 their shut one — so a real blink runs about 0.017 and a
// deliberate squint about 0.001, on every face rather than only canonical ones.
//
// Deliberately free of imports, like the rest of this folder.

export const GATE_DEFAULTS = {
  bothEyes: true,     // both lids down, not either
  // Squints creep; blinks snap. Measured rather than picked — see the sweep in
  // the README. At 0.004 a squint that creeps to 0.6 over a quarter-second gets
  // through 13% of the time instead of 82%, and it costs ordinary blinks nothing
  // measurable: a 200ms tired blink still passes 98% of the time, because a blink
  // goes all the way to shut while a squint stops short, so the blink's slope is
  // the higher one even when it takes longer.
  //
  // What is left over is the fast, deep squint — 0.7 in 150ms. That is
  // kinematically a blink that does not finish, and no speed threshold separates
  // it; it would take waiting to see how far the lid travelled, which is latency
  // this cannot afford.
  minSpeed: 0.004,
  minVisible: 0.55,   // how square-on the face has to be
  maxTurn: 45,        // degrees off the camera axis, the second opinion
};

// Landmarks. The eye rings are for drawing; the three in FACING are measured.
export const RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
export const LEFT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
export const RIGHT_IRIS = [468, 469, 470, 471, 472];
export const LEFT_IRIS = [473, 474, 475, 476, 477];
export const FACING = { bridge: 168, rightCorner: 33, leftCorner: 263 };

// How square-on the face is, straight off the landmarks. The bridge of the nose
// sits between the two outer eye corners; facing the camera the two gaps are the
// same, and turning makes one collapse. No camera calibration and no rotation
// convention involved — just which of two distances is smaller.
export function facing(points) {
  const bridge = points?.[FACING.bridge];
  const right = points?.[FACING.rightCorner];
  const left = points?.[FACING.leftCorner];
  if (!bridge || !right || !left) return 0;
  const a = Math.abs(bridge.x - right.x);
  const b = Math.abs(left.x - bridge.x);
  const wide = Math.max(a, b);
  return wide > 0 ? Math.min(a, b) / wide : 0;
}

// The second opinion, from the model's own head pose. The third column of the
// rotation part is where the head is pointing, in camera space; how far that is
// off the camera axis is the turn. Reported as well as used, because the sign
// conventions are worth checking against a real head before trusting them.
export function headPose(matrix) {
  const m = matrix?.data;
  if (!m) return null;
  const [fx, fy, fz] = [m[8], m[9], m[10]];
  const length = Math.hypot(fx, fy, fz) || 1;
  return {
    yaw: (Math.atan2(fx, Math.abs(fz)) * 180) / Math.PI,
    pitch: (Math.atan2(-fy, Math.hypot(fx, fz)) * 180) / Math.PI,
    turn: (Math.acos(Math.min(1, Math.abs(fz) / length)) * 180) / Math.PI,
  };
}

// Everything a gate decision needs, worked out once per frame.
export function readFace(points, matrix) {
  if (!points) return null;
  return { visible: facing(points), ...(headPose(matrix) ?? { yaw: null, pitch: null, turn: null }) };
}

// The whole of the one-eye fix, in one line: the smaller of the two, so a wink
// cannot pass as a blink. No face is treated as eyes open.
export const combine = (left, right, bothEyes = true) =>
  bothEyes ? Math.min(left, right) : Math.max(left, right);

// Called once, at the moment a closure would start. Returns null to let it
// through, or the reason it was turned down.
export function checkGates({ face, speed, config }) {
  if (!config.enabled) return null;
  if (!face) return 'no face';
  if (face.visible < config.minVisible) return 'turned away';
  if (face.turn !== null && face.turn > config.maxTurn) return 'turned away';
  // Speed is checked last so the readout blames the head before the lids.
  if (speed < config.minSpeed) return 'too slow';
  return null;
}
