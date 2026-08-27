import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// One place for every MediaPipe path. /mediapipe/wasm resolves identically in
// dev and in a build (see vite.config.js) — there is deliberately no
// import.meta.env.DEV branch, because that is what shipped a dead build before.
const WASM_BASE = "/mediapipe/wasm";
const FACE_MODEL = "/models/face_landmarker.task";

let filesetPromise = null;

/** One fileset, shared by both tasks. */
export function loadVision() {
  filesetPromise ??= FilesetResolver.forVisionTasks(WASM_BASE);
  return filesetPromise;
}

// Instantiation counter. There must be exactly ONE FaceLandmarker for the
// whole page: the model is the expensive thing, not the camera stream.
// pipeline-check asserts this.
export const modelCounts = { faceLandmarker: 0 };

async function withDelegateFallback(create, preferred, label) {
  try {
    return { task: await create(preferred), delegate: preferred };
  } catch (error) {
    if (preferred === "CPU") throw error;
    // The GPU path needs WebGL2 with particular extensions. On small-SoC
    // hardware it may simply fail here, and CPU is often competitive anyway.
    console.warn(`${label}: GPU delegate unavailable, falling back to CPU.`, error);
    return { task: await create("CPU"), delegate: "CPU" };
  }
}

export async function createFaceLandmarker({ delegate = "GPU" } = {}) {
  const vision = await loadVision();
  const result = await withDelegateFallback(
    (d) =>
      FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: d },
        runningMode: "VIDEO",
        numFaces: 1,
        // The local model bundle already contains the blendshape sub-model, so
        // no CDN and no remote model URL are needed. eyeBlinkLeft/Right come
        // from here; the transformation matrix is what the turn gate reads.
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      }),
    delegate,
    "FaceLandmarker",
  );
  modelCounts.faceLandmarker += 1;
  return result;
}


export { FaceLandmarker };
