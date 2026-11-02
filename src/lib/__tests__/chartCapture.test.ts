import { describe, it, expect } from 'vitest';
import {
  canvasFont,
  DATA_URL_PREFIX,
  fitWithin,
  hasArea,
  isUsableImage,
  isVisibleText,
  placeWithin,
} from '../chartCapture';

/**
 * What a browser is needed for, and what it is not.
 *
 * Capturing a chart needs a canvas, an SVG renderer and a layout - none of
 * which exist in this suite, which runs in node. That part was verified in
 * the running app: six charts, 655 ms against 28 seconds, longest main-thread
 * stall 207 ms against about nine seconds a chart, and the images compared
 * against the screen by eye.
 *
 * What is pinned here is everything the capture DECIDES: whether a result is
 * an image at all, where a piece of the chart lands on the canvas, what font
 * to draw a label in, and how big the picture may be printed. Those were the
 * parts that were silently wrong before - a 22-pixel-wide sliver printed at
 * half its height - and none of them need a browser to be wrong in.
 */

describe('deciding whether a capture is really an image', () => {
  it('rejects what a zero-sized canvas returns', () => {
    // The whole original bug in one assertion. Note it is truthy.
    expect('data:,').toBeTruthy();
    expect(isUsableImage('data:,', 'PNG')).toBe(false);
    expect(isUsableImage('data:,', 'JPEG')).toBe(false);
  });

  it('rejects nothing at all', () => {
    expect(isUsableImage(null, 'JPEG')).toBe(false);
    expect(isUsableImage(undefined, 'JPEG')).toBe(false);
    expect(isUsableImage('', 'JPEG')).toBe(false);
  });

  it('rejects an image of the wrong format', () => {
    // addImage is told the format at the call site, so a JPEG announced as a
    // PNG is decoded as a PNG and throws "wrong PNG signature".
    const jpeg = DATA_URL_PREFIX.JPEG + 'A'.repeat(500);
    const png = DATA_URL_PREFIX.PNG + 'A'.repeat(500);
    expect(isUsableImage(jpeg, 'PNG')).toBe(false);
    expect(isUsableImage(png, 'JPEG')).toBe(false);
    expect(isUsableImage('data:image/svg+xml;base64,' + 'A'.repeat(500), 'PNG')).toBe(false);
  });

  it('rejects a header with no image behind it', () => {
    // A truncated or empty payload has the right prefix and still cannot be
    // decoded. Length is what separates "an empty white chart", which is
    // thousands of characters, from "nothing", which is a handful.
    expect(isUsableImage(DATA_URL_PREFIX.JPEG, 'JPEG')).toBe(false);
    expect(isUsableImage(DATA_URL_PREFIX.PNG + 'iVBORw0KGgo=', 'PNG')).toBe(false);
  });

  it('accepts a capture that looks like a real image', () => {
    expect(isUsableImage(DATA_URL_PREFIX.JPEG + '/9j/4AAQSkZJRg'.repeat(200), 'JPEG')).toBe(true);
    expect(isUsableImage(DATA_URL_PREFIX.PNG + 'iVBORw0KGgo'.repeat(200), 'PNG')).toBe(true);
  });

  it('is not fooled by a prefix appearing later in the string', () => {
    expect(isUsableImage(`x${DATA_URL_PREFIX.PNG}${'A'.repeat(500)}`, 'PNG')).toBe(false);
  });
});

describe('how big a chart is printed', () => {
  const ratio = (size: { width: number; height: number }) => size.width / size.height;

  it('keeps the chart its own shape', () => {
    // THE BUG. The height used to be the width halved, whatever had been
    // captured. Every chart here is roughly square, so every chart was
    // printed squashed to half its height.
    const chart = { width: 435, height: 480 };
    const printed = fitWithin(chart, 150, 110);
    expect(ratio(printed)).toBeCloseTo(ratio(chart), 10);
    expect(printed.height).not.toBeCloseTo(printed.width / 2, 2);
  });

  it('stays inside both bounds', () => {
    const tall = fitWithin({ width: 100, height: 1000 }, 150, 110);
    const wide = fitWithin({ width: 1000, height: 100 }, 150, 110);

    expect(tall.height).toBeLessThanOrEqual(110);
    expect(tall.width).toBeLessThanOrEqual(150);
    expect(wide.height).toBeLessThanOrEqual(110);
    expect(wide.width).toBeLessThanOrEqual(150);

    // ...and touches the one that bound it, rather than shrinking further.
    expect(tall.height).toBeCloseTo(110, 10);
    expect(wide.width).toBeCloseTo(150, 10);
  });

  it('enlarges a small capture to fill the space', () => {
    // There is no pixels-to-millimetres relationship to preserve: the image
    // is always rescaled to the page, so a small chart should not print small.
    const printed = fitWithin({ width: 40, height: 40 }, 150, 110);
    expect(printed.height).toBeCloseTo(110, 10);
    expect(printed.width).toBeCloseTo(110, 10);
  });

  it('falls back to the whole box for a chart with no size', () => {
    expect(fitWithin({ width: 0, height: 0 }, 150, 110)).toEqual({ width: 150, height: 110 });
    expect(fitWithin({ width: 100, height: Number.NaN }, 150, 110)).toEqual({
      width: 150,
      height: 110,
    });
  });
});

describe('placing a piece of the chart on the canvas', () => {
  const box = { left: 100, top: 200, width: 400, height: 300 };

  it('measures from the captured element, not the page', () => {
    expect(placeWithin(box, { left: 140, top: 260, width: 50, height: 20 })).toEqual({
      left: 40,
      top: 60,
      width: 50,
      height: 20,
    });
  });

  it('gives a negative offset to something that overflows', () => {
    // A pie chart's labels sit outside the SVG box. Clipped by the canvas,
    // exactly as they are clipped on the screen - not shifted into view.
    expect(placeWithin(box, { left: 80, top: 190, width: 30, height: 10 }).left).toBe(-20);
  });

  it('calls an empty rect empty', () => {
    expect(hasArea({ left: 0, top: 0, width: 0, height: 10 })).toBe(false);
    expect(hasArea({ left: 0, top: 0, width: 10, height: 0 })).toBe(false);
    expect(hasArea({ left: 0, top: 0, width: 10, height: 10 })).toBe(true);
  });
});

describe('the font a label is drawn in', () => {
  const base = {
    fontStyle: 'normal',
    fontWeight: '400',
    fontSize: '12px',
    fontFamily: 'Lora, Inter, serif',
  };

  it('builds a shorthand canvas accepts', () => {
    expect(canvasFont(base)).toBe('12px Lora, Inter, serif');
    expect(canvasFont({ ...base, fontWeight: '700' })).toBe('700 12px Lora, Inter, serif');
    expect(canvasFont({ ...base, fontStyle: 'italic' })).toBe('italic 12px Lora, Inter, serif');
  });

  it('refuses a style that cannot make one', () => {
    // An invalid assignment to ctx.font is IGNORED - the canvas silently
    // keeps the previous font and the label is drawn in whatever the last one
    // happened to be. So a bad shorthand must never be built.
    expect(canvasFont({ ...base, fontSize: '' })).toBe('');
    expect(canvasFont({ ...base, fontFamily: '' })).toBe('');
    expect(canvasFont({ ...base, fontSize: '   ' })).toBe('');
  });

  it('knows what is not on the screen', () => {
    expect(isVisibleText({ visibility: 'visible', display: 'block' })).toBe(true);
    expect(isVisibleText({ visibility: 'hidden', display: 'block' })).toBe(false);
    expect(isVisibleText({ visibility: 'collapse', display: 'block' })).toBe(false);
    expect(isVisibleText({ visibility: 'visible', display: 'none' })).toBe(false);
  });
});
