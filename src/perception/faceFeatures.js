import { FaceLandmarker } from "./vision.js";
import { getCoverCrop } from "./personMask.js";

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

const CULL_MARGIN = 20; // reference px

/**
 * Landmarks -> canvas-space points, mirrored, through the SAME cover-crop the
 * person mask uses. At 16:9 the two crops coincide, so the body outline and
 * the eyes/mouth finally land in one coordinate space.
 */
export function mapFaceFeatures(landmarks, video, canvasWidth, canvasHeight, margin = CULL_MARGIN) {
  if (!landmarks) return [];

  const crop = getCoverCrop(video.videoWidth, video.videoHeight, canvasWidth, canvasHeight);
  const points = [];

  for (const landmarkIndices of FACE_FEATURE_INDEX_GROUPS) {
    for (const index of landmarkIndices) {
      const landmark = landmarks[index];
      if (!landmark) continue;
      const videoX = landmark.x * video.videoWidth;
      const videoY = landmark.y * video.videoHeight;
      const x = (1 - (videoX - crop.x) / crop.width) * canvasWidth;
      const y = ((videoY - crop.y) / crop.height) * canvasHeight;

      if (x >= -margin && x <= canvasWidth + margin && y >= -margin && y <= canvasHeight + margin) {
        points.push({ x, y });
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
