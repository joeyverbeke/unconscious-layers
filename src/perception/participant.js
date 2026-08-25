// Who is in front of the camera, and when that becomes somebody else.
//
// Two things end a session: the face going away, and the face changing without
// going away. The first is reliable; the second is a heuristic over face
// proportions, deliberately slow to believe itself.

const SIGNATURE = {
  eyes: [33, 263],   // the distance everything else is measured against
  width: [234, 454],
  height: [10, 152],
  mouth: [61, 291],
  nose: [1, 168],
};

// Proportions divided by eye distance, so the signature survives someone
// moving nearer or further away.
export function signature(marks) {
  const gap = (a, b) => Math.hypot(marks[a].x - marks[b].x, marks[a].y - marks[b].y);
  const eyes = gap(...SIGNATURE.eyes);
  if (!eyes) return null;
  return [
    gap(...SIGNATURE.width) / eyes,
    gap(...SIGNATURE.height) / eyes,
    gap(...SIGNATURE.mouth) / eyes,
    gap(...SIGNATURE.nose) / eyes,
  ];
}

export function drift(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    total += Math.abs(a[i] - b[i]) / Math.max(1e-6, Math.abs(b[i]));
  }
  return total / a.length;
}

export function createParticipant({
  absenceEndsSession = 3,   // seconds without a face before the session is over
  identityTolerance = 0.18, // proportion drift that counts as somebody else; 0 disables
  swapConfirm = 1.5,        // seconds of drift before believing it
  onStart = null,
  onEnd = null,
} = {}) {
  const now = () => performance.now() / 1000;

  let startedAt = null;
  let lastSeen = null;
  let baseline = null;
  let driftingSince = null;
  let lastDrift = null;
  let sessionId = 0;

  function end(why) {
    if (startedAt === null) return;
    startedAt = null;
    baseline = null;
    driftingSince = null;
    if (onEnd) onEnd(why, sessionId);
  }

  function saw(marks) {
    const at = now();

    if (!marks) {
      if (startedAt !== null && lastSeen !== null && at - lastSeen > absenceEndsSession) {
        end('left');
      }
      return;
    }

    lastSeen = at;
    if (startedAt === null) {
      startedAt = at;
      sessionId += 1;
      if (onStart) onStart(sessionId);
    }

    if (identityTolerance <= 0) return;

    const shape = signature(marks);
    if (!shape) return;

    if (!baseline) {
      baseline = shape;
      return;
    }

    lastDrift = drift(shape, baseline);
    if (lastDrift > identityTolerance) {
      // Hold the suspicion for a while — a turned head drifts too.
      if (driftingSince === null) driftingSince = at;
      else if (at - driftingSince > swapConfirm) end('swapped');
    } else {
      driftingSince = null;
      // Settle slowly toward the face actually in front of us.
      baseline = baseline.map((v, i) => v * 0.98 + shape[i] * 0.02);
    }
  }

  return {
    saw,
    forget: (why = 'by hand') => end(why),
    get present() { return startedAt !== null; },
    get startedAt() { return startedAt; },
    get elapsed() { return startedAt === null ? null : now() - startedAt; },
    get sessionId() { return sessionId; },
    get drift() { return lastDrift; },
  };
}
