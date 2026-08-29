import p5 from "p5";
import { PaintingQueue } from "./PaintingQueue.js";
import { faceLandmarkIndex } from "./faceAssignment.js";
import { createScale, REFERENCE_WIDTH, REFERENCE_HEIGHT } from "./scale.js";

const BLEND_LAYER_MULTIPLY = "multiply";
const BLEND_LAYER_NORMAL = "normal";
const BLEND_LAYER_SCREEN = "screen";
const BLEND_SETTING_KEYS = new Set([
  "stainBlendWeight",
  "normalBlendWeight",
  "highlightBlendWeight",
  "stainSizeMultiplier",
  "stainOpacityLowPercent",
  "stainOpacityHighPercent",
  "highlightOpacityLowPercent",
  "highlightOpacityHighPercent",
]);

// Reference-resolution pixel constants, converted through scale.px() at use.
const REF_TYPHOON_MIN_WIDTH = 5;
const REF_TYPHOON_STEP_MIN = 1;
const REF_TYPHOON_STEP_MAX = 20;
const REF_JITTER_AMPLITUDE = 4;
const REF_ARRIVAL_EPSILON = 4;
const REF_GRAVITY = 0.38;
const REF_FALL_CULL_MARGIN = 120;
const REF_FALL_VELOCITY_X = 1.25;
const REF_FALL_VELOCITY_Y_MIN = -1.5;
const REF_FALL_VELOCITY_Y_MAX = 0.5;
// A per-pixel noise frequency: it scales INVERSELY, otherwise gestures curl
// more tightly on a larger canvas.
// Two opposing diagonals. A gesture picks one, wanders slightly around it, and
// keeps it for its whole length — the decision is per GESTURE, not per mark, so
// the family stays legible as a direction rather than a texture.
const DIRECTIONAL_FAMILY_ANGLES = Object.freeze([Math.PI / 4, -Math.PI / 4]);
// How far the per-mark noise is allowed to pull a directional gesture off its
// heading. Small: the curvature should read as drift, not as a new direction.
const DIRECTIONAL_DRIFT = 0.5;

const REF_NOISE_SCALE = 0.001;

const TAU = Math.PI * 2;
const INVERSE_255 = 1 / 255;

/**
 * The generative painting, plus the tracked forms that are drawn out of it.
 *
 * Knows nothing about blinking, discovery or session state — it is told when
 * somebody is engaged and where their outline and face features are.
 *
 * @param {{mount:string, settings:object, flags:object, onStats?:Function}} options
 */
export function createPainting({ mount, settings, flags, onStats = () => {} }) {
  let sketch = null;
  let scale = createScale(1280, 720);

  let objects = [];
  let paintingLayers = createPaintingLayers();
  let nextObjectId = 0;
  let primitiveAccumulator = 0;
  let lastStatsAt = 0;

  let engaged = false;
  let pendingTyphoonPieces = [];
  let pendingTyphoonIndex = 0;
  let activeFaceObjects = [];
  let fallingOutlineObjects = [];
  let latestFacePoints = [];
  let lastFaceSeenAt = -Infinity;
  let resizeTimer = 0;

  // Mirrors the canvas context so the draw loop only touches it when something
  // actually changed. `css` is compared by reference: hexToRgb hands out one
  // frozen object per palette entry, so identical colours are the same string.
  const drawState = { fill: null, stroke: null, alpha: -1 };

  const instance = new p5((p) => {
    sketch = p;

    p.setup = () => {
      p.pixelDensity(1);
      if (Number.isFinite(flags.testSeed)) {
        p.randomSeed(flags.testSeed);
        p.noiseSeed(flags.testSeed);
      }
      // A viewport that reports 0 at setup — a window still being laid out, a
      // kiosk shell mapping its window, an embedded frame — used to build the
      // whole painting at scale 0: every mark sized 0 at (0,0), so the piece
      // showed nothing. Worse, the resize that followed divided by a width of
      // 0 and turned every coordinate into NaN, which it could never come back
      // from. Fall back to the reference resolution and let the first real
      // resize scale it up.
      const canvas = p.createCanvas(
        p.windowWidth || REFERENCE_WIDTH,
        p.windowHeight || REFERENCE_HEIGHT,
      );
      canvas.parent(mount);
      scale = createScale(p.width, p.height);
      p.rectMode(p.CENTER);
      p.noStroke();

      objects = buildInitialPainting(p, () => nextObjectId++);
      rebuildPaintingLayers(objects);
      onStats(objects.length, p.frameRate());
    };

    p.draw = () => {
      p.background(settings.backgroundColor);

      const elapsedMs = Math.min(p.deltaTime, 250);
      primitiveAccumulator += (elapsedMs * settings.primitivesPerSecond) / 1000;
      const primitiveCount = Math.min(Math.floor(primitiveAccumulator), 200);

      if (!flags.freezePainting && primitiveCount > 0) {
        for (let i = 0; i < primitiveCount; i += 1) {
          renewPainting(p, objects, () => nextObjectId++);
        }
        primitiveAccumulator -= primitiveCount;
      }

      const frameScale = Math.min(p.deltaTime / (1000 / 60), 6);
      const easing = 1 - Math.pow(1 - settings.positionEasePerFrame, frameScale);
      for (const object of activeFaceObjects) {
        updateActiveOutlineObject(object, easing, elapsedMs / 1000);
      }

      if (activeFaceObjects.length > 0 && performance.now() - lastFaceSeenAt > 750) {
        dropActiveFaceObjects(p);
      }
      updateFallingOutlineObjects(frameScale);
      resetDrawState();

      const ctx = p.drawingContext;

      // Batch by blend layer so the compositing mode changes three times a
      // frame rather than forty thousand.
      drawPaintingLayer(p, ctx, paintingLayers[BLEND_LAYER_MULTIPLY], p.MULTIPLY);
      drawPaintingLayer(p, ctx, paintingLayers[BLEND_LAYER_NORMAL], p.BLEND);
      drawPaintingLayer(p, ctx, paintingLayers[BLEND_LAYER_SCREEN], p.SCREEN);
      p.blendMode(p.BLEND);

      // Tracked forms are independent layers: FIFO turnover in the painting
      // cannot recycle them, and they are always drawn normally blended on top.
      if (settings.drawFaceLandmarks) {
        for (const object of activeFaceObjects) drawObject(ctx, object);
      }
      for (const object of fallingOutlineObjects) drawObject(ctx, object);

      releaseContext(p, ctx);

      if (p.millis() - lastStatsAt >= 250) {
        onStats(objects.length, p.frameRate());
        lastStatsAt = p.millis();
      }
    };

    // Chromium fires dozens of these per drag, and each one rebuilds the pool.
    // Read window.innerWidth at execution time rather than p.windowWidth:
    // p5 caches those in its own resize handler and they can lag behind the
    // real viewport, which silently turns this into a no-op.
    p.windowResized = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(
        () => applyResize(window.innerWidth, window.innerHeight),
        200,
      );
    };
  });

  // ---------------------------------------------------------------- resizing

  function applyResize(nextWidth, nextHeight) {
    const p = sketch;
    if (!p || nextWidth <= 0 || nextHeight <= 0) return;
    if (nextWidth === p.width && nextHeight === p.height) return;

    // Guard the divisions below. Everything here scales existing geometry by
    // the RATIO of the two sizes, which is meaningless from a zero width.
    if (p.width <= 0 || p.height <= 0) {
      p.resizeCanvas(nextWidth, nextHeight);
      scale = createScale(nextWidth, nextHeight);
      objects = buildInitialPainting(p, () => nextObjectId++);
      pendingTyphoonPieces = [];
      pendingTyphoonIndex = 0;
      activeFaceObjects = [];
      fallingOutlineObjects = [];
      rebuildPaintingLayers(objects);
      return;
    }

    const sx = nextWidth / p.width;
    const sy = nextHeight / p.height;
    const previousLength = scale.length;

    p.resizeCanvas(nextWidth, nextHeight);
    scale = createScale(nextWidth, nextHeight);
    const sizeScale = scale.length / previousLength;

    for (const object of everyObject()) {
      object.homeX *= sx;
      object.homeY *= sy;
      object.x *= sx;
      object.y *= sy;
      object.targetX *= sx;
      object.targetY *= sy;
      if (object.outlineTargetX !== undefined) {
        object.outlineTargetX *= sx;
        object.outlineTargetY *= sy;
      }
      object.jitterX *= sizeScale;
      object.jitterY *= sizeScale;
      object.baseSize *= sizeScale;
    }

    // applyBlendStyle derives size from baseSize, but outline and face marks
    // have their size overwritten by resizePerimeterObjects. Both paths must
    // be walked or half the marks resize and half do not.
    restyleBlendObjects(objects);
    restyleBlendObjects(pendingTyphoonPieces);
    resizePerimeterObjects(activeFaceObjects);

    resizeObjectPool(p, objects, settings.objectCount, () => nextObjectId++);
    rebuildPaintingLayers(objects);

    // The next mask frame refills these in the new coordinate space.
  }

  function* everyObject() {
    yield* objects;
    yield* pendingTyphoonPieces;
    yield* activeFaceObjects;
    yield* fallingOutlineObjects;
  }

  // ------------------------------------------------------------ public input

  function setEngaged(next) {
    if (next === engaged) return;
    engaged = next;
    if (!sketch) return;

    if (engaged) {
      if (latestFacePoints.length > 0 && activeFaceObjects.length === 0) {
        activeFaceObjects = createFaceFeatureObjects(objects, latestFacePoints);
      }
    } else {
      dropActiveFaceObjects(sketch);
    }
  }

  function updateFacePoints(points) {
    latestFacePoints = points ?? [];
    if (latestFacePoints.length === 0) return;

    lastFaceSeenAt = performance.now();
    if (!engaged) return;

    if (activeFaceObjects.length === 0) {
      activeFaceObjects = createFaceFeatureObjects(objects, latestFacePoints);
    } else {
      updateFaceTargets(activeFaceObjects, latestFacePoints);
    }
  }

  const DIRECTION_KEYS = new Set([
    "directionalFamilyPercent",
    "directionAngleVariationDegrees",
    "directionObjectVariation",
  ]);

  function handleSettingsChange(key, committed = true) {
    const p = sketch;
    if (!p) return;

    // Generation-time settings: they shape a gesture as it is made, so existing
    // marks cannot be restyled into them — the painting has to be made again.
    //
    // Only on commit (slider released, number typed): rebuilding twenty
    // thousand marks on every frame of a drag would lock the page up.
    //
    // Deliberately NOT on "all". The only thing that fires "all" at runtime is
    // the quality governor stepping down, and repainting from scratch would be
    // a visible jolt at exactly the moment the machine is already struggling.
    if (DIRECTION_KEYS.has(key)) {
      if (!committed) return;
      objects = buildInitialPainting(p, () => nextObjectId++);
      rebuildPaintingLayers(objects);
      pendingTyphoonPieces = [];
      pendingTyphoonIndex = 0;
      activeFaceObjects = [];
      return;
    }

    if (key === "objectCount" || key === "all") {
      resizeObjectPool(p, objects, settings.objectCount, () => nextObjectId++);
      rebuildPaintingLayers(objects);
    }

    if (key === "colors" || key === "all") {
      recolorObjects(objects);
      recolorObjects(pendingTyphoonPieces);
      recolorObjects(activeFaceObjects);
      recolorObjects(fallingOutlineObjects);
    }

    if (key === "maxTyphoonSize" || key === "all") {
      pendingTyphoonPieces = [];
      pendingTyphoonIndex = 0;
    }

    if (BLEND_SETTING_KEYS.has(key) || key === "all") {
      restyleBlendObjects(objects);
      restyleBlendObjects(pendingTyphoonPieces);
      rebuildPaintingLayers(objects);
    }

    if (
      key === "perimeterMinSize" ||
      key === "perimeterMaxSize" ||
      key === "perimeterSizeVariability" ||
      key === "all"
    ) {
      resizePerimeterObjects(activeFaceObjects);
    }

    onStats(objects.length, p.frameRate());
  }

  // ----------------------------------------------------------- the painting

  function buildInitialPainting(p, getNextId) {
    const target = settings.objectCount;
    const painting = [];
    while (painting.length < target) painting.push(...createRandomTyphoon(p, getNextId));
    return new PaintingQueue(painting.slice(0, target));
  }

  function resizeObjectPool(p, painting, targetCount, getNextId) {
    if (painting.length > targetCount) painting.discardOldest(painting.length - targetCount);
    while (painting.length < targetCount) {
      const incoming = createRandomTyphoon(p, getNextId);
      painting.push(...incoming.slice(0, targetCount - painting.length));
    }
  }

  function renewPainting(p, painting, getNextId) {
    if (pendingTyphoonIndex >= pendingTyphoonPieces.length) {
      pendingTyphoonPieces = createRandomTyphoon(p, getNextId);
      pendingTyphoonIndex = 0;
    }

    const incomingPiece = pendingTyphoonPieces[pendingTyphoonIndex];
    pendingTyphoonIndex += 1;
    incomingPiece.color = hexToRgb(settings.colors[incomingPiece.colorIndex]);

    // A typhoon is generated as a sequence, but its marks enter one at a time
    // at the configured rate. Each one replaces the oldest mark.
    if (painting.length >= settings.objectCount) {
      const outgoingPiece = painting.shift();
      if (outgoingPiece) paintingLayers[outgoingPiece.blendLayer].shift();
    }
    painting.push(incomingPiece);
    paintingLayers[incomingPiece.blendLayer].push(incomingPiece);
  }

  function createRandomTyphoon(p, getNextId) {
    const maxSize = scale.px(settings.maxTyphoonSize);
    const width = p.random(p.random(p.random(maxSize))) + scale.px(REF_TYPHOON_MIN_WIDTH);

    // Once per gesture. Everything downstream inherits this one roll.
    const usesFamily = p.random() < settings.directionalFamilyPercent / 100;
    const variation = p.radians(settings.directionAngleVariationDegrees);
    const directionAngle = usesFamily
      ? DIRECTIONAL_FAMILY_ANGLES[p.int(p.random(2))] + p.random(-variation, variation)
      : null;

    return typhoon(p, p.random(p.width), p.random(p.height), width, getNextId, directionAngle);
  }

  function typhoon(p, startX, startY, width, getNextId, directionAngle = null) {
    const generated = [];
    const numberOfMarks = p.int(p.random(5, 50));
    const isDirectional = Number.isFinite(directionAngle);
    // A directional gesture starts near its heading and barely turns; a free
    // one keeps the original behaviour untouched.
    let angle = isDirectional ? directionAngle + p.random(-0.18, 0.18) : p.random(10);
    const angleStep = isDirectional ? p.random(-0.012, 0.012) : p.random(-1, 1) * 0.05;
    const colorIndex = p.int(p.random(settings.colors.length));
    const color = hexToRgb(settings.colors[colorIndex]);
    const noiseScale = REF_NOISE_SCALE / scale.length;
    const offset = (width / 2) * (p.random() < 0.5 ? 0 : 1);
    const blendRoll = p.random();
    const typeRoll = p.random();
    const step = p.random(scale.px(REF_TYPHOON_STEP_MIN), scale.px(REF_TYPHOON_STEP_MAX));
    const alphaRoll = p.random();
    let x = startX;
    let y = startY;

    // Marks either start large and shrink, or the reverse.
    const reverseSize = p.random() < 0.5;

    for (let i = 0; i < numberOfMarks; i += 1) {
      const size = reverseSize
        ? p.map(i, 0, numberOfMarks, 0, width)
        : p.map(i, 0, numberOfMarks, width, 0);
      const noiseValue = p.noise(x * noiseScale, y * noiseScale, i * noiseScale * 5);
      // The noise still drives the walk; for a directional gesture it drifts
      // around the heading instead of replacing it.
      const noiseAngle = isDirectional
        ? directionAngle + (noiseValue - 0.5) * DIRECTIONAL_DRIFT
        : noiseValue * 100;
      const center = rotateOffset(x - offset, y - offset, offset, angle);

      // A little scatter along and across the heading. Both axes, or the marks
      // line up into mechanically straight rows.
      const placement = scale.px(settings.directionObjectVariation);
      if (isDirectional && placement > 0) {
        const along = p.random(-placement, placement);
        const across = p.random(-placement, placement);
        center.x += Math.cos(directionAngle) * along + Math.cos(directionAngle + Math.PI / 2) * across;
        center.y += Math.sin(directionAngle) * along + Math.sin(directionAngle + Math.PI / 2) * across;
      }

      const id = getNextId();
      const jitter = deterministicJitter(id, scale);
      const object = {
        id,
        type: 0,
        typeRoll,
        baseSize: size,
        size,
        angle,
        angleCosine: Math.cos(angle),
        angleSine: Math.sin(angle),
        jitterX: jitter.x,
        jitterY: jitter.y,
        blendRoll,
        blendLayer: BLEND_LAYER_NORMAL,
        colorIndex,
        color,
        alphaRoll,
        alpha: 255,
        homeX: center.x,
        homeY: center.y,
        x: center.x,
        y: center.y,
        targetX: center.x,
        targetY: center.y,
        assignedToOutline: false,
      };
      applyBlendStyle(object);
      generated.push(object);

      x += p.cos(noiseAngle) * step;
      y += p.sin(noiseAngle) * step;
      angle += angleStep;
    }

    return generated;
  }

  // ------------------------------------------------------- the tracked forms


  /**
   * Every landmark gets a mark. Always.
   *
   * The proportional mapping this used to do — floor(i / marks * points) —
   * silently dropped landmarks whenever there were fewer marks than points:
   * 80 marks covered 80 of 120 landmarks and left 40 with nothing. The gaps
   * fell hardest on the face oval, simply because it is the largest group, so
   * the head outline came out unfinished. Assigning point (i % points) instead
   * covers every landmark by construction before any point gets a second mark.
   */
  function createFaceFeatureObjects(painting, featurePoints) {
    const pointCount = featurePoints.length;
    if (pointCount === 0) return [];

    // One per landmark is the floor, not a target. maxFaceObjects caps the
    // extras, never the face itself.
    const desiredCount = Math.max(
      pointCount,
      Math.min(settings.maxFaceObjects, pointCount * settings.objectsPerFaceLandmark),
    );
    const dedicatedObjects = takeObjectsFromPainting(painting, desiredCount, pointCount);

    for (let i = 0; i < dedicatedObjects.length; i += 1) {
      const point = featurePoints[faceLandmarkIndex(i, dedicatedObjects.length, pointCount)];
      // Marks on the eyes and lips read larger than marks tracing the jaw, so
      // the face does not dissolve into an even scatter of identical dots.
      dedicatedObjects[i].faceEmphasis = point.scale ?? 1;
      attachObjectToPoint(dedicatedObjects[i], point);
    }

    // After the emphasis is set, so it is folded into the size.
    resizePerimeterObjects(dedicatedObjects);
    return dedicatedObjects;
  }

  /**
   * Borrow marks out of the painting.
   *
   * `minimumCount` is a promise, not a preference: if the size filter cannot
   * find enough small marks, the shortfall is taken without it. Otherwise a
   * painting that happens to be full of large marks — or a lowered
   * maxOutlineObjectSize — quietly leaves landmarks with nothing on them.
   */
  function takeObjectsFromPainting(painting, desiredCount, minimumCount = 0) {
    const maxSize = scale.px(settings.maxOutlineObjectSize);
    const dedicatedObjects = painting.extractFirst(
      (object) => object.size <= maxSize,
      desiredCount,
    );

    const shortfall = Math.min(minimumCount, desiredCount) - dedicatedObjects.length;
    if (shortfall > 0) {
      dedicatedObjects.push(...painting.extractFirst(() => true, shortfall));
    }

    rebuildPaintingLayers(painting);

    for (const object of dedicatedObjects) {
      object.arrivedOnPerimeter = false;
      object.outlineTargetX = object.x;
      object.outlineTargetY = object.y;
    }

    return dedicatedObjects;
  }






  /**
   * Follow the face from frame to frame.
   *
   * The silhouette needed a kd-tree here, because a contour is an unordered
   * cloud whose point count changes every frame. Landmarks are neither: index i
   * is the same corner of the same eye every time, so the same index mapping
   * used when the marks were borrowed keeps each mark on its own feature —
   * cheaper, and it stops marks swapping places as the head moves.
   */
  function updateFaceTargets(faceObjects, featurePoints) {
    if (faceObjects.length === 0 || featurePoints.length === 0) return;
    // Same mapping as createFaceFeatureObjects, or every mark would jump to a
    // different feature on the frame after it was placed.
    for (let i = 0; i < faceObjects.length; i += 1) {
      attachObjectToPoint(
        faceObjects[i],
        featurePoints[faceLandmarkIndex(i, faceObjects.length, featurePoints.length)],
      );
    }
  }

  function attachObjectToPoint(object, point) {
    object.outlineTargetX = point.x;
    object.outlineTargetY = point.y;
    object.targetX = point.x + object.jitterX;
    object.targetY = point.y + object.jitterY;
  }


  function dropActiveFaceObjects(p) {
    for (const object of activeFaceObjects) {
      object.faceEmphasis = 1;
    }
    moveObjectsToFallingLayer(p, activeFaceObjects);
    activeFaceObjects = [];
  }

  function moveObjectsToFallingLayer(p, outlineObjects) {
    const vx = scale.px(REF_FALL_VELOCITY_X);
    for (const object of outlineObjects) {
      object.fallVelocityX = p.random(-vx, vx);
      object.fallVelocityY = p.random(
        scale.px(REF_FALL_VELOCITY_Y_MIN),
        scale.px(REF_FALL_VELOCITY_Y_MAX),
      );
      // Radians — not scaled.
      object.fallAngularVelocity = p.random(-0.045, 0.045);
    }
    fallingOutlineObjects.push(...outlineObjects);
  }

  function updateFallingOutlineObjects(frameScale) {
    if (fallingOutlineObjects.length === 0) return;
    const gravity = scale.px(REF_GRAVITY);
    const cullBelow = (sketch?.height ?? 0) + scale.px(REF_FALL_CULL_MARGIN);

    for (const object of fallingOutlineObjects) {
      object.fallVelocityY += gravity * frameScale;
      object.x += object.fallVelocityX * frameScale;
      object.y += object.fallVelocityY * frameScale;
      object.angle += object.fallAngularVelocity * frameScale;
      object.angleCosine = Math.cos(object.angle);
      object.angleSine = Math.sin(object.angle);
    }
    fallingOutlineObjects = fallingOutlineObjects.filter(
      (object) => object.y - object.size < cullBelow,
    );
  }

  function updateActiveOutlineObject(object, easing, elapsedSeconds) {
    const dx = object.targetX - object.x;
    const dy = object.targetY - object.y;
    const distance = Math.hypot(dx, dy);

    if (!object.arrivedOnPerimeter) {
      const travelDistance = Math.min(
        distance,
        scale.px(settings.outlineApproachSpeedPixelsPerSecond) * elapsedSeconds,
      );

      if (distance > 0) {
        object.x += (dx / distance) * travelDistance;
        object.y += (dy / distance) * travelDistance;
      }

      if (distance <= Math.max(scale.px(REF_ARRIVAL_EPSILON), travelDistance)) {
        object.x = object.targetX;
        object.y = object.targetY;
        object.arrivedOnPerimeter = true;
      }
      return;
    }

    const followEase = easing;
    object.x += dx * followEase;
    object.y += dy * followEase;
  }

  function resizePerimeterObjects(outlineObjects) {
    const minimum = scale.px(Math.min(settings.perimeterMinSize, settings.perimeterMaxSize));
    const maximum = scale.px(Math.max(settings.perimeterMinSize, settings.perimeterMaxSize));
    const midpoint = (minimum + maximum) / 2;
    const variability = settings.perimeterSizeVariability;

    for (const object of outlineObjects) {
      const randomUnit = fractional(Math.sin((object.id + 1) * 41.733) * 9182.173);
      const randomizedSize = minimum + (maximum - minimum) * randomUnit;
      object.size =
        (midpoint + (randomizedSize - midpoint) * variability) * (object.faceEmphasis ?? 1);
    }
  }

  // ------------------------------------------------------------- appearance

  function restyleBlendObjects(painting) {
    for (const object of painting) applyBlendStyle(object);
  }

  function applyBlendStyle(object) {
    const stainWeight = Math.max(0, settings.stainBlendWeight);
    const normalWeight = Math.max(0, settings.normalBlendWeight);
    const highlightWeight = Math.max(0, settings.highlightBlendWeight);
    const totalWeight = stainWeight + normalWeight + highlightWeight;
    const stainProbability = totalWeight > 0 ? stainWeight / totalWeight : 0;
    const normalProbability = totalWeight > 0 ? normalWeight / totalWeight : 1;

    if (object.blendRoll < stainProbability) {
      object.blendLayer = BLEND_LAYER_MULTIPLY;
    } else if (object.blendRoll < stainProbability + normalProbability) {
      object.blendLayer = BLEND_LAYER_NORMAL;
    } else {
      object.blendLayer = BLEND_LAYER_SCREEN;
    }

    // Multiply stains stay filled; normal marks and highlights can also be lines.
    const typeCount = object.blendLayer === BLEND_LAYER_MULTIPLY ? 2 : 3;
    object.type = Math.min(typeCount - 1, Math.floor(object.typeRoll * typeCount));

    if (object.blendLayer === BLEND_LAYER_MULTIPLY) {
      object.size = object.baseSize * settings.stainSizeMultiplier;
      object.alpha = interpolateOpacityPercent(
        settings.stainOpacityLowPercent,
        settings.stainOpacityHighPercent,
        object.alphaRoll,
      );
    } else if (object.blendLayer === BLEND_LAYER_SCREEN) {
      object.size = object.baseSize;
      object.alpha = interpolateOpacityPercent(
        settings.highlightOpacityLowPercent,
        settings.highlightOpacityHighPercent,
        object.alphaRoll,
      );
    } else {
      object.size = object.baseSize;
      object.alpha = object.alphaRoll * 255;
    }
  }

  function interpolateOpacityPercent(first, second, amount) {
    const minimum = Math.min(first, second);
    const maximum = Math.max(first, second);
    return (minimum + (maximum - minimum) * amount) * 2.55;
  }

  function recolorObjects(painting) {
    for (const object of painting) {
      object.color = hexToRgb(settings.colors[object.colorIndex % settings.colors.length]);
    }
  }

  function createPaintingLayers() {
    return {
      [BLEND_LAYER_MULTIPLY]: new PaintingQueue(),
      [BLEND_LAYER_NORMAL]: new PaintingQueue(),
      [BLEND_LAYER_SCREEN]: new PaintingQueue(),
    };
  }

  function rebuildPaintingLayers(painting) {
    paintingLayers = createPaintingLayers();
    for (const object of painting) paintingLayers[object.blendLayer].push(object);
  }

  // ----------------------------------------------------------------- drawing

  // Every mark is drawn straight onto the 2D context rather than through p5.
  //
  // p5's fill(r,g,b,a) allocates a p5.Color, converts it, builds an
  // "rgba(...)" string and hands that to the canvas, which then parses it as
  // CSS. Alpha here is a continuous random float, so no two consecutive marks
  // share a colour and none of that work was ever reused: at 22,000 marks a
  // frame it was tens of thousands of allocations and CSS colour parses per
  // frame, all on the main thread. That is why a fast GPU changed nothing.
  //
  // Instead the colour is one of nine interned opaque strings and the opacity
  // rides on globalAlpha, which is a plain float. Identical output, no
  // allocation, and the browser parses nine colours for the life of the page.
  function drawPaintingLayer(p, ctx, painting, blendMode) {
    p.blendMode(blendMode);
    const items = painting.items;
    for (let index = painting.head; index < items.length; index += 1) {
      drawObject(ctx, items[index]);
    }
  }

  function drawObject(ctx, object) {
    const alpha = object.alpha * INVERSE_255;
    if (drawState.alpha !== alpha) {
      ctx.globalAlpha = alpha;
      drawState.alpha = alpha;
    }
    const css = object.color.css;
    const size = object.size;

    if (object.type === 0) {
      if (drawState.fill !== css) {
        ctx.fillStyle = css;
        drawState.fill = css;
      }
      const half = size / 2;
      // p5's push/pop saved and restored the ENTIRE renderer style state per
      // mark. setTransform writes six numbers and allocates nothing.
      if (settings.rotatedSquares) {
        ctx.setTransform(object.angleCosine, object.angleSine, -object.angleSine, object.angleCosine, object.x, object.y);
        ctx.fillRect(-half, -half, size, size);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      } else {
        ctx.fillRect(object.x - half, object.y - half, size, size);
      }
      return;
    }

    if (object.type === 1) {
      if (drawState.fill !== css) {
        ctx.fillStyle = css;
        drawState.fill = css;
      }
      ctx.beginPath();
      ctx.arc(object.x, object.y, size / 2, 0, TAU);
      ctx.fill();
      return;
    }

    if (drawState.stroke !== css) {
      ctx.strokeStyle = css;
      drawState.stroke = css;
    }
    const halfWidth = size / 2;
    const dx = object.angleCosine * halfWidth;
    const dy = object.angleSine * halfWidth;
    ctx.beginPath();
    ctx.moveTo(object.x - dx, object.y - dy);
    ctx.lineTo(object.x + dx, object.y + dy);
    ctx.stroke();
  }

  function resetDrawState() {
    drawState.fill = null;
    drawState.stroke = null;
    drawState.alpha = -1;
  }

  /**
   * Hand the context back to p5 in the state p5 believes it is in.
   *
   * p5 caches the last fillStyle it set and SKIPS the assignment when the new
   * one matches, so a context we changed behind its back makes the next
   * background() paint in the last mark's colour. A leftover globalAlpha is
   * worse still: background() does not reset it, so the clear would be
   * translucent and the painting would smear frame over frame.
   */
  function releaseContext(p, ctx) {
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const renderer = p._renderer;
    if (renderer) {
      renderer._cachedFillStyle = undefined;
      renderer._cachedStrokeStyle = undefined;
    }
  }

  return {
    setEngaged,
    updateFacePoints,
    handleSettingsChange,
    get engaged() { return engaged; },
    get objectCount() { return objects.length; },
    get scale() { return scale; },
    get size() { return { width: sketch?.width ?? 0, height: sketch?.height ?? 0 }; },
    frameRate: () => sketch?.frameRate() ?? 0,
    instance,
    // dev-only introspection
    get _debug() {
      return {
        layers: Object.fromEntries(
          Object.entries(paintingLayers).map(([k, q]) => [k, q.length]),
        ),
        sample: objects.items?.[objects.head],
        faceObjects: activeFaceObjects.length,
        faceSample: activeFaceObjects.slice(0, 3).map((o) => ({
          x: Math.round(o.x), y: Math.round(o.y),
          tx: Math.round(o.targetX), ty: Math.round(o.targetY),
          arrived: o.arrivedOnPerimeter, size: +o.size?.toFixed(1),
        })),
      };
    },
  };
}

function rotateOffset(originX, originY, offset, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: originX + offset * cosine - offset * sine,
    y: originY + offset * sine + offset * cosine,
  };
}

function deterministicJitter(id, scale) {
  const x = fractional(Math.sin(id * 12.9898) * 43758.5453);
  const y = fractional(Math.sin(id * 78.233) * 12345.6789);
  const amplitude = scale.px(REF_JITTER_AMPLITUDE);
  return { x: (x - 0.5) * amplitude, y: (y - 0.5) * amplitude };
}

function fractional(value) {
  return value - Math.floor(value);
}

// Memoised, and the object it returns is SHARED by every mark of that colour.
// Two consequences, both of which the draw loop depends on: the palette costs
// nine allocations for the life of the page rather than one per mark, and
// `object.color.css` is one of nine interned strings, so assigning it to
// ctx.fillStyle repeatedly is the cheapest case the canvas has.
const COLOR_CACHE = new Map();

function hexToRgb(hex) {
  let color = COLOR_CACHE.get(hex);
  if (color) return color;
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  // Opaque. Per-mark opacity rides on ctx.globalAlpha instead, which is a
  // float assignment rather than a CSS colour string the browser must parse.
  color = Object.freeze({ r, g, b, css: `rgb(${r},${g},${b})` });
  COLOR_CACHE.set(hex, color);
  return color;
}
