export const MASK_WIDTH = 320;
export const MASK_HEIGHT = 180;

const CONFIDENCE_THRESHOLD = 0.55;
const MASK_PIXEL_COUNT = MASK_WIDTH * MASK_HEIGHT;
const sampledBuffer = new Float32Array(MASK_PIXEL_COUNT);
const smoothedBuffer = new Float32Array(MASK_PIXEL_COUNT);
const maskBuffer = new Uint8Array(MASK_PIXEL_COUNT);
let sourceIndexLookup = new Uint32Array(MASK_PIXEL_COUNT);
let sourceIndexLookupKey = "";

export function buildPersonMask(
  confidence,
  sourceWidth,
  sourceHeight,
  videoWidth,
  videoHeight,
) {
  const sampled = coverSampleMirrored(
    confidence,
    sourceWidth,
    sourceHeight,
    videoWidth,
    videoHeight,
  );
  const smoothed = boxBlur3x3(sampled, MASK_WIDTH, MASK_HEIGHT);
  let foregroundPixels = 0;

  for (let i = 0; i < smoothed.length; i += 1) {
    if (smoothed[i] >= CONFIDENCE_THRESHOLD) {
      maskBuffer[i] = 1;
      foregroundPixels += 1;
    } else {
      maskBuffer[i] = 0;
    }
  }

  return {
    mask: maskBuffer,
    width: MASK_WIDTH,
    height: MASK_HEIGHT,
    coverage: foregroundPixels / MASK_PIXEL_COUNT,
  };
}

export function getCoverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;

  if (sourceAspect > targetAspect) {
    const height = sourceHeight;
    const width = height * targetAspect;
    return { x: (sourceWidth - width) / 2, y: 0, width, height };
  }

  const width = sourceWidth;
  const height = width / targetAspect;
  return { x: 0, y: (sourceHeight - height) / 2, width, height };
}

function coverSampleMirrored(
  confidence,
  sourceWidth,
  sourceHeight,
  videoWidth,
  videoHeight,
) {
  const lookupKey = `${sourceWidth}:${sourceHeight}:${videoWidth}:${videoHeight}`;
  if (lookupKey !== sourceIndexLookupKey) {
    sourceIndexLookup = buildSourceIndexLookup(
      sourceWidth,
      sourceHeight,
      videoWidth,
      videoHeight,
    );
    sourceIndexLookupKey = lookupKey;
  }

  for (let index = 0; index < MASK_PIXEL_COUNT; index += 1) {
    sampledBuffer[index] = confidence[sourceIndexLookup[index]];
  }

  return sampledBuffer;
}

function buildSourceIndexLookup(
  sourceWidth,
  sourceHeight,
  videoWidth,
  videoHeight,
) {
  const crop = getCoverCrop(videoWidth, videoHeight, MASK_WIDTH, MASK_HEIGHT);
  const lookup = new Uint32Array(MASK_PIXEL_COUNT);

  for (let y = 0; y < MASK_HEIGHT; y += 1) {
    const videoY = crop.y + ((y + 0.5) / MASK_HEIGHT) * crop.height;
    const sourceY = clamp(
      Math.floor((videoY / videoHeight) * sourceHeight),
      0,
      sourceHeight - 1,
    );

    for (let x = 0; x < MASK_WIDTH; x += 1) {
      const mirroredX = 1 - (x + 0.5) / MASK_WIDTH;
      const videoX = crop.x + mirroredX * crop.width;
      const sourceX = clamp(
        Math.floor((videoX / videoWidth) * sourceWidth),
        0,
        sourceWidth - 1,
      );
      lookup[y * MASK_WIDTH + x] = sourceY * sourceWidth + sourceX;
    }
  }

  return lookup;
}

function boxBlur3x3(input, width, height) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const sampleY = y + offsetY;
        if (sampleY < 0 || sampleY >= height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = x + offsetX;
          if (sampleX < 0 || sampleX >= width) continue;
          sum += input[sampleY * width + sampleX];
          count += 1;
        }
      }
      smoothedBuffer[y * width + x] = sum / count;
    }
  }

  return smoothedBuffer;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
