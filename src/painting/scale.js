// Reference-resolution scaling.
//
// The painting was authored at a fixed canvas that CSS then stretched to the
// viewport. Here the canvas is created at the viewport's own size, so every
// pixel-denominated constant has to be expressed relative to a reference.
//
// Settings values stay authored at REFERENCE_WIDTH x REFERENCE_HEIGHT and are
// converted at the POINT OF USE, never at load. That way the debug panel shows
// the same numbers on a laptop and on the installation machine, exported
// settings are portable between them, and a resize never rewrites settings.
//
// SIZES scale. COUNTS DO NOT. objectCount and primitivesPerSecond are literal:
// the number in the panel is the number of marks. Scaling counts by canvas area
// made the panel lie (22,000 became 122,000 in a large window) and multiplied
// the frame cost fivefold on a development display for no benefit — the
// installation runs at the reference resolution, where the two are identical.
// The consequence, accepted deliberately: mark DENSITY varies with canvas size,
// while the FIFO turnover period (objectCount / primitivesPerSecond) does not.

export const REFERENCE_WIDTH = 1280;
export const REFERENCE_HEIGHT = 720;

/**
 * @param {number} width  canvas width in px
 * @param {number} height canvas height in px
 * @returns {{width:number,height:number,length:number,area:number,px:(v:number)=>number,count:(v:number)=>number}}
 */
export function createScale(width, height) {
  // Height-based rather than diagonal-based: people are vertical, so mark size
  // should track apparent body height. On a true 16:9 display width/1280 and
  // height/720 are equal anyway, so this only matters in a dev window.
  const length = height / REFERENCE_HEIGHT;

  return { width, height, length, px: (value) => value * length };
}
