import { describe, it, expect } from 'vitest';
import { isUsablePng, PNG_DATA_URL } from '../pdfGeneratorEnhanced';

/**
 * The string that broke PDF export.
 *
 * html2canvas on an element with no layout - a chart in a tab that is not
 * open, which is most of them while somebody is looking at one - produces a
 * 0x0 canvas. `canvas.toDataURL('image/png')` on a 0x0 canvas does not throw
 * and does not return null. It returns the six characters
 *
 *     data:,
 *
 * which is TRUTHY. So it passed `if (chartImage)`, reached jsPDF, and threw
 * `Error: wrong PNG signature` - taking the whole report down, after the user
 * had paid for it. The failure was then reported to them as "the dataset may
 * be too large", which is not true and sends them off sampling their data
 * over a hidden div.
 *
 * Reproduced in the running app before the fix and again after it: the same
 * payload threw, then generated. A real canvas needs a browser, and this
 * suite runs in node, so what is pinned HERE is the predicate - including the
 * exact string a zero-sized canvas produces, because that is the input the
 * old code got wrong.
 */

describe('deciding whether a capture is really a PNG', () => {
  it('rejects what a zero-sized canvas returns', () => {
    // The whole bug in one assertion. Note it is truthy.
    expect('data:,').toBeTruthy();
    expect(isUsablePng('data:,')).toBe(false);
  });

  it('rejects nothing at all', () => {
    expect(isUsablePng(null)).toBe(false);
    expect(isUsablePng(undefined)).toBe(false);
    expect(isUsablePng('')).toBe(false);
  });

  it('rejects an image that is not a PNG', () => {
    // addImage is told 'PNG' at the call site, so a JPEG data URL would be
    // decoded as a PNG and fail the same way.
    expect(isUsablePng('data:image/jpeg;base64,' + 'A'.repeat(500))).toBe(false);
    expect(isUsablePng('data:image/svg+xml;base64,' + 'A'.repeat(500))).toBe(false);
  });

  it('rejects a PNG header with no image behind it', () => {
    // A truncated or empty payload has the right prefix and still cannot be
    // decoded. Length is what separates "an empty white chart", which is
    // thousands of characters, from "nothing", which is a handful.
    expect(isUsablePng(PNG_DATA_URL)).toBe(false);
    expect(isUsablePng(PNG_DATA_URL + 'iVBORw0KGgo=')).toBe(false);
  });

  it('accepts a capture that looks like a real image', () => {
    expect(isUsablePng(PNG_DATA_URL + 'iVBORw0KGgo'.repeat(200))).toBe(true);
  });

  it('is not fooled by a prefix appearing later in the string', () => {
    expect(isUsablePng(`x${PNG_DATA_URL}${'A'.repeat(500)}`)).toBe(false);
  });
});
