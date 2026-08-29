/**
 * Which landmark each borrowed mark is sent to.
 *
 * Pure and p5-free so it can be tested headlessly — the bug it exists to
 * prevent is invisible until you look at a face and notice the jaw is missing.
 *
 * The rule has to satisfy two things at once:
 *
 *   - when there are at least as many marks as landmarks, EVERY landmark must
 *     get one before any landmark gets a second;
 *   - when there are fewer marks than landmarks (a small pool, or a painting
 *     with nothing small enough to borrow), the marks that do exist must be
 *     spread evenly across the whole face rather than filling it from the
 *     start and leaving the tail bare.
 *
 * The second case matters more than it sounds: the landmark groups are ordered
 * eyes, lips, nose, oval, so "filling from the start" means the head outline —
 * the largest group, 36 of 120 points — is what disappears.
 */
export function faceLandmarkIndex(markIndex, markCount, pointCount) {
  if (pointCount <= 0 || markCount <= 0) return 0;
  return markCount >= pointCount
    ? markIndex % pointCount
    : Math.floor((markIndex * pointCount) / markCount);
}
