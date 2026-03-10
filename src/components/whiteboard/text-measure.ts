import type { TextRun } from './types';

// ---------------------------------------------------------------------------
// Font string helpers
// ---------------------------------------------------------------------------

export function buildFontString(
  size: number,
  bold?: boolean,
  italic?: boolean,
  fontFamily?: string,
): string {
  const b = bold ? 'bold ' : '';
  const i = italic ? 'italic ' : '';
  return `${i}${b}${size}px ${fontFamily || 'sans-serif'}`;
}

// ---------------------------------------------------------------------------
// Line splitting
// ---------------------------------------------------------------------------

/** A segment of a single line: a run (or portion of a run) that contains no newlines. */
export interface LineSegment {
  text: string;
  colour?: string;
  size: number;
  bold?: boolean;
  italic?: boolean;
  fontFamily?: string;
}

/** A measured line: its segments plus computed metrics. */
export interface MeasuredLine {
  segments: LineSegment[];
  width: number;
  height: number; // lineHeight (max segment size * 1.2)
  baseFontSize: number; // max segment size in this line
}

/**
 * Split runs into lines (at '\n' boundaries), then into per-line segments.
 * Each segment is a contiguous piece of text with uniform style on a single line.
 */
export function splitRunsIntoLines(
  runs: TextRun[],
  defaultSize: number,
): LineSegment[][] {
  const lines: LineSegment[][] = [[]];

  for (const run of runs) {
    const parts = run.text.split('\n');
    for (let p = 0; p < parts.length; p++) {
      if (p > 0) {
        // Start a new line
        lines.push([]);
      }
      const text = parts[p];
      if (text.length > 0) {
        lines[lines.length - 1].push({
          text,
          colour: run.colour,
          size: run.size ?? defaultSize,
          bold: run.bold,
          italic: run.italic,
          fontFamily: run.fontFamily,
        });
      }
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

let _measureCanvas: HTMLCanvasElement | null = null;

function getMeasureCtx(): CanvasRenderingContext2D {
  if (!_measureCanvas) {
    _measureCanvas = document.createElement('canvas');
  }
  return _measureCanvas.getContext('2d')!;
}

/**
 * Measure a set of runs, returning per-line metrics and overall bounding box.
 */
export function measureRichText(
  runs: TextRun[],
  defaultSize: number,
): { lines: MeasuredLine[]; width: number; height: number } {
  const ctx = getMeasureCtx();
  const lineSegments = splitRunsIntoLines(runs, defaultSize);

  let totalWidth = 0;
  let totalHeight = 0;
  const measuredLines: MeasuredLine[] = [];

  for (const segments of lineSegments) {
    let lineWidth = 0;
    let maxSize = defaultSize;

    for (const seg of segments) {
      ctx.font = buildFontString(seg.size, seg.bold, seg.italic, seg.fontFamily);
      lineWidth += ctx.measureText(seg.text).width;
      if (seg.size > maxSize) maxSize = seg.size;
    }

    // Empty line still has height based on default size
    if (segments.length === 0) {
      maxSize = defaultSize;
    }

    const lineHeight = maxSize * 1.2;
    measuredLines.push({
      segments,
      width: lineWidth,
      height: lineHeight,
      baseFontSize: maxSize,
    });

    if (lineWidth > totalWidth) totalWidth = lineWidth;
    totalHeight += lineHeight;
  }

  return {
    lines: measuredLines,
    width: Math.max(totalWidth, 1),
    height: Math.max(totalHeight, 1),
  };
}
