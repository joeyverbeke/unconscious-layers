// Every tunable in one place.
//
// Pixel-denominated values are authored at the reference resolution
// (1280x720, see src/painting/scale.js) and converted at the point of use.
// Keys are FLAT so the debug panel's existing validation works untouched.

export const DEFAULT_SETTINGS = Object.freeze({
  // ---- painting -----------------------------------------------------------
  objectCount: 22000,
  primitivesPerSecond: 45,
  maxTyphoonSize: 250,

  // Directional families: bias most gestures onto one of two opposing
  // diagonals, leaving the rest to wander as before. Per GESTURE, not per mark.
  directionalFamilyPercent: 80,
  directionAngleVariationDegrees: 5,
  // Authored at the 1280x720 reference, like every other pixel value.
  directionObjectVariation: 2,
  stainBlendWeight: 10,
  normalBlendWeight: 60,
  highlightBlendWeight: 30,
  stainSizeMultiplier: 1.8,
  stainOpacityLowPercent: 10,
  stainOpacityHighPercent: 35,
  highlightOpacityLowPercent: 1,
  highlightOpacityHighPercent: 20,

  // ---- tracked forms ------------------------------------------------------
  maxFaceObjects: 300,
  // How fast a borrowed mark travels to the landmark it was assigned.
  outlineApproachSpeedPixelsPerSecond: 350,
  // Largest existing mark that may be borrowed to build the face.
  maxOutlineObjectSize: 18,
  objectsPerFaceLandmark: 2,
  perimeterMinSize: 2,
  perimeterMaxSize: 15,
  perimeterSizeVariability: 1,
  drawFaceLandmarks: true,

  // ---- motion -------------------------------------------------------------
  positionEasePerFrame: 0.14,

  // ---- colour -------------------------------------------------------------
  backgroundColor: "#00070a",
  colors: [
    "#000000",
    "#383838",
    "#757575",
    "#2e2c35",
    "#675b71",
    "#adadad",
    "#b0b0b0",
    "#251c13",
    "#0b0019",
  ],

  // ---- engagement (step 2) ------------------------------------------------
  // Coverage is a fraction of the 320x180 mask. Face scale is the face
  // bounding-box diagonal over the crop diagonal, and is the real proximity
  // signal — coverage alone cannot tell one person close from several far.
  enterFaceScale: 0.22, // CALIBRATE ON SITE — depends on lens FOV and distance
  exitFaceScale: 0.17,
  engageDwellMs: 600,
  disengageDwellMs: 900,

  // ---- blink (step 4) -----------------------------------------------------
  blinkEnter: 0.45,
  blinkExit: 0.7,
  blinkLead: 60,
  blinkSmooth: 0,
  blinkSlopeSmoothing: 0.35,
  blinkMinSpeed: 0.004,
  blinkMinVisible: 0.55,
  blinkMaxTurn: 45,
  blinkMaxPartialMs: 400,
  blinkGates: true,
  blinkBothEyes: true,
  blinkNormalize: true,

  // ---- discovery (step 5) -------------------------------------------------
  discoverySuspect: 0.35,
  discoveryDiscovered: 0.7,
  // Once they have shown they know, asking for as much proof a second time is
  // asking them to convince a machine that is already convinced. Applied by
  // perception.js the moment the determiner is re-armed.
  // 0.55, not lower, and the number is measured rather than chosen: across 98
  // simulated ordinary visitor-minutes the highest score anyone reached WITHOUT
  // trying anything was 0.51. A bar of 0.50 fires on 1% of ordinary visitors,
  // 0.45 on 2%, 0.40 on 3%; 0.55 is the lowest bar that never did.
  discoveryRetrigger: 0.55,
  discoveryTauMs: 25000,
  discoveryRapidMaxMs: 900,
  discoveryRapidMinRun: 2,

  // Every gain is 1.0 (set in perception.js), which makes these weights mean
  // something you can hold in your head: THE SCORE ONE CLEAR PERFORMANCE OF
  // THAT SIGNAL EARNS. Above discoveryDiscovered, that signal alone is enough.
  //
  // Upstream, only rapid blinking could do that: a two-second eye-hold reached
  // 0.64 and stopped, and squint's ceiling was 0.65, so no amount of squinting
  // could ever have been enough on its own. Requiring two different kinds of
  // trickery was an assumption, not a finding — somebody who works it out may
  // only ever do the one thing.
  //
  // shape stays deliberately below the bar: blinking unlike your own baseline
  // is corroboration, not intent.
  discoveryWeightRapid: 0.85,
  discoveryWeightHold: 0.88,
  discoveryWeightWink: 0.82,
  discoveryWeightSquint: 0.78,
  discoveryWeightShape: 0.55,

  // One second of eyes held shut is a deliberate act, and plenty. Upstream
  // asked for two seconds to count fully.
  discoveryHoldMinMs: 500,
  discoveryHoldFullMs: 1000,

  // DO NOT RAISE closeEnter to separate closures from squints. It looks like
  // the obvious fix and it silently destroys the piece: normalize.js shrinks a
  // person's "shut" toward the canonical 1.0 with a prior of 6, so a face whose
  // raw eyeBlink tops out below ~0.95 never produces a normalized closure that
  // high. At closeEnter 0.9 a thirty-second visit counted ZERO blinks for every
  // face except the one that happened to read 0.95 — and with no blinks there
  // is no calibration, no baseline, and no rapid channel either.
  //
  // A closure and a squint are told apart by DURATION AND DEPTH, not by level:
  // a closure that outlasts a blink but never gets near shut is a squint. That
  // branch lives in discovery.js, marked in place.
  // HOW SOON hold and squint are allowed to speak. They read absolute lid
  // levels, so they stay silent until the normalizer knows this face — and in a
  // gallery you are lucky to get thirty seconds. Upstream wanted three separate
  // closures before it would believe a "shut" level, which at six blinks a
  // minute is 21 seconds: most of the visit, spent waiting.
  //
  // It buys nothing. shut is shrunk toward the canonical 1.0 with a prior of 6
  // and keeps refining over a rolling window of the last 24 peaks, so the
  // SETTLED estimate is identical whether it started believing after one
  // closure or three — minPeaks only decides when it starts, not where it ends
  // up. Two keeps a little protection against a single freak closure defining
  // the face, and halves the wait to ~11s at six blinks a minute.
  discoveryMinPeaks: 2,
  discoveryCalibrationMs: 3000,
  discoveryCalibrationBlinks: 2,

  discoveryCloseEnter: 0.5,
  discoveryCloseExit: 0.35,
  // The parked detector only runs while NOT already in a closure, so its band
  // belongs below closeEnter: it catches the shallow squint that never crosses.
  discoverySquintBandLow: 0.28,
  discoverySquintBandHigh: 0.48,

  // ---- session (step 6) ---------------------------------------------------
  // With the timer on, the sentence clears on whichever comes first: lingerMs
  // elapsing, or a blink. With it off, only a blink clears it.
  lingerTimerEnabled: true,
  // How long the sentence stays on screen, with the participant still there.
  // Then they are handed back to being drawn, and the determiner is re-armed,
  // so deliberate blinking can summon the sentence again for as long as they
  // stay. Walking away clears everything at once — there is no grace window.
  lingerMs: 5000,
  swapCooldownMs: 400,
  identityTolerance: 0.18,
  identitySwapConfirmMs: 2500,
  identityMinVisible: 0.55,

  // ---- reveal -------------------------------------------------------------
  // The blink inverts the whole screen; the sentence is cut into the painting
  // as a negative. Both are compositor-only — see src/styles/reveal.css.
  blinkInvertEnabled: true,
  revealTextColor: "#7d5fa8",
  eyesClosedWatchdogMs: 3000,

  // ---- performance --------------------------------------------------------
  rotatedSquares: true,
});
