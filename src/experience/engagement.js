/**
 * Is somebody engaging with the piece, as opposed to merely being in the room?
 *
 * Two signals, both required:
 *   coverage   how much of the frame the person's silhouette fills
 *   faceScale  how large their face is on screen — the actual proximity proxy
 *
 * Coverage alone conflates one person standing close with three standing far
 * away, and it can cross its threshold before there is a trackable face at all
 * — which would promise a blink interaction the piece cannot yet detect.
 * Requiring a face of a given size fixes both.
 *
 * Separate enter/exit thresholds give hysteresis; the dwell timers stop
 * somebody walking past from tripping it.
 */
export function createEngagement({ settings, onChange = () => {} }) {
  let engaged = false;
  let coverage = 0;
  let faceScale = 0;
  let hasFace = false;
  let candidateSince = null; // when the gate first disagreed with `engaged`
  let lastReason = "no one";

  function qualifies() {
    // Entering demands both signals over their ENTER thresholds; staying only
    // demands they remain over the lower EXIT thresholds.
    if (engaged) {
      return hasFace && coverage >= settings.exitCoverage && faceScale >= settings.exitFaceScale;
    }
    return hasFace && coverage >= settings.enterCoverage && faceScale >= settings.enterFaceScale;
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
    onChange({ engaged, reason: lastReason, coverage, faceScale });
  }

  return {
    updateCoverage(nextCoverage, at) {
      coverage = nextCoverage;
      evaluate(at);
    },
    updateFace({ hasFace: nextHasFace, scale, at }) {
      hasFace = nextHasFace;
      faceScale = nextHasFace ? scale : 0;
      evaluate(at);
    },
    reset() {
      engaged = false;
      candidateSince = null;
      coverage = 0;
      faceScale = 0;
      hasFace = false;
    },
    get engaged() { return engaged; },
    get snapshot() {
      return {
        engaged,
        coverage,
        faceScale,
        hasFace,
        reason: lastReason,
        holdMs: candidateSince === null ? 0 : performance.now() - candidateSince,
      };
    },
  };
}
