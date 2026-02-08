import { useRef, useCallback } from 'react';
import { nanoid } from 'nanoid';
import type { Point, DrawOp, Tool, UndoEntry } from './types';
import type * as Y from 'yjs';

export interface DrawingState {
  isDrawing: React.RefObject<boolean>;
  handleStart: (e: React.PointerEvent) => void;
  handleMove: (e: React.PointerEvent) => void;
  handleEnd: () => void;
  getPosition: (
    e: React.MouseEvent | React.TouchEvent | React.PointerEvent,
  ) => Point;
}

export function useDrawing(
  tool: Tool,
  colour: string,
  size: number,
  opsArray: Y.Array<DrawOp>,
  transformRef: React.RefObject<{ x: number; y: number; scale: number }>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  scheduleViewportRender: () => void,
  undoStackRef: React.RefObject<UndoEntry[]>,
  redoStackRef: React.RefObject<UndoEntry[]>,
  setCanUndo: React.Dispatch<React.SetStateAction<boolean>>,
  setCanRedo: React.Dispatch<React.SetStateAction<boolean>>,
  currentOpRef: React.RefObject<DrawOp | null>,
): DrawingState {
  const isDrawing = useRef(false);

  // Get mouse/touch position relative to canvas, accounting for viewport offset
  const getPosition = useCallback(
    (e: React.MouseEvent | React.TouchEvent | React.PointerEvent): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      let clientX: number, clientY: number;

      if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      // Convert screen coordinates to world coordinates by accounting for scale and viewport offset
      return {
        x:
          (clientX - rect.left) / transformRef.current.scale +
          transformRef.current.x,
        y:
          (clientY - rect.top) / transformRef.current.scale +
          transformRef.current.y,
      };
    },
    [canvasRef, transformRef],
  );

  // Start drawing
  const handleStart = useCallback(
    (e: React.PointerEvent) => {
      const pos = getPosition(e);
      isDrawing.current = true;

      if (tool === 'fill') {
        // Fill operation
        const fillOp: DrawOp = {
          id: nanoid(8),
          ts: Date.now(),
          type: 'fill',
          colour,
          size: 0,
          x1: pos.x,
          y1: pos.y,
        };
        opsArray.push([fillOp]);
        undoStackRef.current.push({ op: fillOp });
        redoStackRef.current = [];
        setCanUndo(true);
        setCanRedo(false);
        isDrawing.current = false;
        // World canvas will be rebuilt by the opsArray observer
        return;
      } else if (tool === 'eraser') {
        // Brush eraser
        currentOpRef.current = {
          id: nanoid(8),
          ts: Date.now(),
          type: 'eraseStroke',
          colour: '',
          size,
          points: [pos],
        };
      } else if (tool === 'pen') {
        currentOpRef.current = {
          id: nanoid(8),
          ts: Date.now(),
          type: 'path',
          colour,
          size,
          points: [pos],
        };
      } else {
        currentOpRef.current = {
          id: nanoid(8),
          ts: Date.now(),
          type: tool as 'line' | 'rect' | 'circle',
          colour,
          size,
          x1: pos.x,
          y1: pos.y,
          x2: pos.x,
          y2: pos.y,
        };
      }

      scheduleViewportRender();
    },
    [
      tool,
      colour,
      size,
      getPosition,
      scheduleViewportRender,
      opsArray,
      undoStackRef,
      redoStackRef,
      setCanUndo,
      setCanRedo,
      currentOpRef,
    ],
  );

  // Continue drawing
  const handleMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing.current || !currentOpRef.current) return;

      const pos = getPosition(e);

      if (tool === 'pen' && currentOpRef.current.points) {
        currentOpRef.current.points.push(pos);
      } else if (tool === 'eraser' && currentOpRef.current.points) {
        // Brush eraser
        currentOpRef.current.points.push(pos);
      } else {
        currentOpRef.current.x2 = pos.x;
        currentOpRef.current.y2 = pos.y;
      }

      scheduleViewportRender();
    },
    [tool, getPosition, scheduleViewportRender, currentOpRef],
  );

  // End drawing
  const handleEnd = useCallback(() => {
    if (!isDrawing.current || !currentOpRef.current) return;

    isDrawing.current = false;

    // For pen or eraser, at least 2 points (duplicate first if only 1)
    if (
      (tool === 'pen' || tool === 'eraser') &&
      currentOpRef.current.points &&
      currentOpRef.current.points.length < 2
    ) {
      currentOpRef.current.points.push({ ...currentOpRef.current.points[0] });
    }

    // Always push to opsArray (eraseStroke always has points)
    opsArray.push([currentOpRef.current]);
    undoStackRef.current.push({ op: currentOpRef.current });
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);

    currentOpRef.current = null;
    // World canvas will be rebuilt by the opsArray observer
  }, [
    tool,
    opsArray,
    undoStackRef,
    redoStackRef,
    setCanUndo,
    setCanRedo,
    currentOpRef,
  ]);

  return {
    isDrawing,
    handleStart,
    handleMove,
    handleEnd,
    getPosition,
  };
}
