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
  stainBlendWeight: 10,
  normalBlendWeight: 60,
  highlightBlendWeight: 30,
  stainSizeMultiplier: 1.8,
  stainOpacityLowPercent: 10,
  stainOpacityHighPercent: 35,
  highlightOpacityLowPercent: 1,
  highlightOpacityHighPercent: 20,

  // ---- tracked forms ------------------------------------------------------
  maxOutlineObjects: 1400,
  maxFaceObjects: 300,
  maxOutlineObjectSize: 18,
  objectsPerOutlinePoint: 2,
  objectsPerFaceLandmark: 2,
  perimeterMinSize: 2,
  perimeterMaxSize: 15,
  perimeterSizeVariability: 1,
  drawPersonOutline: true,
  drawFaceLandmarks: true,

  // ---- motion -------------------------------------------------------------
  positionEasePerFrame: 0.14,
  outlineApproachSpeedPixelsPerSecond: 350,
  crawlPerimeter: false,
  crawlSpeedPixelsPerSecond: 10,

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
  enterCoverage: 0.02,
  exitCoverage: 0.01,
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
  discoveryTauMs: 25000,
  discoveryRapidMaxMs: 900,
  discoveryRapidMinRun: 2,

  // ---- session (step 6) ---------------------------------------------------
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
  revealImageEnabled: true,
  textAboveReveal: false,
  eyesClosedWatchdogMs: 3000,

  // ---- performance --------------------------------------------------------
  segmentationFps: 15,
  outlineRetargetHz: 15,
  rotatedSquares: true,
});
