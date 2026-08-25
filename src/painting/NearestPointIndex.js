export class NearestPointIndex {
  constructor(points) {
    this.points = points;
    const indices = points.map((_, index) => index);
    this.root = buildTree(points, indices, 0);
  }

  findAvailable(pointUsage, pointCapacity, targetX, targetY) {
    let closestIndex = -1;
    let closestSquaredDistance = Infinity;

    const visit = (node) => {
      if (!node) return;

      const point = this.points[node.pointIndex];
      const axisDelta =
        node.axis === 0 ? targetX - point.x : targetY - point.y;
      const nearNode = axisDelta <= 0 ? node.left : node.right;
      const farNode = axisDelta <= 0 ? node.right : node.left;

      visit(nearNode);

      if (pointUsage[node.pointIndex] < pointCapacity) {
        const dx = point.x - targetX;
        const dy = point.y - targetY;
        const squaredDistance = dx * dx + dy * dy;
        if (
          squaredDistance < closestSquaredDistance ||
          (squaredDistance === closestSquaredDistance &&
            node.pointIndex < closestIndex)
        ) {
          closestSquaredDistance = squaredDistance;
          closestIndex = node.pointIndex;
        }
      }

      if (axisDelta * axisDelta <= closestSquaredDistance) {
        visit(farNode);
      }
    };

    visit(this.root);
    return closestIndex >= 0 ? closestIndex : 0;
  }
}

function buildTree(points, indices, depth) {
  if (indices.length === 0) return null;

  const axis = depth % 2;
  const coordinate = axis === 0 ? "x" : "y";
  indices.sort(
    (first, second) =>
      points[first][coordinate] - points[second][coordinate] || first - second,
  );

  const middle = Math.floor(indices.length / 2);
  return {
    pointIndex: indices[middle],
    axis,
    left: buildTree(points, indices.slice(0, middle), depth + 1),
    right: buildTree(points, indices.slice(middle + 1), depth + 1),
  };
}
