import p5 from "p5";
import { PaintingQueue } from "./PaintingQueue.js";
import { NearestPointIndex } from "./NearestPointIndex.js";
import { createScale } from "./scale.js";
import {
  extractContours,
  createContourMetric,
  pointAlongContour,
  findNearestContourLocation,
} from "./contours.js";

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
const REF_CONTOUR_MIN_PERIMETER = 60;
const REF_ARRIVAL_EPSILON = 4;
const REF_GRAVITY = 0.38;
const REF_FALL_CULL_MARGIN = 120;
const REF_FALL_VELOCITY_X = 1.25;
const REF_FALL_VELOCITY_Y_MIN = -1.5;
const REF_FALL_VELOCITY_Y_MAX = 0.5;
// A per-pixel noise frequency: it scales INVERSELY, otherwise gestures curl
// more tightly on a larger canvas.
const REF_NOISE_SCALE = 0.001;

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
  let latestContours = [];
  let latestContourMetrics = [];
  let latestOutline = [];
  let pendingTyphoonPieces = [];
  let pendingTyphoonIndex = 0;
  let activeOutlineObjects = [];
  let activeFaceObjects = [];
  let fallingOutlineObjects = [];
  let latestFacePoints = [];
  let lastFaceSeenAt = -Infinity;
  let crawlDistance = 0;
  let lastOutlineRetargetAt = 0;
  let resizeTimer = 0;

  const drawState = { mode: null, r: -1, g: -1, b: -1, alpha: -1 };

  const instance = new p5((p) => {
    sketch = p;

    p.setup = () => {
      p.pixelDensity(1);
      if (Number.isFinite(flags.testSeed)) {
        p.randomSeed(flags.testSeed);
        p.noiseSeed(flags.testSeed);
      }
      const canvas = p.createCanvas(p.windowWidth, p.windowHeight);
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

      const outlineHasArrived =
        activeOutlineObjects.length > 0 &&
        activeOutlineObjects.every((object) => object.arrivedOnPerimeter);
      if (settings.crawlPerimeter && outlineHasArrived && latestContourMetrics.length > 0) {
        advanceCrawlingOutline(
          activeOutlineObjects,
          latestContourMetrics,
          scale.px(settings.crawlSpeedPixelsPerSecond) * (elapsedMs / 1000),
        );
      }

      for (const object of activeOutlineObjects) {
        updateActiveOutlineObject(object, easing, elapsedMs / 1000);
      }
      for (const object of activeFaceObjects) {
        updateActiveOutlineObject(object, easing, elapsedMs / 1000);
      }

      if (activeFaceObjects.length > 0 && performance.now() - lastFaceSeenAt > 750) {
        dropActiveFaceObjects(p);
      }
      updateFallingOutlineObjects(frameScale);
      resetDrawState();

      // Batch by blend layer so the compositing mode changes three times a
      // frame rather than forty thousand.
      drawPaintingLayer(p, paintingLayers[BLEND_LAYER_MULTIPLY], p.MULTIPLY);
      drawPaintingLayer(p, paintingLayers[BLEND_LAYER_NORMAL], p.BLEND);
      drawPaintingLayer(p, paintingLayers[BLEND_LAYER_SCREEN], p.SCREEN);
      p.blendMode(p.BLEND);

      // Tracked forms are independent layers: FIFO turnover in the painting
      // cannot recycle them, and they are always drawn normally blended on top.
      if (settings.drawPersonOutline) {
        for (const object of activeOutlineObjects) drawObject(p, object);
      }
      if (settings.drawFaceLandmarks) {
        for (const object of activeFaceObjects) drawObject(p, object);
      }
      for (const object of fallingOutlineObjects) drawObject(p, object);

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
    resizePerimeterObjects(activeOutlineObjects);
    resizePerimeterObjects(activeFaceObjects);

    resizeObjectPool(p, objects, settings.objectCount, () => nextObjectId++);
    rebuildPaintingLayers(objects);

    // The next mask frame refills these in the new coordinate space.
    latestContours = [];
    latestContourMetrics = [];
    latestOutline = [];
  }

  function* everyObject() {
    yield* objects;
    yield* pendingTyphoonPieces;
    yield* activeOutlineObjects;
    yield* activeFaceObjects;
    yield* fallingOutlineObjects;
  }

  // ------------------------------------------------------------ public input

  function setEngaged(next) {
    if (next === engaged) return;
    engaged = next;
    if (!sketch) return;

    if (engaged) {
      if (latestOutline.length > 0 && activeOutlineObjects.length === 0) {
        activeOutlineObjects = createStaticOutlineObjects(
          objects,
          latestOutline,
          latestContourMetrics,
        );
      }
      if (latestFacePoints.length > 0 && activeFaceObjects.length === 0) {
        activeFaceObjects = createFaceFeatureObjects(objects, latestFacePoints);
      }
    } else {
      dropActiveOutlineObjects(sketch);
      dropActiveFaceObjects(sketch);
    }
  }

  function updateMask({ mask, width, height }) {
    if (!sketch) return;

    latestContours = extractContours(
      mask,
      width,
      height,
      sketch.width,
      sketch.height,
      scale.px(REF_CONTOUR_MIN_PERIMETER),
    );
    latestContourMetrics = latestContours.map(createContourMetric);
    latestOutline = latestContours.flat();

    if (!engaged || latestOutline.length === 0) return;

    if (activeOutlineObjects.length === 0) {
      activeOutlineObjects = createStaticOutlineObjects(
        objects,
        latestOutline,
        latestContourMetrics,
      );
      return;
    }

    if (settings.crawlPerimeter) {
      updateCrawlTargets(activeOutlineObjects, latestContourMetrics);
      return;
    }

    // Retargeting rebuilds a kd-tree over the whole silhouette, which is the
    // second-largest CPU cost after the draw loop. Decouple its rate from the
    // segmentation rate so it can be turned down independently.
    const now = performance.now();
    const interval = 1000 / Math.max(1, settings.outlineRetargetHz);
    if (now - lastOutlineRetargetAt < interval) return;
    lastOutlineRetargetAt = now;
    updateStaticOutlineTargets(activeOutlineObjects, latestOutline);
  }

  function updateFacePoints(points) {
    latestFacePoints = points ?? [];
    if (latestFacePoints.length === 0) return;

    lastFaceSeenAt = performance.now();
    if (!engaged) return;

    if (activeFaceObjects.length === 0) {
      activeFaceObjects = createFaceFeatureObjects(objects, latestFacePoints);
    } else {
      updateStaticOutlineTargets(activeFaceObjects, latestFacePoints);
    }
  }

  function handleSettingsChange(key) {
    const p = sketch;
    if (!p) return;

    if (key === "objectCount" || key === "all") {
      resizeObjectPool(p, objects, settings.objectCount, () => nextObjectId++);
      rebuildPaintingLayers(objects);
    }

    if (key === "colors" || key === "all") {
      recolorObjects(objects);
      recolorObjects(pendingTyphoonPieces);
      recolorObjects(activeOutlineObjects);
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

    if (engaged && (key === "crawlPerimeter" || key === "all") && settings.crawlPerimeter) {
      initializeCrawlFromCurrent(activeOutlineObjects, latestContourMetrics);
    }

    if (
      key === "perimeterMinSize" ||
      key === "perimeterMaxSize" ||
      key === "perimeterSizeVariability" ||
      key === "all"
    ) {
      resizePerimeterObjects(activeOutlineObjects);
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
    return typhoon(p, p.random(p.width), p.random(p.height), width, getNextId);
  }

  function typhoon(p, startX, startY, width, getNextId) {
    const generated = [];
    const numberOfMarks = p.int(p.random(5, 50));
    let angle = p.random(10);
    const angleStep = p.random(-1, 1) * 0.05;
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
      const noiseAngle = p.noise(x * noiseScale, y * noiseScale, i * noiseScale * 5) * 100;
      const center = rotateOffset(x - offset, y - offset, offset, angle);

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

  function createStaticOutlineObjects(painting, outline, contourMetrics) {
    const desiredCount = Math.min(
      settings.maxOutlineObjects,
      outline.length * settings.objectsPerOutlinePoint,
    );
    const dedicatedObjects = takeObjectsFromPainting(painting, desiredCount);
    resizePerimeterObjects(dedicatedObjects);

    if (settings.crawlPerimeter && contourMetrics.length > 0) {
      crawlDistance = 0;
      distributeObjectsAcrossContours(dedicatedObjects, contourMetrics);
      return dedicatedObjects;
    }

    for (let i = 0; i < dedicatedObjects.length; i += 1) {
      const outlineIndex = Math.floor((i / dedicatedObjects.length) * outline.length);
      attachObjectToPoint(dedicatedObjects[i], outline[outlineIndex]);
    }

    return dedicatedObjects;
  }

  function createFaceFeatureObjects(painting, featurePoints) {
    const desiredCount = Math.min(
      settings.maxFaceObjects,
      featurePoints.length * settings.objectsPerFaceLandmark,
    );
    const dedicatedObjects = takeObjectsFromPainting(painting, desiredCount);
    resizePerimeterObjects(dedicatedObjects);

    for (let i = 0; i < dedicatedObjects.length; i += 1) {
      const pointIndex = Math.floor((i / dedicatedObjects.length) * featurePoints.length);
      attachObjectToPoint(dedicatedObjects[i], featurePoints[pointIndex]);
    }

    return dedicatedObjects;
  }

  function takeObjectsFromPainting(painting, desiredCount) {
    const maxSize = scale.px(settings.maxOutlineObjectSize);
    const dedicatedObjects = painting.extractFirst(
      (object) => object.size <= maxSize,
      desiredCount,
    );
    rebuildPaintingLayers(painting);

    for (const object of dedicatedObjects) {
      object.arrivedOnPerimeter = false;
      object.outlineTargetX = object.x;
      object.outlineTargetY = object.y;
    }

    return dedicatedObjects;
  }

  function distributeObjectsAcrossContours(outlineObjects, contourMetrics) {
    const totalLength = contourMetrics.reduce((sum, metric) => sum + metric.length, 0);
    if (totalLength <= 0) return;

    for (let i = 0; i < outlineObjects.length; i += 1) {
      let globalDistance = (i / outlineObjects.length) * totalLength;
      let contourIndex = 0;
      while (
        contourIndex < contourMetrics.length - 1 &&
        globalDistance > contourMetrics[contourIndex].length
      ) {
        globalDistance -= contourMetrics[contourIndex].length;
        contourIndex += 1;
      }

      const object = outlineObjects[i];
      object.crawlContourIndex = contourIndex;
      object.crawlBaseDistance = globalDistance;
      attachObjectToPoint(object, pointAlongContour(contourMetrics[contourIndex], globalDistance));
    }
  }

  function initializeCrawlFromCurrent(outlineObjects, contourMetrics) {
    if (contourMetrics.length === 0) return;
    crawlDistance = 0;
    for (const object of outlineObjects) {
      const location = findNearestContourLocation(contourMetrics, object.x, object.y);
      object.crawlContourIndex = location.contourIndex;
      object.crawlBaseDistance = location.t * contourMetrics[location.contourIndex].length;
      attachObjectToPoint(
        object,
        pointAlongContour(contourMetrics[location.contourIndex], object.crawlBaseDistance),
      );
    }
  }

  function updateCrawlTargets(outlineObjects, contourMetrics) {
    if (contourMetrics.length === 0) return;
    for (const object of outlineObjects) {
      const contourIndex = Math.min(object.crawlContourIndex ?? 0, contourMetrics.length - 1);
      object.crawlContourIndex = contourIndex;
      attachObjectToPoint(
        object,
        pointAlongContour(contourMetrics[contourIndex], (object.crawlBaseDistance ?? 0) + crawlDistance),
      );
    }
  }

  function advanceCrawlingOutline(outlineObjects, contourMetrics, distance) {
    crawlDistance += distance;
    for (const object of outlineObjects) {
      const contourIndex = Math.min(object.crawlContourIndex ?? 0, contourMetrics.length - 1);
      const metric = contourMetrics[contourIndex];
      if (!metric || metric.length <= 0) continue;
      object.crawlContourIndex = contourIndex;
      attachObjectToPoint(
        object,
        pointAlongContour(metric, (object.crawlBaseDistance ?? 0) + crawlDistance),
      );
    }
  }

  function updateStaticOutlineTargets(outlineObjects, outline) {
    if (outlineObjects.length === 0 || outline.length === 0) return;

    const pointCapacity = Math.max(1, Math.ceil(outlineObjects.length / outline.length));
    const pointUsage = new Uint16Array(outline.length);
    const nearestPointIndex = new NearestPointIndex(outline);

    for (const object of outlineObjects) {
      const outlineIndex = nearestPointIndex.findAvailable(
        pointUsage,
        pointCapacity,
        object.outlineTargetX,
        object.outlineTargetY,
      );
      attachObjectToPoint(object, outline[outlineIndex]);
      pointUsage[outlineIndex] += 1;
    }
  }

  function attachObjectToPoint(object, point) {
    object.outlineTargetX = point.x;
    object.outlineTargetY = point.y;
    object.targetX = point.x + object.jitterX;
    object.targetY = point.y + object.jitterY;
  }

  function dropActiveOutlineObjects(p) {
    moveObjectsToFallingLayer(p, activeOutlineObjects);
    activeOutlineObjects = [];
  }

  function dropActiveFaceObjects(p) {
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

    const followEase = settings.crawlPerimeter ? Math.max(easing, 0.62) : easing;
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
      object.size = midpoint + (randomizedSize - midpoint) * variability;
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

  function drawPaintingLayer(p, painting, blendMode) {
    p.blendMode(blendMode);
    for (let index = painting.head; index < painting.items.length; index += 1) {
      drawObject(p, painting.items[index]);
    }
  }

  function drawObject(p, object) {
    const { r, g, b } = object.color;

    if (object.type === 0) {
      prepareFill(p, r, g, b, object.alpha);
      // push/translate/rotate/pop is a full canvas transform save-restore per
      // mark, on roughly a third of them. Turning rotation off removes that
      // for a difference the eye barely registers at these sizes.
      if (settings.rotatedSquares) {
        p.push();
        p.translate(object.x, object.y);
        p.rotate(object.angle);
        p.square(0, 0, object.size);
        p.pop();
      } else {
        p.rect(object.x, object.y, object.size, object.size);
      }
      return;
    }

    if (object.type === 1) {
      prepareFill(p, r, g, b, object.alpha);
      p.circle(object.x, object.y, object.size);
      return;
    }

    const halfWidth = object.size / 2;
    const dx = object.angleCosine * halfWidth;
    const dy = object.angleSine * halfWidth;
    prepareStroke(p, r, g, b, object.alpha);
    p.line(object.x - dx, object.y - dy, object.x + dx, object.y + dy);
  }

  function resetDrawState() {
    drawState.mode = null;
    drawState.r = -1;
    drawState.g = -1;
    drawState.b = -1;
    drawState.alpha = -1;
  }

  function prepareFill(p, r, g, b, alpha) {
    if (drawState.mode !== "fill") {
      p.noStroke();
      drawState.mode = "fill";
      drawState.alpha = -1;
    }
    if (isSameDrawColor(r, g, b, alpha)) return;
    p.fill(r, g, b, alpha);
    saveDrawColor(r, g, b, alpha);
  }

  function prepareStroke(p, r, g, b, alpha) {
    if (drawState.mode !== "stroke") {
      p.noFill();
      drawState.mode = "stroke";
      drawState.alpha = -1;
    }
    if (isSameDrawColor(r, g, b, alpha)) return;
    p.stroke(r, g, b, alpha);
    saveDrawColor(r, g, b, alpha);
  }

  function isSameDrawColor(r, g, b, alpha) {
    return (
      drawState.r === r && drawState.g === g && drawState.b === b && drawState.alpha === alpha
    );
  }

  function saveDrawColor(r, g, b, alpha) {
    drawState.r = r;
    drawState.g = g;
    drawState.b = b;
    drawState.alpha = alpha;
  }

  return {
    setEngaged,
    updateMask,
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

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}
