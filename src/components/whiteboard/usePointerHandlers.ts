import { useCallback } from 'react';
import type { Point, PointerState } from './types';
import { MIN_SCALE, MAX_SCALE } from './types';

export interface PointerHandlers {
  handlePointerDown: (e: React.PointerEvent) => void;
  handlePointerMove: (e: React.PointerEvent) => void;
  handlePointerUp: (e: React.PointerEvent) => void;
  handlePointerCancel: (e: React.PointerEvent) => void;
  handlePointerLeave: (e: React.PointerEvent) => void;
}

export function usePointerHandlers(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  // Viewport state
  transformRef: React.RefObject<{ x: number; y: number; scale: number }>,
  isPanningRef: React.RefObject<boolean>,
  lastPanPointRef: React.RefObject<Point>,
  lastPinchDistanceRef: React.RefObject<number>,
  hasUserViewportChangeRef: React.RefObject<boolean>,
  activePointersRef: React.RefObject<Map<number, PointerState>>,
  // Viewport helpers
  clampTransform: (
    x: number,
    y: number,
    scale: number,
  ) => { x: number; y: number; scale: number },
  getActiveTouchPoints: () => PointerState[],
  getTouchCentroid: (points: PointerState[]) => Point,
  getTouchDistance: (points: PointerState[]) => number,
  // Drawing state
  isDrawingRef: React.RefObject<boolean>,
  currentOpRef: React.RefObject<unknown>,
  // Drawing handlers
  handleStart: (e: React.PointerEvent) => void,
  handleMove: (e: React.PointerEvent) => void,
  handleEnd: () => void,
  // Canvas rendering
  scheduleViewportRender: () => void,
): PointerHandlers {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (e.pointerType === 'touch') {
        canvas.setPointerCapture(e.pointerId);
        activePointersRef.current.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
          pointerType: e.pointerType,
        });

        e.preventDefault();

        const touchPoints = getActiveTouchPoints();
        if (touchPoints.length >= 2) {
          // Pan/zoom
          isPanningRef.current = true;
          isDrawingRef.current = false;
          currentOpRef.current = null;

          const rect = canvas.getBoundingClientRect();
          const centroid = getTouchCentroid(touchPoints);
          lastPanPointRef.current = {
            x: centroid.x - rect.left,
            y: centroid.y - rect.top,
          };
          lastPinchDistanceRef.current = getTouchDistance(touchPoints);
          return;
        }

        if (!isPanningRef.current) {
          handleStart(e);
        }
        return;
      }

      handleStart(e);
    },
    [
      canvasRef,
      activePointersRef,
      isPanningRef,
      isDrawingRef,
      currentOpRef,
      lastPanPointRef,
      lastPinchDistanceRef,
      getActiveTouchPoints,
      getTouchCentroid,
      getTouchDistance,
      handleStart,
    ],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (e.pointerType === 'touch') {
        if (!activePointersRef.current.has(e.pointerId)) return;
        e.preventDefault();
        activePointersRef.current.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
          pointerType: e.pointerType,
        });

        const touchPoints = getActiveTouchPoints();
        if (touchPoints.length >= 2 || isPanningRef.current) {
          // Panning and/or pinch-zoom mode
          isPanningRef.current = true;

          const rect = canvas.getBoundingClientRect();
          const centroid = getTouchCentroid(touchPoints);
          const localCenter = {
            x: centroid.x - rect.left,
            y: centroid.y - rect.top,
          };

          let nextScale = transformRef.current.scale;
          let nextX = transformRef.current.x;
          let nextY = transformRef.current.y;

          if (touchPoints.length >= 2) {
            const currentDistance = getTouchDistance(touchPoints);
            if (lastPinchDistanceRef.current > 0 && currentDistance > 0) {
              const pinchRatio = currentDistance / lastPinchDistanceRef.current;
              const newScale = Math.max(
                MIN_SCALE,
                Math.min(MAX_SCALE, nextScale * pinchRatio),
              );

              const worldPoint = {
                x: localCenter.x / nextScale + nextX,
                y: localCenter.y / nextScale + nextY,
              };

              // Zoom top-left world origin
              nextScale = newScale;
              nextX = worldPoint.x - localCenter.x / newScale;
              nextY = worldPoint.y - localCenter.y / newScale;
            }
            lastPinchDistanceRef.current = currentDistance;
          } else {
            lastPinchDistanceRef.current = 0;
          }

          const deltaCx = localCenter.x - lastPanPointRef.current.x;
          const deltaCy = localCenter.y - lastPanPointRef.current.y;
          lastPanPointRef.current = localCenter;

          // Pan world units
          nextX -= deltaCx / nextScale;
          nextY -= deltaCy / nextScale;

          // Clamp CSS size
          transformRef.current = clampTransform(nextX, nextY, nextScale);
          hasUserViewportChangeRef.current = true;

          scheduleViewportRender();
          return;
        }

        handleMove(e);
        return;
      }

      handleMove(e);
    },
    [
      canvasRef,
      activePointersRef,
      isPanningRef,
      lastPinchDistanceRef,
      lastPanPointRef,
      transformRef,
      hasUserViewportChangeRef,
      clampTransform,
      getActiveTouchPoints,
      getTouchCentroid,
      getTouchDistance,
      handleMove,
      scheduleViewportRender,
    ],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (canvas && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }

      if (e.pointerType === 'touch') {
        activePointersRef.current.delete(e.pointerId);
        const touchPoints = getActiveTouchPoints();

        if (touchPoints.length === 0) {
          if (isPanningRef.current) {
            isPanningRef.current = false;
          } else {
            handleEnd();
          }
          lastPinchDistanceRef.current = 0;
          return;
        }

        if (touchPoints.length === 1 && isPanningRef.current && canvas) {
          // Continue panning with remaining finger
          const rect = canvas.getBoundingClientRect();
          const centroid = getTouchCentroid(touchPoints);
          lastPanPointRef.current = {
            x: centroid.x - rect.left,
            y: centroid.y - rect.top,
          };
          lastPinchDistanceRef.current = 0;
        }
        return;
      }

      handleEnd();
    },
    [
      canvasRef,
      activePointersRef,
      isPanningRef,
      lastPanPointRef,
      lastPinchDistanceRef,
      getActiveTouchPoints,
      getTouchCentroid,
      handleEnd,
    ],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      handlePointerUp(e);
    },
    [handlePointerUp],
  );

  const handlePointerLeave = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') {
        handleEnd();
      }
    },
    [handleEnd],
  );

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handlePointerLeave,
  };
}
