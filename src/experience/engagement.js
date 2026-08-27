/**
 * Is somebody engaging with the piece, as opposed to merely being in the room?
 *
 * One signal: how large their face is on screen. That is a real proximity
 * proxy — it grows as somebody walks up — and it cannot promise a blink
 * interaction before there is a face to read blinks from.
 *
 * Mask coverage used to be required alongside it. Segmentation is gone, and it
 * was the weaker half anyway: coverage conflates one person standing close with
 * three standing far away.
 *
 * Separate enter/exit thresholds give hysteresis; the dwell timers stop
 * somebody walking past from tripping it.
 */
export function createEngagement({ settings, onChange = () => {} }) {
  let engaged = false;
  let faceScale = 0;
  let hasFace = false;
  let candidateSince = null; // when the gate first disagreed with `engaged`
  let lastReason = "no one";

  function qualifies() {
    // Entering demands both signals over their ENTER thresholds; staying only
    // demands they remain over the lower EXIT thresholds.
    if (engaged) {
      return hasFace && faceScale >= settings.exitFaceScale;
    }
    return hasFace && faceScale >= settings.enterFaceScale;
  }

  function describe(passing) {
    if (passing) return engaged ? "engaged" : "approaching";
    if (!hasFace) return "no face";
    if (faceScale < (engaged ? settings.exitFaceScale : settings.enterFaceScale)) return "too far";
    return "too little of them";
  }

  function evaluate(at) {
    const passing = qualifies();
    lastReason = describe(passing);

    if (passing === engaged) {
      candidateSince = null;
      return;
    }

    if (candidateSince === null) {
      candidateSince = at;
      return;
    }

    const dwell = passing ? settings.engageDwellMs : settings.disengageDwellMs;
    if (at - candidateSince < dwell) return;

    engaged = passing;
    candidateSince = null;
    onChange({ engaged, reason: lastReason, faceScale });
  }

  return {
    updateFace({ hasFace: nextHasFace, scale, at }) {
      hasFace = nextHasFace;
      faceScale = nextHasFace ? scale : 0;
      evaluate(at);
    },
    reset() {
      engaged = false;
      candidateSince = null;
      faceScale = 0;
      hasFace = false;
    },
    get engaged() { return engaged; },
    get snapshot() {
      return {
        engaged,
        faceScale,
        hasFace,
        reason: lastReason,
        holdMs: candidateSince === null ? 0 : performance.now() - candidateSince,
      };
    },
  };
}
