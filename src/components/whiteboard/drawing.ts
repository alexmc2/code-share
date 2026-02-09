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
