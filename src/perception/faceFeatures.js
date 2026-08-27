import { FaceLandmarker } from "./vision.js";


// Eyes and lips only — the features the painting draws.
export const FACE_FEATURE_CONNECTIONS = Object.freeze([
  FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
  FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  FaceLandmarker.FACE_LANDMARKS_LIPS,
]);

export const FACE_FEATURE_INDEX_GROUPS = Object.freeze(
  FACE_FEATURE_CONNECTIONS.map((connections) => {
    const indices = [];
    const seen = new Set();
    for (const connection of connections) {
      for (const index of [connection.start, connection.end]) {
        if (seen.has(index)) continue;
        seen.add(index);
        indices.push(index);
      }
    }
    return Object.freeze(indices);
  }),
);

// A deliberately sparse face: the outline of the head, the ridge and base of
// the nose, the eyes and the lips. Not all 478 landmarks — the point is a few
// marks that read as a face, not a mesh.
const FACE_OVAL_LANDMARKS = Object.freeze([
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365,
  379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234,
  127, 162, 21, 54, 103, 67, 109,
]);
const NOSE_LANDMARKS = Object.freeze([
  168, 6, 197, 195, 5, 4, 1, 2, 98, 97, 326, 327,
]);

export const FACE_LANDMARK_GROUPS = Object.freeze([
  ...FACE_FEATURE_INDEX_GROUPS,   // left eye, right eye, lips
  NOSE_LANDMARKS,
  FACE_OVAL_LANDMARKS,
]);

// Marks on the eyes and lips read larger than marks tracing the jaw, so the
// face does not dissolve into an even scatter of identical dots.
const FACE_GROUP_SCALES = Object.freeze([1.15, 1.15, 1.15, 0.9, 0.75]);

const CULL_MARGIN = 20; // reference px

/**
 * Mirrored centre-crop from camera space to canvas space. Lived in
 * personMask.js until segmentation was removed; the face is the only thing
 * that needs it now.
 */
export function getCoverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;

  if (sourceAspect > targetAspect) {
    const width = sourceHeight * targetAspect;
    return { x: (sourceWidth - width) / 2, y: 0, width, height: sourceHeight };
  }
  const height = sourceWidth / targetAspect;
  return { x: 0, y: (sourceHeight - height) / 2, width: sourceWidth, height };
}

/**
 * Landmarks -> canvas-space points, mirrored. Each point carries the size
 * emphasis of the feature it belongs to.
 */
export function mapFaceFeatures(landmarks, video, canvasWidth, canvasHeight, margin = CULL_MARGIN) {
  if (!landmarks) return [];

  const crop = getCoverCrop(video.videoWidth, video.videoHeight, canvasWidth, canvasHeight);
  const points = [];

  for (let groupIndex = 0; groupIndex < FACE_LANDMARK_GROUPS.length; groupIndex += 1) {
    const scale = FACE_GROUP_SCALES[groupIndex];
    for (const index of FACE_LANDMARK_GROUPS[groupIndex]) {
      const landmark = landmarks[index];
      if (!landmark) continue;
      const videoX = landmark.x * video.videoWidth;
      const videoY = landmark.y * video.videoHeight;
      const x = (1 - (videoX - crop.x) / crop.width) * canvasWidth;
      const y = ((videoY - crop.y) / crop.height) * canvasHeight;

      if (x >= -margin && x <= canvasWidth + margin && y >= -margin && y <= canvasHeight + margin) {
        points.push({ x, y, scale });
      }
    }
  }

  return points;
}

/**
 * How large the face is on screen, as its bounding-box diagonal over the frame
 * diagonal. This is the proximity signal: mask coverage cannot tell one person
 * standing close from three standing far away.
 *
 * @returns {number} 0 when there is no face
 */
export function faceScaleOf(landmarks) {
  if (!landmarks || landmarks.length === 0) return 0;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of landmarks) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  // Landmarks are normalised to the frame, so this is already a fraction of it.
  return Math.hypot(maxX - minX, maxY - minY) / Math.SQRT2;
}
