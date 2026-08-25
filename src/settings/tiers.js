// Quality tiers. A tier is a partial overlay applied BEFORE loadSettings()
// hydrates from localStorage, so any individual knob the panel overrides still
// wins and still persists.
export const TIERS = {
  // "high" is the authored look — it matches DEFAULT_SETTINGS exactly, so
  // ?tier=high is a no-op rather than something richer than the piece is meant
  // to be. The ladder only ever steps DOWN from what the work actually is.
  high: {
    objectCount: 22000, primitivesPerSecond: 45, segmentationFps: 15, outlineRetargetHz: 15,
    maxOutlineObjects: 1400, maxFaceObjects: 300, rotatedSquares: true,
  },
  medium: {
    objectCount: 10000, primitivesPerSecond: 22, segmentationFps: 12, outlineRetargetHz: 10,
    maxOutlineObjects: 900, maxFaceObjects: 240, rotatedSquares: true,
  },
  low: {
    objectCount: 5000, primitivesPerSecond: 12, segmentationFps: 8, outlineRetargetHz: 6,
    maxOutlineObjects: 500, maxFaceObjects: 180, rotatedSquares: false,
  },
};

export function applyTier(defaults, flags) {
  const name = flags?.tier && TIERS[flags.tier] ? flags.tier : null;
  if (!name) return defaults;
  return Object.freeze({ ...defaults, ...TIERS[name] });
}

export const TIER_ORDER = ["high", "medium", "low"];

/**
 * Step the quality down ONCE if the piece cannot hold a frame rate early on.
 *
 * One step, one time, and only within the opening window: an installation that
 * oscillates between tiers all evening is worse than one that is simply slow.
 * Pure and clock-injected so it can be tested without waiting a minute.
 */
export function createTierGovernor({
  tier = "high",
  minFps = 24,
  sustainMs = 5000,
  windowMs = 60000,
  // Building the initial pool and compiling the vision models takes seconds,
  // during which the frame rate means nothing. Judging the machine on that
  // stepped perfectly good hardware down before it had drawn anything.
  warmupMs = 8000,
  enabled = true,
  onDowngrade = () => {},
} = {}) {
  let current = tier;
  let belowSince = null;
  let spent = false;
  let startedAt = null;

  return {
    sample(fps, at) {
      if (spent || !enabled) return null;
      startedAt ??= at;

      if (at - startedAt < warmupMs) return null;

      // Only the opening window counts. After that, a slow patch is the piece
      // doing its job with somebody in front of it, not a machine too weak.
      if (at - startedAt > windowMs + warmupMs) { spent = true; return null; }

      // A frame rate of zero means nothing has been drawn yet, not that the
      // machine is failing.
      if (!Number.isFinite(fps) || fps <= 0) return null;

      const index = TIER_ORDER.indexOf(current);
      if (index === TIER_ORDER.length - 1) { spent = true; return null; }

      if (fps >= minFps) { belowSince = null; return null; }

      belowSince ??= at;
      if (at - belowSince < sustainMs) return null;

      current = TIER_ORDER[index + 1];
      spent = true;
      onDowngrade(current, TIERS[current]);
      return current;
    },
    get tier() { return current; },
    get spent() { return spent; },
  };
}
