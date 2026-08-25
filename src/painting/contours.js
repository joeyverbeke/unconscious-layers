// Person-mask contour extraction and arc-length walking.
//
// Lifted out of the 04-01 sketch so the canvas dimensions are parameters
// rather than module constants — the painting canvas is now viewport-sized.

/**
 * Walk the directed pixel edges of a binary mask into closed loops, scaled
 * from mask space into canvas space.
 *
 * @param {Uint8Array} mask       maskWidth*maskHeight, non-zero = person
 * @param {number} maskWidth
 * @param {number} maskHeight
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {number} minPerimeter   in canvas px; loops shorter than this are noise
 * @returns {Array<Array<{x:number,y:number}>>} outer contours only
 */
export function extractContours(
  mask,
  maskWidth,
  maskHeight,
  canvasWidth,
  canvasHeight,
  minPerimeter,
) {
  const edges = [];
  const outgoingEdges = new Map();

  // Vertex keys are integers, not `${x},${y}` template strings. Vertices run
  // 0..maskWidth inclusive, so the row stride is maskWidth + 1. At 15 mask
  // frames a second this walk touches a few thousand edges per frame; string
  // keys made it allocate up to ~90k short-lived strings a second, which shows
  // up as GC sawtooth on low-power hardware.
  const vertexKey = (x, y) => y * (maskWidth + 1) + x;

  const addEdge = (startX, startY, endX, endY) => {
    const edge = {
      startX,
      startY,
      endX,
      endY,
      startKey: vertexKey(startX, startY),
      endKey: vertexKey(endX, endY),
      used: false,
    };
    edges.push(edge);
    const outgoing = outgoingEdges.get(edge.startKey);
    if (outgoing) outgoing.push(edge);
    else outgoingEdges.set(edge.startKey, [edge]);
  };

  for (let y = 0; y < maskHeight; y += 1) {
    for (let x = 0; x < maskWidth; x += 1) {
      const index = y * maskWidth + x;
      if (!mask[index]) continue;

      if (y === 0 || !mask[index - maskWidth]) addEdge(x, y, x + 1, y);
      if (x === maskWidth - 1 || !mask[index + 1]) addEdge(x + 1, y, x + 1, y + 1);
      if (y === maskHeight - 1 || !mask[index + maskWidth]) addEdge(x + 1, y + 1, x, y + 1);
      if (x === 0 || !mask[index - 1]) addEdge(x, y + 1, x, y);
    }
  }

  const scaleX = canvasWidth / maskWidth;
  const scaleY = canvasHeight / maskHeight;
  const contours = [];

  for (const firstEdge of edges) {
    if (firstEdge.used) continue;
    const contour = [];
    let edge = firstEdge;
    let safety = 0;

    while (edge && !edge.used && safety <= edges.length) {
      edge.used = true;
      contour.push({ x: edge.startX * scaleX, y: edge.startY * scaleY });
      safety += 1;

      if (edge.endKey === firstEdge.startKey) break;
      const outgoing = outgoingEdges.get(edge.endKey);
      edge = outgoing ? outgoing.find((candidate) => !candidate.used) : undefined;
    }

    if (isOuterPersonContour(contour, minPerimeter)) contours.push(contour);
  }

  return contours;
}

export function isOuterPersonContour(contour, minPerimeter) {
  // Counts mask-space edges, and the mask resolution is fixed regardless of
  // display size — so this threshold is NOT scaled.
  if (contour.length < 8) return false;

  let twiceSignedArea = 0;
  let perimeter = 0;
  for (let i = 0; i < contour.length; i += 1) {
    const point = contour[i];
    const next = contour[(i + 1) % contour.length];
    twiceSignedArea += point.x * next.y - next.x * point.y;
    perimeter += Math.hypot(next.x - point.x, next.y - point.y);
  }

  // Directed pixel edges make exterior boundaries clockwise (positive in
  // screen coordinates); negative loops are holes inside the person mask.
  return twiceSignedArea > 0 && perimeter >= minPerimeter;
}

export function createContourMetric(points) {
  const cumulative = new Float32Array(points.length + 1);
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    cumulative[i + 1] = cumulative[i] + Math.hypot(next.x - points[i].x, next.y - points[i].y);
  }
  return { points, cumulative, length: cumulative[cumulative.length - 1] };
}

export function pointAlongContour(metric, rawDistance) {
  if (metric.length <= 0 || metric.points.length === 0) return { x: 0, y: 0 };

  const distance = positiveModulo(rawDistance, metric.length);
  let low = 0;
  let high = metric.points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (metric.cumulative[middle + 1] <= distance) low = middle + 1;
    else high = middle;
  }

  const index = Math.min(low, metric.points.length - 1);
  const start = metric.points[index];
  const end = metric.points[(index + 1) % metric.points.length];
  const segmentStart = metric.cumulative[index];
  const segmentLength = metric.cumulative[index + 1] - segmentStart;
  const localT = segmentLength > 0 ? (distance - segmentStart) / segmentLength : 0;
  return {
    x: start.x + (end.x - start.x) * localT,
    y: start.y + (end.y - start.y) * localT,
  };
}

export function findNearestContourLocation(contourMetrics, targetX, targetY) {
  let best = { contourIndex: 0, t: 0, squaredDistance: Infinity };
  for (let contourIndex = 0; contourIndex < contourMetrics.length; contourIndex += 1) {
    const metric = contourMetrics[contourIndex];
    for (let pointIndex = 0; pointIndex < metric.points.length; pointIndex += 1) {
      const point = metric.points[pointIndex];
      const dx = point.x - targetX;
      const dy = point.y - targetY;
      const squaredDistance = dx * dx + dy * dy;
      if (squaredDistance < best.squaredDistance) {
        best = {
          contourIndex,
          t: metric.length > 0 ? metric.cumulative[pointIndex] / metric.length : 0,
          squaredDistance,
        };
      }
    }
  }
  return best;
}

export function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}
