// How this project's settings map onto the tuning knobs of repo B's blink core.
//
// Pure and dependency-free on purpose: perception.js pulls in MediaPipe, so
// anything importing it cannot run under node. Keeping the mapping here lets
// scripts/pipeline-check.js validate THE TUNING THE PIECE ACTUALLY USES rather
// than a copy of it that can drift.

export function mapBlinkSettings(settings) {
  return {
    enter: settings.blinkEnter,
    exit: settings.blinkExit,
    lead: settings.blinkLead,
    smooth: settings.blinkSmooth,
    slopeSmoothing: settings.blinkSlopeSmoothing,
    minSpeed: settings.blinkMinSpeed,
    minVisible: settings.blinkMinVisible,
    maxTurn: settings.blinkMaxTurn,
    maxPartialMs: settings.blinkMaxPartialMs,
    bothEyes: settings.blinkBothEyes,
    gates: settings.blinkGates,
  };
}

export function mapDiscoverySettings(settings) {
  return {
    suspect: settings.discoverySuspect,
    discovered: settings.discoveryDiscovered,
    tauMs: settings.discoveryTauMs,
    rapidMaxMs: settings.discoveryRapidMaxMs,
    rapidMinRun: settings.discoveryRapidMinRun,
    holdMinMs: settings.discoveryHoldMinMs,
    holdFullMs: settings.discoveryHoldFullMs,
    // Same ramp for a crept closure as a snapped one: a second of deliberate
    // eyes-closed is enough however they got there.
    squintMinMs: settings.discoveryHoldMinMs,
    squintFullMs: settings.discoveryHoldFullMs,
    calibrationMs: settings.discoveryCalibrationMs,
    calibrationBlinks: settings.discoveryCalibrationBlinks,
    // Reaches into the normalizer discovery builds for itself.
    normalizer: { minPeaks: settings.discoveryMinPeaks },
    closeEnter: settings.discoveryCloseEnter,
    closeExit: settings.discoveryCloseExit,
    squintBand: [settings.discoverySquintBandLow, settings.discoverySquintBandHigh],

    // Gains flat at 1.0 so ONE clear performance saturates its channel, which
    // leaves the weight below as the whole story: the score that performance
    // earns. Noisy-OR still combines them, so two signals read stronger than
    // one — but one is now allowed to be enough.
    gains: { rapid: 1, shape: 0.6, hold: 1, wink: 1, squint: 1 },
    weights: {
      rapid: settings.discoveryWeightRapid,
      shape: settings.discoveryWeightShape,
      hold: settings.discoveryWeightHold,
      wink: settings.discoveryWeightWink,
      squint: settings.discoveryWeightSquint,
    },
    // Left at repo B's default. The state machine resets the determiner
    // explicitly — when the sentence comes down, and when they leave — so this
    // is only a backstop for a face that vanishes without the gate noticing.
  };
}
