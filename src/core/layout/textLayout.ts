export interface TextLineRun {
  text: string;
  width: number;
  /** Horizontal offset from the text block anchor. */
  x: number;
  /** Vertical offset from the text block center. */
  y: number;
}

export interface TextLayoutOptions {
  maxWidth: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing?: number;
  align?: 'start' | 'middle';
}

export interface TextLayout {
  text: string;
  lines: string[];
  runs: TextLineRun[];
  width: number;
  height: number;
  lineHeight: number;
  font: string;
  letterSpacing: number;
  maxWidth: number;
}

export function createTextMeasureContext(fontFamily: string): CanvasRenderingContext2D | undefined {
  if (typeof document === 'undefined') return undefined;
  const context = document.createElement('canvas').getContext('2d') ?? undefined;
  if (context) context.font = `400 11px ${fontFamily}`;
  return context;
}

function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => { segment(value: string): Iterable<{ segment: string }> } }).Segmenter;
  return Segmenter ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment) : Array.from(text);
}

function estimateWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const unit of graphemes(text)) {
    if (/\s/u.test(unit)) width += fontSize * 0.28;
    else if (/^[ilI1.,'`!|:;]$/u.test(unit)) width += fontSize * 0.3;
    else if (/^[MW@#%&]$/u.test(unit)) width += fontSize * 0.9;
    else if (/\p{Extended_Pictographic}/u.test(unit)) width += fontSize;
    else width += fontSize * 0.56;
  }
  return width;
}

function measure(text: string, font: string, fontSize: number, letterSpacing: number, context?: CanvasRenderingContext2D): number {
  if (!text) return 0;
  if (context) {
    context.font = font;
    return context.measureText(text).width + Math.max(0, graphemes(text).length - 1) * letterSpacing;
  }
  return estimateWidth(text, fontSize) + Math.max(0, graphemes(text).length - 1) * letterSpacing;
}

/**
 * Resolve the V1 white-space:normal / overflow-wrap:anywhere policy into explicit lines.
 * The same runs are consumed by the canvas renderer and the native SVG exporter.
 */
export function resolveTextLayout(text: string, options: TextLayoutOptions, context?: CanvasRenderingContext2D): TextLayout {
  const font = `${options.fontWeight} ${options.fontSize}px ${options.fontFamily}`;
  const letterSpacing = options.letterSpacing ?? 0;
  const maxWidth = Math.max(1, options.maxWidth);
  const normalized = text.replace(/\s+/gu, ' ').trim();
  const lines: string[] = [];
  let line = '';
  let lineWidth = 0;
  let lastGrapheme = '';
  const pushLine = () => { lines.push(line); line = ''; lineWidth = 0; lastGrapheme = ''; };

  for (const word of normalized ? normalized.split(' ') : []) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, font, options.fontSize, letterSpacing, context) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) pushLine();
    if (measure(word, font, options.fontSize, letterSpacing, context) <= maxWidth) {
      line = word;
      lineWidth = measure(word, font, options.fontSize, letterSpacing, context);
      lastGrapheme = graphemes(word).at(-1) ?? '';
      continue;
    }
    for (const unit of graphemes(word)) {
      const appendedWidth = line
        ? lineWidth + measure(lastGrapheme + unit, font, options.fontSize, letterSpacing, context) - measure(lastGrapheme, font, options.fontSize, letterSpacing, context)
        : measure(unit, font, options.fontSize, letterSpacing, context);
      if (line && appendedWidth > maxWidth) pushLine();
      if (!line) lineWidth = measure(unit, font, options.fontSize, letterSpacing, context);
      else lineWidth = appendedWidth;
      line += unit;
      lastGrapheme = unit;
    }
  }
  if (line) pushLine();

  const align = options.align ?? 'middle';
  const measuredWidths = lines.map(value => measure(value, font, options.fontSize, letterSpacing, context));
  const width = Math.ceil(Math.max(0, ...measuredWidths));
  const runs = lines.map((value, index) => ({
    text: value,
    width: measuredWidths[index],
    x: align === 'middle' ? -measuredWidths[index] / 2 : 0,
    y: (index - (lines.length - 1) / 2) * options.lineHeight
  }));
  return {
    text: normalized,
    lines,
    runs,
    width,
    height: lines.length * options.lineHeight,
    lineHeight: options.lineHeight,
    font,
    letterSpacing,
    maxWidth
  };
}
