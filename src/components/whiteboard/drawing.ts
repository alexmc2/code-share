import type { DrawOp } from './types';
import { getOpRuns } from './text-model';
import { measureRichText, buildFontString } from './text-measure';

const MAX_TEXT_MEASUREMENT_CACHE_SIZE = 500;
const textMeasurementCache = new Map<string, ReturnType<typeof measureRichText>>();

function getCachedTextMeasurement(
  op: DrawOp,
  defaultSize: number,
  measure: () => ReturnType<typeof measureRichText>,
): ReturnType<typeof measureRichText> {
  // Key on content (runs/text) rather than op.ts, because translateOp/scaleOp
  // update ts on every pointer event during drag, causing continuous cache misses
  // even though text measurement doesn't change with position.
  const cacheKey = `${op.id}:${JSON.stringify(op.runs ?? op.text ?? '')}:${defaultSize}`;
  const cached = textMeasurementCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const measured = measure();
  textMeasurementCache.set(cacheKey, measured);
  if (textMeasurementCache.size > MAX_TEXT_MEASUREMENT_CACHE_SIZE) {
    const oldestKey = textMeasurementCache.keys().next().value;
    if (oldestKey !== undefined) {
      textMeasurementCache.delete(oldestKey);
    }
  }
  return measured;
}

/** Draw a single stroke operation (path, line, rect, circle) */
export function drawStrokeOp(ctx: CanvasRenderingContext2D, op: DrawOp): void {
  ctx.strokeStyle = op.colour;
  ctx.fillStyle = op.colour;
  ctx.lineWidth = op.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (op.type) {
    case 'path':
      if (!op.points || op.points.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(op.points[0].x, op.points[0].y);
      for (let i = 1; i < op.points.length; i++) {
        ctx.lineTo(op.points[i].x, op.points[i].y);
      }
      ctx.stroke();
      break;

    case 'line':
      if (
        op.x1 === undefined ||
        op.y1 === undefined ||
        op.x2 === undefined ||
        op.y2 === undefined
      )
        break;
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(op.x2, op.y2);
      ctx.stroke();
      break;

    case 'rect':
      if (
        op.x1 === undefined ||
        op.y1 === undefined ||
        op.x2 === undefined ||
        op.y2 === undefined
      )
        break;
      ctx.strokeRect(
        Math.min(op.x1, op.x2),
        Math.min(op.y1, op.y2),
        Math.abs(op.x2 - op.x1),
        Math.abs(op.y2 - op.y1),
      );
      break;

    case 'circle': {
      if (
        op.x1 === undefined ||
        op.y1 === undefined ||
        op.x2 === undefined ||
        op.y2 === undefined
      )
        break;
      // Circles are stored as center (x1,y1) with rx=|x2-x1|, ry=|y2-y1|.
      // After non-uniform scaling rx and ry may differ, producing an ellipse.
      const rx = Math.abs(op.x2 - op.x1);
      const ry = Math.abs(op.y2 - op.y1);
      ctx.beginPath();
      ctx.ellipse(op.x1, op.y1, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
  }
}

/** Draw an eraseStroke op with destination-out compositing */
export function drawEraseStrokePath(
  ctx: CanvasRenderingContext2D,
  op: DrawOp,
): void {
  if (!op.points || op.points.length < 1) return;

  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = op.size;
  ctx.strokeStyle = 'rgba(0,0,0,1)'; // Color doesn't matter for destination-out

  ctx.beginPath();
  ctx.moveTo(op.points[0].x, op.points[0].y);
  for (let i = 1; i < op.points.length; i++) {
    ctx.lineTo(op.points[i].x, op.points[i].y);
  }
  ctx.stroke();

  ctx.restore(); // Restores globalCompositeOperation to previous value
}

/** For fillCanvas, paint the background color to "erase" since it's opaque. */
export function drawEraseStrokeOnFill(
  ctx: CanvasRenderingContext2D,
  op: DrawOp,
  backgroundColor: string,
): void {
  if (!op.points || op.points.length < 1) return;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over'; // Normal drawing
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = op.size;
  ctx.strokeStyle = backgroundColor; // Paint background color to "erase"

  ctx.beginPath();
  ctx.moveTo(op.points[0].x, op.points[0].y);
  for (let i = 1; i < op.points.length; i++) {
    ctx.lineTo(op.points[i].x, op.points[i].y);
  }
  ctx.stroke();

  ctx.restore();
}

/** Draw a text operation, supporting both legacy single-style and rich-text runs. */
export function drawTextOp(ctx: CanvasRenderingContext2D, op: DrawOp): void {
  if (op.type !== 'text') return;
  if (
    op.x1 === undefined ||
    op.y1 === undefined ||
    op.x2 === undefined ||
    op.y2 === undefined
  )
    return;

  const runs = getOpRuns(op);
  // Check if there's any actual text content
  const hasText = runs.some((r) => r.text.length > 0);
  if (!hasText) return;

  const defaultSize = op.size || 24;
  const measured = getCachedTextMeasurement(op, defaultSize, () =>
    measureRichText(runs, defaultSize),
  );

  if (measured.width <= 0 || measured.height <= 0) return;

  const boxWidth = Math.abs(op.x2 - op.x1);
  const boxHeight = Math.abs(op.y2 - op.y1);
  const scaleX = boxWidth / measured.width;
  const scaleY = boxHeight / measured.height;

  ctx.save();
  ctx.translate(Math.min(op.x1, op.x2), Math.min(op.y1, op.y2));
  ctx.scale(scaleX, scaleY);
  ctx.textBaseline = 'top';

  let y = 0;
  for (const line of measured.lines) {
    let x = 0;
    for (const seg of line.segments) {
      ctx.font = buildFontString(seg.size, seg.bold, seg.italic, seg.fontFamily);
      ctx.fillStyle = seg.colour || op.colour;
      ctx.fillText(seg.text, x, y);
      x += seg.width;
    }
    y += line.height;
  }

  ctx.restore();
}
