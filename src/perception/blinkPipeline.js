import { createEyeNormalizer } from "./blink/normalize.js";
import { readFace } from "./blink/gates.js";
import { createBlinkDetector } from "./blink/detector.js";

/**
 * normalize -> readFace -> detector. This is the body of repo B's
 * blink/index.js lines 109-125, lifted unchanged; everything that file did
 * besides this was owning a camera and a FaceLandmarker, which the perception
 * hub now owns instead.
 *
 * UNITS, deliberately: the detector is fed NORMALIZED closure here, matching
 * what the shipped eyes-closed piece did. Repo B's blink-tracking bench page
 * feeds it RAW blendshape scores and therefore reads slightly hotter — so
 * thresholds tuned on that bench do not transfer one-for-one to this piece.
 */
export function createBlinkPipeline({ config = {}, normalize = true } = {}) {
  const normalizer = createEyeNormalizer();
  const detector = createBlinkDetector(config);
  let normalizeOn = normalize;

  function frame({ left, right, points, matrix, at, hasFace }) {
    const closure = normalizeOn
      ? normalizer.map({ left, right, at, hasFace })
      : { left, right };

    const face = readFace(points, matrix);
    const result = detector.frame({
      left: closure.left,
      right: closure.right,
      face,
      at,
      hasFace,
    });

    return { ...result, closure, face, levels: normalizer.levels() };
  }

  return {
    frame,
    detector,
    normalizer,
    config: detector.config,
    blocked: detector.blocked,
    setNormalize: (on) => { normalizeOn = on; },
  };
}
