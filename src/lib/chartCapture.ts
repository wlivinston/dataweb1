/**
 * Turning a rendered chart into an image, for the PDF report.
 *
 * WHY THIS IS NOT html2canvas.
 *
 * Measured in the running app, Visualizations tab, one 218x240 bar chart:
 *
 *   html2canvas(element)        9,149 ms
 *   this module                    25 ms
 *
 * and the nine seconds are not spent waiting. A `setTimeout(..., 100)` armed
 * immediately before the html2canvas call fired at 8,970 ms: the main thread
 * is blocked for the whole capture, because html2canvas clones the entire
 * document and re-reads every computed style in the clone. The cost therefore
 * scales with the size of the PAGE, not the size of the chart - which is why
 * it got worse, not better, when the user opened the Visualizations tab (one
 * report took 28 seconds there against 11 on the dashboard).
 *
 * Two consequences, both of which the report was living with.
 *
 * The 3.5 second per-chart timeout guarding those calls could not fire. It is
 * a timer, and timers do not run while the thread is blocked; it resolved
 * only once the capture it was supposed to interrupt had already finished and
 * handed back the thread. So it never saved any time. It only threw away the
 * image after the full price had been paid, and the PDF fell back to drawing
 * a simplified chart - three times over, for a user staring at a frozen tab.
 *
 * And the captures that did come back were unusable anyway. The call passed
 * `windowWidth: Math.min(element.scrollWidth || 800, 1000)`, which does not
 * mean "crop to this" - it means "lay the cloned document out in a window
 * this wide". For a 218px chart that is a 218px viewport, so the chart
 * reflowed to nothing: the canvas came back 22 x 240. A 22-pixel-wide sliver
 * stretched across the width of the page.
 *
 * WHAT THIS DOES INSTEAD. Recharts draws into `<svg>`, and an SVG can be
 * serialised, handed to an Image, and painted into a canvas by the browser's
 * own renderer. No clone of the document, no computed styles, no layout.
 *
 * A chart card is not only its SVG, though. Recharts renders the legend as
 * HTML next to the chart - that is where a pie's slice names live - so every
 * `<svg>` in the element is painted at its own position (which picks up the
 * legend's colour swatches, each its own tiny SVG), and then the text nodes
 * outside those SVGs are drawn with the font and colour the browser computed
 * for them. Verified against the live pie chart: slices, leader lines,
 * percentage labels, swatches and "Ghana (26.3%)" all present.
 *
 * WHAT IT DOES NOT DO. HTML that carries meaning through something other than
 * text or SVG - a background-coloured div, a CSS-drawn shape, a bitmap - is
 * not painted. If a chart is ever built that way this returns an image
 * missing part of itself, which is worse than returning nothing, so anything
 * without an SVG inside it is refused outright and the caller draws its own
 * simplified chart instead.
 */

/**
 * WHY THE IMAGE IS A JPEG.
 *
 * Because of how jsPDF embeds each format, which is not what the file sizes
 * on their own would suggest. The same six charts, measured:
 *
 *   PNG  into new jsPDF()                 3,763,690 bytes    571 ms
 *   PNG  into new jsPDF({compress:true})    140,613 bytes  2,635 ms
 *   JPEG into new jsPDF()                   165,554 bytes    157 ms
 *
 * The captures themselves are about 17 KB each either way. A JPEG is stored
 * in the PDF exactly as it arrives, while a PNG is decoded to a raw bitmap
 * and then written out uncompressed unless the whole document is deflated -
 * which costs two and a half seconds of blocked main thread to get back to
 * the size the JPEG was already at.
 *
 * At quality 0.95 and twice the on-screen size, axis labels and legends are
 * indistinguishable from the lossless capture. Compared side by side before
 * choosing this.
 */
export type CaptureFormat = 'PNG' | 'JPEG';

export const DATA_URL_PREFIX: Record<CaptureFormat, string> = {
  PNG: 'data:image/png;base64,',
  JPEG: 'data:image/jpeg;base64,',
};

const MIME_TYPE: Record<CaptureFormat, string> = {
  PNG: 'image/png',
  JPEG: 'image/jpeg',
};

/** Quality for a JPEG capture. Ignored for a PNG. */
export const CAPTURE_QUALITY = 0.95;

/**
 * Whether a data URL really holds an image of the format it is said to hold.
 *
 * THE BUG THIS EXISTS FOR. Capturing an element with no layout - a chart
 * sitting in a tab that is not open, which is most of them while the user is
 * looking at one - produces a 0x0 canvas. `canvas.toDataURL('image/png')` on
 * a 0x0 canvas does not fail and does not return null: it returns the string
 * "data:,". That is TRUTHY, so it sailed through an `if (chartImage)` guard
 * and reached jsPDF, which threw
 *
 *     Error: wrong PNG signature
 *
 * and took the whole report down with it - after the user had paid for it.
 * The error was then reported to them as "the dataset may be too large",
 * which is not true and sends them off sampling their data over a hidden div.
 *
 * The format is checked and not merely assumed because addImage is TOLD the
 * format at the call site: hand it a JPEG while saying 'PNG' and it fails the
 * same way.
 *
 * Checked by prefix and by length rather than by decoding: a real capture of
 * an empty white chart is still thousands of characters, and "data:," is six.
 */
export const isUsableImage = (
  value: string | null | undefined,
  format: CaptureFormat
): value is string => {
  const prefix = DATA_URL_PREFIX[format];
  return typeof value === 'string' && value.startsWith(prefix) && value.length > prefix.length + 100;
};

/** The parts of a DOMRect this module uses. Narrowed so it can be tested. */
export interface CaptureRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CapturedChart {
  /** A data URL in `format`. */
  dataUrl: string;
  /** What to tell jsPDF's addImage this is. */
  format: CaptureFormat;
  /** Pixel size of the image, so the caller can keep its aspect ratio. */
  width: number;
  height: number;
}

/**
 * Drawn at twice the on-screen size. A chart placed about 150mm wide on an A4
 * page is around 2.5x its on-screen size already; at scale 1 the text in the
 * PDF is visibly soft.
 */
export const CAPTURE_SCALE = 2;

/**
 * How long one SVG may take to decode.
 *
 * Unlike the timeout this replaces, this one can actually fire: decoding
 * happens off the main thread, so the timer is free to run. It is a guard
 * against a pathological SVG, not a budget - a real one takes single-digit
 * milliseconds.
 */
export const SVG_DECODE_TIMEOUT_MS = 2000;

export const hasArea = (rect: CaptureRect): boolean =>
  rect.width > 0 && rect.height > 0;

/**
 * Where a rect sits inside the element being captured.
 *
 * Both are viewport coordinates; the canvas origin is the element's top-left
 * corner. A child that overflows its parent gets a negative offset and is
 * clipped by the canvas, exactly as it is clipped on screen.
 */
export const placeWithin = (box: CaptureRect, rect: CaptureRect): CaptureRect => ({
  left: rect.left - box.left,
  top: rect.top - box.top,
  width: rect.width,
  height: rect.height,
});

/** The style properties this module reads, so a test can supply them. */
export interface TextStyle {
  fontStyle: string;
  fontWeight: string;
  fontSize: string;
  fontFamily: string;
  color: string;
  visibility: string;
  display: string;
}

/**
 * A canvas `font` shorthand built from a computed style.
 *
 * Returns '' when the style cannot produce a valid shorthand. Canvas IGNORES
 * an invalid assignment to ctx.font and silently keeps the previous value, so
 * a malformed one here would not fail - it would draw the previous label's
 * font, which is the kind of wrong that gets shipped.
 */
export const canvasFont = (style: Pick<TextStyle, 'fontStyle' | 'fontWeight' | 'fontSize' | 'fontFamily'>): string => {
  const size = (style.fontSize || '').trim();
  const family = (style.fontFamily || '').trim();
  if (!size || !family) return '';

  const parts: string[] = [];
  const fontStyle = (style.fontStyle || '').trim();
  // 'normal' is the default for both; including it is legal but noisy.
  if (fontStyle && fontStyle !== 'normal') parts.push(fontStyle);
  const weight = (style.fontWeight || '').trim();
  if (weight && weight !== 'normal' && weight !== '400') parts.push(weight);
  parts.push(size, family);
  return parts.join(' ');
};

/** Whether text with this style is actually on the screen. */
export const isVisibleText = (style: Pick<TextStyle, 'visibility' | 'display'>): boolean =>
  style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none';

/**
 * The largest a captured image can be printed without distorting it.
 *
 * Both bounds are respected and the aspect ratio is kept, so the result fits
 * inside the box rather than filling it. A chart with no height to speak of
 * would divide by zero, so it is given the box's width and nothing more.
 */
export const fitWithin = (
  image: { width: number; height: number },
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } => {
  if (!(image.width > 0) || !(image.height > 0)) {
    return { width: maxWidth, height: maxHeight };
  }

  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  return { width: image.width * scale, height: image.height * scale };
};

/**
 * Paint one SVG into the canvas at its own position within the capture.
 *
 * The clone carries explicit width and height because a Recharts SVG sizes
 * itself from its container, and the container does not come with it. It also
 * carries the font the page computed: inside an image the SVG is its own
 * document with no stylesheet, so an inherited font-family is otherwise lost
 * and every label falls back to the browser default.
 */
const paintSvg = async (
  ctx: CanvasRenderingContext2D,
  svg: SVGSVGElement,
  box: CaptureRect
): Promise<void> => {
  const rect = svg.getBoundingClientRect();
  if (!hasArea(rect)) return;

  const style = window.getComputedStyle(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.round(rect.width)));
  clone.setAttribute('height', String(Math.round(rect.height)));
  clone.style.fontFamily = style.fontFamily;
  clone.style.fontSize = style.fontSize;

  const markup = new XMLSerializer().serializeToString(clone);
  const image = new Image();
  const decoded = new Promise<boolean>(resolve => {
    const timer = window.setTimeout(() => resolve(false), SVG_DECODE_TIMEOUT_MS);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(true);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
  });
  // encodeURIComponent, not btoa: the markup can contain characters outside
  // Latin-1 (a currency symbol in an axis label is enough) and btoa throws on
  // those.
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

  if (!(await decoded)) return;

  const at = placeWithin(box, rect);
  ctx.drawImage(image, at.left, at.top, at.width, at.height);
};

/**
 * Paint the text that is not inside an SVG - the HTML legend, mostly.
 *
 * Measured from the text node rather than its element: an element's box can
 * be wider than the text it holds, and a centred label drawn from the
 * element's left edge lands in the wrong place.
 */
const paintText = (ctx: CanvasRenderingContext2D, element: HTMLElement, box: CaptureRect): void => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    const text = (node.nodeValue || '').trim();
    const parent = node.parentElement;
    // Text inside an SVG was already painted with that SVG.
    if (text && parent && !parent.closest('svg')) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      const style = window.getComputedStyle(parent);
      const font = canvasFont(style);

      if (hasArea(rect) && font && isVisibleText(style)) {
        const at = placeWithin(box, rect);
        ctx.font = font;
        ctx.fillStyle = style.color;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, at.left, at.top + at.height / 2);
      }
    }
    node = walker.nextNode();
  }
};

/**
 * Capture a chart element as a PNG, or return null if it cannot be captured.
 *
 * Null is a normal answer, not an error: an element with no layout - a chart
 * on a tab nobody has opened - cannot be photographed, and the caller draws
 * the chart from its data instead.
 */
export const captureChartElement = async (
  element: HTMLElement,
  { scale = CAPTURE_SCALE, format = 'JPEG' as CaptureFormat, quality = CAPTURE_QUALITY } = {}
): Promise<CapturedChart | null> => {
  const box = element.getBoundingClientRect();
  if (!hasArea(box)) return null;

  const svgs = Array.from(element.querySelectorAll('svg')).filter(svg =>
    hasArea(svg.getBoundingClientRect())
  );
  // No SVG means this is not a chart we know how to photograph faithfully.
  if (svgs.length === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(box.width * scale);
  canvas.height = Math.round(box.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // The report is printed on white. A chart card with a transparent or dark
  // background would otherwise come out as a black rectangle.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);

  for (const svg of svgs) {
    await paintSvg(ctx, svg, box);
  }
  paintText(ctx, element, box);

  try {
    const dataUrl = canvas.toDataURL(MIME_TYPE[format], quality);
    // The 0x0 case cannot happen here - the element was measured first - but
    // a browser is free to refuse a canvas for its own reasons, and what it
    // returns then is a truthy string.
    if (!isUsableImage(dataUrl, format)) return null;

    return {
      dataUrl,
      format,
      width: canvas.width,
      height: canvas.height,
    };
  } catch {
    // toDataURL throws SecurityError on a tainted canvas - an image from
    // another origin drawn into the chart would do it.
    return null;
  }
};
