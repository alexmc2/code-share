import type { DrawOp } from './types';

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

/** Draw a text operation, scaling the text to fit within the bounding box. */
export function drawTextOp(ctx: CanvasRenderingContext2D, op: DrawOp): void {
  if (op.type !== 'text' || !op.text) return;
  if (
    op.x1 === undefined ||
    op.y1 === undefined ||
    op.x2 === undefined ||
    op.y2 === undefined
  )
    return;

  const fontSize = op.size || 24;
  const boldStr = op.bold ? 'bold ' : '';
  const italicStr = op.italic ? 'italic ' : '';
  const family = op.fontFamily || 'sans-serif';
  const font = `${italicStr}${boldStr}${fontSize}px ${family}`;

  ctx.save();
  ctx.font = font;
  ctx.textBaseline = 'top';

  const lines = op.text.split('\n');
  const lineHeight = fontSize * 1.2;

  // Compute natural dimensions at the original font size
  let naturalWidth = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > naturalWidth) naturalWidth = w;
  }
  const naturalHeight = lineHeight * lines.length;

  if (naturalWidth <= 0 || naturalHeight <= 0) {
    ctx.restore();
    return;
  }

  const boxWidth = Math.abs(op.x2 - op.x1);
  const boxHeight = Math.abs(op.y2 - op.y1);
  const scaleX = boxWidth / naturalWidth;
  const scaleY = boxHeight / naturalHeight;

  ctx.translate(Math.min(op.x1, op.x2), Math.min(op.y1, op.y2));
  ctx.scale(scaleX, scaleY);
  ctx.fillStyle = op.colour;
  ctx.font = font;
  ctx.textBaseline = 'top';

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], 0, i * lineHeight);
  }

  ctx.restore();
}
