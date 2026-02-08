import { useRef, useCallback } from 'react';
import type { Point, PointerState } from './types';
import { CANVAS_WIDTH, CANVAS_HEIGHT, MIN_SCALE, MAX_SCALE } from './types';

export interface ViewportState {
  transformRef: React.RefObject<{ x: number; y: number; scale: number }>;
  isPanning: React.RefObject<boolean>;
  lastPanPoint: React.RefObject<Point>;
  lastPinchDistance: React.RefObject<number>;
  hasInitializedViewport: React.RefObject<boolean>;
  lastResizeSizeRef: React.RefObject<{
    width: number;
    height: number;
  } | null>;
  hasUserViewportChangeRef: React.RefObject<boolean>;
  activePointersRef: React.RefObject<Map<number, PointerState>>;
  clampTransform: (
    x: number,
    y: number,
    scale: number,
  ) => { x: number; y: number; scale: number };
  centerViewport: (scale?: number) => void;
  updateViewportForResize: () => void;
  getActiveTouchPoints: () => PointerState[];
  getTouchCentroid: (points: PointerState[]) => Point;
  getTouchDistance: (points: PointerState[]) => number;
}

export function useViewport(
  canvasCssWidthRef: React.RefObject<number>,
  canvasCssHeightRef: React.RefObject<number>,
): ViewportState {
  // Viewport transform (refs for direct manipulation, bypassing React render cycle)
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const isPanning = useRef(false);
  const lastPanPoint = useRef<Point>({ x: 0, y: 0 }); // canvas-local CSS pixels
  const lastPinchDistance = useRef(0);
  const hasInitializedViewport = useRef(false);
  const lastResizeSizeRef = useRef<{ width: number; height: number } | null>(
    null,
  );
  const hasUserViewportChangeRef = useRef(false);
  const activePointersRef = useRef<Map<number, PointerState>>(new Map());

  // Clamp viewport to the whiteboard world bounds.
  // When zoomed out enough that the viewport is larger than the world, allow
  // a small negative origin range so the world can still be centered/panned.
  const clampTransform = useCallback(
    (x: number, y: number, scale: number) => {
      const cssWidth = canvasCssWidthRef.current;
      const cssHeight = canvasCssHeightRef.current;

      if (cssWidth <= 0 || cssHeight <= 0) {
        const fallbackScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
        return { x: 0, y: 0, scale: fallbackScale };
      }

      // Dynamic floor prevents the viewport from becoming larger than the
      // whiteboard world, which keeps drag limits intuitive at min zoom.
      const minScaleForViewport = Math.max(
        MIN_SCALE,
        cssWidth / CANVAS_WIDTH,
        cssHeight / CANVAS_HEIGHT,
      );
      const clampedScale = Math.max(
        minScaleForViewport,
        Math.min(MAX_SCALE, scale),
      );

      const viewWorldW = cssWidth / clampedScale;
      const viewWorldH = cssHeight / clampedScale;

      const minX = Math.min(0, CANVAS_WIDTH - viewWorldW);
      const maxX = Math.max(0, CANVAS_WIDTH - viewWorldW);
      const minY = Math.min(0, CANVAS_HEIGHT - viewWorldH);
      const maxY = Math.max(0, CANVAS_HEIGHT - viewWorldH);

      return {
        x: Math.max(minX, Math.min(maxX, x)),
        y: Math.max(minY, Math.min(maxY, y)),
        scale: clampedScale,
      };
    },
    [canvasCssWidthRef, canvasCssHeightRef],
  );

  // Center viewport after initial sizing or major orientation/size changes.
  const centerViewport = useCallback(
    (scale = transformRef.current.scale) => {
      const cssWidth = canvasCssWidthRef.current;
      const cssHeight = canvasCssHeightRef.current;
      if (cssWidth <= 0 || cssHeight <= 0) return;

      const viewWorldW = cssWidth / scale;
      const viewWorldH = cssHeight / scale;
      const centeredX = (CANVAS_WIDTH - viewWorldW) / 2;
      const centeredY = (CANVAS_HEIGHT - viewWorldH) / 2;

      // Center using canvas CSS size, then clamp within world bounds.
      transformRef.current = clampTransform(centeredX, centeredY, scale);
    },
    [canvasCssWidthRef, canvasCssHeightRef, clampTransform],
  );

  const updateViewportForResize = useCallback(() => {
    const cssWidth = canvasCssWidthRef.current;
    const cssHeight = canvasCssHeightRef.current;
    if (cssWidth <= 0 || cssHeight <= 0) return;

    const prev = lastResizeSizeRef.current;
    const orientationChanged =
      prev !== null && prev.width > prev.height !== cssWidth > cssHeight;
    const sizeChangeLarge =
      prev !== null &&
      (Math.abs(cssWidth - prev.width) > prev.width * 0.15 ||
        Math.abs(cssHeight - prev.height) > prev.height * 0.15);

    const shouldRecenter =
      !hasInitializedViewport.current ||
      ((orientationChanged || sizeChangeLarge) &&
        !hasUserViewportChangeRef.current);

    if (shouldRecenter) {
      centerViewport();
    } else {
      transformRef.current = clampTransform(
        transformRef.current.x,
        transformRef.current.y,
        transformRef.current.scale,
      );
    }

    hasInitializedViewport.current = true;
    lastResizeSizeRef.current = { width: cssWidth, height: cssHeight };
  }, [canvasCssWidthRef, canvasCssHeightRef, centerViewport, clampTransform]);

  // Touch helpers
  const getActiveTouchPoints = useCallback((): PointerState[] => {
    const points: PointerState[] = [];
    activePointersRef.current.forEach((pointer) => {
      if (pointer.pointerType === 'touch') {
        points.push(pointer);
      }
    });
    return points;
  }, []);

  const getTouchCentroid = useCallback((points: PointerState[]): Point => {
    if (points.length === 0) return { x: 0, y: 0 };
    let sumX = 0;
    let sumY = 0;
    for (const p of points) {
      sumX += p.x;
      sumY += p.y;
    }
    return {
      x: sumX / points.length,
      y: sumY / points.length,
    };
  }, []);

  const getTouchDistance = useCallback((points: PointerState[]): number => {
    if (points.length < 2) return 0;
    const dx = points[1].x - points[0].x;
    const dy = points[1].y - points[0].y;
    return Math.hypot(dx, dy);
  }, []);

  return {
    transformRef,
    isPanning,
    lastPanPoint,
    lastPinchDistance,
    hasInitializedViewport,
    lastResizeSizeRef,
    hasUserViewportChangeRef,
    activePointersRef,
    clampTransform,
    centerViewport,
    updateViewportForResize,
    getActiveTouchPoints,
    getTouchCentroid,
    getTouchDistance,
  };
}
