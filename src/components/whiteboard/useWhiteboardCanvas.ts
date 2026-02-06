import { useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import type { DrawOp } from './types';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './types';
import {
  drawStrokeOp,
  drawEraseStrokePath,
  drawEraseStrokeOnFill,
} from './drawing';
import { floodFillWithBoundary } from './flood-fill';
import type * as Y from 'yjs';

export interface WhiteboardCanvasState {
  getBackgroundColor: () => string;
  scheduleViewportRender: () => void;
}

export function useWhiteboardCanvas(
  isDark: boolean,
  opsArray: Y.Array<DrawOp>,
  transformRef: React.RefObject<{ x: number; y: number; scale: number }>,
  currentOpRef: React.RefObject<DrawOp | null>,
  updateViewportForResize: () => void,
  canvasCssWidthRef: React.RefObject<number>,
  canvasCssHeightRef: React.RefObject<number>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
): WhiteboardCanvasState {
  // Offscreen canvases
  const worldCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const boundaryStrokeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const visibleStrokeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fillCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Track if world canvas needs rebuild
  const worldNeedsRebuildRef = useRef(true);

  // rAF scheduling
  const rafIdRef = useRef<number | null>(null);

  // Get canvas context
  const getContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext('2d');
  }, [canvasRef]);

  // Get background color based on theme
  const getBackgroundColor = useCallback(() => {
    return isDark ? '#111827' : '#ffffff';
  }, [isDark]);

  // Resize canvas to match container with proper DPR handling
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Set backing store size (physical pixels)
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);

    // Store CSS dimensions for renderViewport
    canvasCssWidthRef.current = rect.width;
    canvasCssHeightRef.current = rect.height;
  }, [canvasRef, containerRef, canvasCssWidthRef, canvasCssHeightRef]);

  // Initialize offscreen canvases
  const initOffscreenCanvases = useCallback(() => {
    if (!worldCanvasRef.current) {
      worldCanvasRef.current = document.createElement('canvas');
      worldCanvasRef.current.width = CANVAS_WIDTH;
      worldCanvasRef.current.height = CANVAS_HEIGHT;
    }
    if (!boundaryStrokeCanvasRef.current) {
      boundaryStrokeCanvasRef.current = document.createElement('canvas');
      boundaryStrokeCanvasRef.current.width = CANVAS_WIDTH;
      boundaryStrokeCanvasRef.current.height = CANVAS_HEIGHT;
    }
    if (!visibleStrokeCanvasRef.current) {
      visibleStrokeCanvasRef.current = document.createElement('canvas');
      visibleStrokeCanvasRef.current.width = CANVAS_WIDTH;
      visibleStrokeCanvasRef.current.height = CANVAS_HEIGHT;
    }
    if (!fillCanvasRef.current) {
      fillCanvasRef.current = document.createElement('canvas');
      fillCanvasRef.current.width = CANVAS_WIDTH;
      fillCanvasRef.current.height = CANVAS_HEIGHT;
    }
  }, []);

  // Rebuilds the world canvas by replaying all operations in order.
  const rebuildWorldCanvas = useCallback(() => {
    initOffscreenCanvases();

    const worldCanvas = worldCanvasRef.current;
    const boundaryStrokeCanvas = boundaryStrokeCanvasRef.current;
    const visibleStrokeCanvas = visibleStrokeCanvasRef.current;
    const fillCanvas = fillCanvasRef.current;

    if (
      !worldCanvas ||
      !boundaryStrokeCanvas ||
      !visibleStrokeCanvas ||
      !fillCanvas
    )
      return;

    const worldCtx = worldCanvas.getContext('2d');
    const boundaryStrokeCtx = boundaryStrokeCanvas.getContext('2d');
    const visibleStrokeCtx = visibleStrokeCanvas.getContext('2d');
    const fillCtx = fillCanvas.getContext('2d');

    if (!worldCtx || !boundaryStrokeCtx || !visibleStrokeCtx || !fillCtx)
      return;

    // Clear canvases
    boundaryStrokeCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // visibleStrokeCanvas: transparent (visible strokes after erasing)
    visibleStrokeCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // fillCanvas: Use theme background color (solid base for flood fill)
    fillCtx.fillStyle = getBackgroundColor();
    fillCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Replay ops in order
    const deletedIds = new Set<string>();
    const ops = opsArray.toArray();

    for (const op of ops) {
      // Handle legacy erase ops: add eraseIds to deleted set
      if (op.type === 'erase' && op.eraseIds) {
        for (const id of op.eraseIds) {
          deletedIds.add(id);
        }
        continue;
      }

      // Skip deleted ops
      if (deletedIds.has(op.id)) continue;

      if (op.type === 'eraseStroke') {
        const bgColor = getBackgroundColor();
        drawEraseStrokePath(boundaryStrokeCtx, op);
        drawEraseStrokePath(visibleStrokeCtx, op);
        drawEraseStrokeOnFill(fillCtx, op, bgColor);
      } else if (op.type === 'fill') {
        // Read CURRENT boundaryStrokeCanvas state ensuring fill only sees strokes before it
        if (op.x1 !== undefined && op.y1 !== undefined) {
          const currentStrokeData = boundaryStrokeCtx.getImageData(
            0,
            0,
            CANVAS_WIDTH,
            CANVAS_HEIGHT,
          );
          floodFillWithBoundary(
            fillCtx,
            currentStrokeData,
            op.x1,
            op.y1,
            op.colour,
          );
        }
      } else {
        // Draw stroke to both stroke canvases
        drawStrokeOp(boundaryStrokeCtx, op);
        drawStrokeOp(visibleStrokeCtx, op);
      }
    }

    // Composite to world canvas (transparent background)
    worldCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Order: fillCanvas (bottom) -> visibleStrokeCanvas (top)
    worldCtx.drawImage(fillCanvas, 0, 0);
    worldCtx.drawImage(visibleStrokeCanvas, 0, 0);

    worldNeedsRebuildRef.current = false;
  }, [opsArray, initOffscreenCanvases, getBackgroundColor]);

  // Renders the viewport efficiently using physical pixels to prevent seams
  const renderViewport = useCallback(() => {
    const ctx = getContext();
    const canvas = canvasRef.current;
    const worldCanvas = worldCanvasRef.current;

    if (!ctx || !canvas || !worldCanvas) return;

    // Work in physical pixels directly (canvas.width/height are already DPR-scaled)
    const physWidth = canvas.width;
    const physHeight = canvas.height;
    const dpr = window.devicePixelRatio || 1;

    // Reset to identity transform - we work in physical pixels
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Clear canvas (background already in worldCanvas)
    ctx.clearRect(0, 0, physWidth, physHeight);

    // Source coordinates in world space
    const srcX = Math.floor(Math.max(0, transformRef.current.x));
    const srcY = Math.floor(Math.max(0, transformRef.current.y));

    // Calculate how much of the world we're viewing
    const cssWidth = physWidth / dpr;
    const cssHeight = physHeight / dpr;
    const viewWorldW = cssWidth / transformRef.current.scale;
    const viewWorldH = cssHeight / transformRef.current.scale;

    // Clamp source dimensions to world canvas bounds
    const srcW = Math.min(viewWorldW, CANVAS_WIDTH - srcX);
    const srcH = Math.min(viewWorldH, CANVAS_HEIGHT - srcY);

    // Draw world canvas on top
    if (srcW > 0 && srcH > 0) {
      ctx.drawImage(
        worldCanvas,
        srcX,
        srcY,
        srcW,
        srcH,
        0,
        0,
        physWidth,
        physHeight,
      );
    }

    // Draw current operation preview
    if (
      currentOpRef.current &&
      currentOpRef.current.type !== 'erase' &&
      currentOpRef.current.type !== 'fill'
    ) {
      ctx.save();

      // Scale world coords to physical pixels
      const worldToPhys = dpr * transformRef.current.scale;
      ctx.scale(worldToPhys, worldToPhys);
      ctx.translate(-transformRef.current.x, -transformRef.current.y);

      if (currentOpRef.current.type === 'eraseStroke') {
        // Preview eraseStroke
        if (
          currentOpRef.current.points &&
          currentOpRef.current.points.length > 0
        ) {
          ctx.globalCompositeOperation = 'source-over';
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.lineWidth = currentOpRef.current.size;
          ctx.strokeStyle = getBackgroundColor();

          ctx.beginPath();
          ctx.moveTo(
            currentOpRef.current.points[0].x,
            currentOpRef.current.points[0].y,
          );
          for (let i = 1; i < currentOpRef.current.points.length; i++) {
            ctx.lineTo(
              currentOpRef.current.points[i].x,
              currentOpRef.current.points[i].y,
            );
          }
          ctx.stroke();
        }
      } else {
        drawStrokeOp(ctx, currentOpRef.current);
      }

      ctx.restore();
    }
  }, [getContext, getBackgroundColor, transformRef, currentOpRef, canvasRef]);

  // Schedule viewport render
  const scheduleViewportRender = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(() => {
      renderViewport();
      rafIdRef.current = null;
    });
  }, [renderViewport]);

  // Rebuild world canvas on data changes
  useEffect(() => {
    worldNeedsRebuildRef.current = true;
    rebuildWorldCanvas();
    scheduleViewportRender();
  }, [opsArray, rebuildWorldCanvas, scheduleViewportRender]);

  // Re-render on theme change
  useEffect(() => {
    worldNeedsRebuildRef.current = true;
    rebuildWorldCanvas();
    scheduleViewportRender();
  }, [isDark, rebuildWorldCanvas, scheduleViewportRender]);

  // Handle resize
  useLayoutEffect(() => {
    resizeCanvas();
    updateViewportForResize();
    scheduleViewportRender();

    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      updateViewportForResize();
      scheduleViewportRender();
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [
    resizeCanvas,
    updateViewportForResize,
    scheduleViewportRender,
    containerRef,
  ]);

  // Subscribe to Yjs changes
  useEffect(() => {
    const observer = () => {
      worldNeedsRebuildRef.current = true;
      rebuildWorldCanvas();
      scheduleViewportRender();
    };

    opsArray.observe(observer);

    return () => {
      opsArray.unobserve(observer);
    };
  }, [opsArray, rebuildWorldCanvas, scheduleViewportRender]);

  // Set touch-action on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.touchAction = 'none';
    }
  }, [canvasRef]);

  return {
    getBackgroundColor,
    scheduleViewportRender,
  };
}
