import { useRef, useCallback } from 'react';
import type { DrawOp, Point, ResizeHandle, UndoEntry } from './types';
import type * as Y from 'yjs';

const HANDLE_RADIUS = 10;
const MIN_IMAGE_SIZE = 30;

interface SelectionState {
  selectedOpId: string | null;
  selectionBounds: { x1: number; y1: number; x2: number; y2: number } | null;
}

interface DragState {
  mode: 'move' | 'resize';
  startWorld: Point;
  originalOp: DrawOp;
  handle?: ResizeHandle;
}

export interface ImageSelectState {
  handleSelectStart: (e: React.PointerEvent) => void;
  handleSelectMove: (e: React.PointerEvent) => void;
  handleSelectEnd: () => void;
  getSelectedOpId: () => string | null;
  deleteSelectedImage: () => boolean;
  deselect: () => void;
  drawOverlay: (
    ctx: CanvasRenderingContext2D,
    transform: { x: number; y: number; scale: number },
    dpr: number,
  ) => void;
  getHoverCursor: (
    worldPos: Point,
    transform: { x: number; y: number; scale: number },
  ) => string;
}

export function useImageSelect(
  opsArray: Y.Array<DrawOp>,
  imageMap: Y.Map<Uint8Array>,
  transformRef: React.RefObject<{ x: number; y: number; scale: number }>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  scheduleViewportRender: () => void,
  setSuppressedImageOpId: (opId: string | null) => void,
  undoStackRef: React.RefObject<UndoEntry[]>,
  redoStackRef: React.RefObject<UndoEntry[]>,
  setCanUndo: React.Dispatch<React.SetStateAction<boolean>>,
  setCanRedo: React.Dispatch<React.SetStateAction<boolean>>,
  getCachedImage?: (imageId: string) => ImageBitmap | undefined,
): ImageSelectState {
  const selectionRef = useRef<SelectionState>({
    selectedOpId: null,
    selectionBounds: null,
  });
  const dragRef = useRef<DragState | null>(null);
  const previewOpRef = useRef<DrawOp | null>(null);

  const getPosition = useCallback(
    (e: React.PointerEvent): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x:
          (e.clientX - rect.left) / transformRef.current.scale +
          transformRef.current.x,
        y:
          (e.clientY - rect.top) / transformRef.current.scale +
          transformRef.current.y,
      };
    },
    [canvasRef, transformRef],
  );

  const hitTestImage = useCallback(
    (worldPos: Point): DrawOp | null => {
      const ops = opsArray.toArray();
      for (let i = ops.length - 1; i >= 0; i--) {
        const op = ops[i];
        if (
          op.type === 'image' &&
          op.x1 !== undefined &&
          op.y1 !== undefined &&
          op.x2 !== undefined &&
          op.y2 !== undefined
        ) {
          const minX = Math.min(op.x1, op.x2);
          const maxX = Math.max(op.x1, op.x2);
          const minY = Math.min(op.y1, op.y2);
          const maxY = Math.max(op.y1, op.y2);
          if (
            worldPos.x >= minX &&
            worldPos.x <= maxX &&
            worldPos.y >= minY &&
            worldPos.y <= maxY
          ) {
            return op;
          }
        }
      }
      return null;
    },
    [opsArray],
  );

  const getHandleAtScreenPos = useCallback(
    (
      worldPos: Point,
      bounds: { x1: number; y1: number; x2: number; y2: number },
      transform: { x: number; y: number; scale: number },
    ): ResizeHandle | null => {
      const corners: { handle: ResizeHandle; wx: number; wy: number }[] = [
        { handle: 'nw', wx: bounds.x1, wy: bounds.y1 },
        { handle: 'ne', wx: bounds.x2, wy: bounds.y1 },
        { handle: 'sw', wx: bounds.x1, wy: bounds.y2 },
        { handle: 'se', wx: bounds.x2, wy: bounds.y2 },
      ];

      const handleWorldRadius = HANDLE_RADIUS / transform.scale;
      for (const { handle, wx, wy } of corners) {
        const dx = worldPos.x - wx;
        const dy = worldPos.y - wy;
        if (Math.hypot(dx, dy) <= handleWorldRadius) return handle;
      }
      return null;
    },
    [],
  );

  const updateSelectionBounds = useCallback(
    (opId: string): void => {
      const ops = opsArray.toArray();
      const op = ops.find((o) => o.id === opId);
      if (
        op &&
        op.type === 'image' &&
        op.x1 !== undefined &&
        op.y1 !== undefined &&
        op.x2 !== undefined &&
        op.y2 !== undefined
      ) {
        selectionRef.current.selectionBounds = {
          x1: op.x1,
          y1: op.y1,
          x2: op.x2,
          y2: op.y2,
        };
      }
    },
    [opsArray],
  );

  const deselect = useCallback((): void => {
    selectionRef.current = { selectedOpId: null, selectionBounds: null };
    previewOpRef.current = null;
    dragRef.current = null;
    setSuppressedImageOpId(null);
    scheduleViewportRender();
  }, [setSuppressedImageOpId, scheduleViewportRender]);

  const getSelectedOpId = useCallback((): string | null => {
    return selectionRef.current.selectedOpId;
  }, []);

  const deleteSelectedImage = useCallback((): boolean => {
    const selectedId = selectionRef.current.selectedOpId;
    if (!selectedId) return false;

    const ops = opsArray.toArray();
    const index = ops.findIndex((op) => op.id === selectedId);
    if (index === -1) {
      deselect();
      return false;
    }

    const op = ops[index];
    if (op.type !== 'image') {
      deselect();
      return false;
    }

    const storedImageData = op.imageId ? imageMap.get(op.imageId) : undefined;
    const imageData = storedImageData
      ? new Uint8Array(storedImageData)
      : undefined;

    opsArray.doc?.transact(() => {
      opsArray.delete(index, 1);
      if (op.imageId) {
        imageMap.delete(op.imageId);
      }
    });

    undoStackRef.current.push({
      action: 'delete',
      op: { ...op },
      imageData,
      index,
    });
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);

    deselect();
    return true;
  }, [
    opsArray,
    imageMap,
    undoStackRef,
    redoStackRef,
    setCanUndo,
    setCanRedo,
    deselect,
  ]);

  const handleSelectStart = useCallback(
    (e: React.PointerEvent): void => {
      const worldPos = getPosition(e);
      const selection = selectionRef.current;

      if (selection.selectedOpId && selection.selectionBounds) {
        const handle = getHandleAtScreenPos(
          worldPos,
          selection.selectionBounds,
          transformRef.current,
        );
        if (handle) {
          const ops = opsArray.toArray();
          const op = ops.find((o) => o.id === selection.selectedOpId);
          if (op) {
            dragRef.current = {
              mode: 'resize',
              startWorld: worldPos,
              originalOp: { ...op },
              handle,
            };
            previewOpRef.current = { ...op };
            setSuppressedImageOpId(op.id);
            scheduleViewportRender();
            return;
          }
        }
      }

      const hitOp = hitTestImage(worldPos);
      if (hitOp) {
        selectionRef.current = {
          selectedOpId: hitOp.id,
          selectionBounds: {
            x1: hitOp.x1!,
            y1: hitOp.y1!,
            x2: hitOp.x2!,
            y2: hitOp.y2!,
          },
        };
        dragRef.current = {
          mode: 'move',
          startWorld: worldPos,
          originalOp: { ...hitOp },
        };
        previewOpRef.current = { ...hitOp };
        setSuppressedImageOpId(hitOp.id);
        scheduleViewportRender();
      } else {
        deselect();
      }
    },
    [
      getPosition,
      getHandleAtScreenPos,
      transformRef,
      opsArray,
      hitTestImage,
      setSuppressedImageOpId,
      scheduleViewportRender,
      deselect,
    ],
  );

  const handleSelectMove = useCallback(
    (e: React.PointerEvent): void => {
      const drag = dragRef.current;
      const preview = previewOpRef.current;
      if (!drag || !preview) return;

      const worldPos = getPosition(e);
      const dx = worldPos.x - drag.startWorld.x;
      const dy = worldPos.y - drag.startWorld.y;
      const orig = drag.originalOp;

      if (drag.mode === 'move') {
        preview.x1 = orig.x1! + dx;
        preview.y1 = orig.y1! + dy;
        preview.x2 = orig.x2! + dx;
        preview.y2 = orig.y2! + dy;
      } else if (drag.mode === 'resize' && drag.handle) {
        const origW = orig.x2! - orig.x1!;
        const origH = orig.y2! - orig.y1!;
        const aspect = origW / origH;

        let newX1 = orig.x1!;
        let newY1 = orig.y1!;
        let newX2 = orig.x2!;
        let newY2 = orig.y2!;

        switch (drag.handle) {
          case 'se':
            newX2 = orig.x2! + dx;
            newY2 = orig.y1! + (newX2 - orig.x1!) / aspect;
            break;
          case 'sw':
            newX1 = orig.x1! + dx;
            newY2 = orig.y1! + (newX2 - newX1) / aspect;
            break;
          case 'ne':
            newX2 = orig.x2! + dx;
            newY1 = orig.y2! - (newX2 - orig.x1!) / aspect;
            break;
          case 'nw':
            newX1 = orig.x1! + dx;
            newY1 = orig.y2! - (newX2 - newX1) / aspect;
            break;
        }

        if (
          Math.abs(newX2 - newX1) >= MIN_IMAGE_SIZE &&
          Math.abs(newY2 - newY1) >= MIN_IMAGE_SIZE
        ) {
          preview.x1 = newX1;
          preview.y1 = newY1;
          preview.x2 = newX2;
          preview.y2 = newY2;
        }
      }

      selectionRef.current.selectionBounds = {
        x1: preview.x1!,
        y1: preview.y1!,
        x2: preview.x2!,
        y2: preview.y2!,
      };
      scheduleViewportRender();
    },
    [getPosition, scheduleViewportRender],
  );

  const handleSelectEnd = useCallback((): void => {
    const drag = dragRef.current;
    const preview = previewOpRef.current;
    if (!drag || !preview) return;

    const hasMoved =
      preview.x1 !== drag.originalOp.x1 ||
      preview.y1 !== drag.originalOp.y1 ||
      preview.x2 !== drag.originalOp.x2 ||
      preview.y2 !== drag.originalOp.y2;

    if (hasMoved) {
      const ops = opsArray.toArray();
      const index = ops.findIndex((o) => o.id === drag.originalOp.id);
      if (index !== -1) {
        const newOp: DrawOp = {
          ...drag.originalOp,
          x1: preview.x1,
          y1: preview.y1,
          x2: preview.x2,
          y2: preview.y2,
          ts: Date.now(),
        };

        opsArray.doc?.transact(() => {
          opsArray.delete(index, 1);
          opsArray.push([newOp]);
        });

        undoStackRef.current.push({
          action: 'transform',
          op: newOp,
          previousOp: drag.originalOp,
        });
        redoStackRef.current = [];
        setCanUndo(true);
        setCanRedo(false);

        selectionRef.current.selectedOpId = newOp.id;
        updateSelectionBounds(newOp.id);
      }
    }

    dragRef.current = null;
    previewOpRef.current = null;
    setSuppressedImageOpId(null);
    scheduleViewportRender();
  }, [
    opsArray,
    undoStackRef,
    redoStackRef,
    setCanUndo,
    setCanRedo,
    updateSelectionBounds,
    setSuppressedImageOpId,
    scheduleViewportRender,
  ]);

  const drawOverlay = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      transform: { x: number; y: number; scale: number },
      dpr: number,
    ): void => {
      const selection = selectionRef.current;
      if (!selection.selectedOpId) return;

      // Keep selection bounds synced when remote edits occur and no local drag is active.
      if (!dragRef.current) {
        const ops = opsArray.toArray();
        const selectedOp = ops.find((op) => op.id === selection.selectedOpId);
        if (
          !selectedOp ||
          selectedOp.type !== 'image' ||
          selectedOp.x1 === undefined ||
          selectedOp.y1 === undefined ||
          selectedOp.x2 === undefined ||
          selectedOp.y2 === undefined
        ) {
          selectionRef.current = { selectedOpId: null, selectionBounds: null };
          previewOpRef.current = null;
          setSuppressedImageOpId(null);
          return;
        }
        selection.selectionBounds = {
          x1: selectedOp.x1,
          y1: selectedOp.y1,
          x2: selectedOp.x2,
          y2: selectedOp.y2,
        };
      }

      const preview = previewOpRef.current;
      if (
        preview &&
        preview.imageId &&
        preview.x1 !== undefined &&
        preview.y1 !== undefined &&
        preview.x2 !== undefined &&
        preview.y2 !== undefined
      ) {
        const bitmap = getCachedImage?.(preview.imageId);
        ctx.save();
        const worldToPhys = dpr * transform.scale;
        ctx.scale(worldToPhys, worldToPhys);
        ctx.translate(-transform.x, -transform.y);
        if (bitmap) {
          ctx.drawImage(
            bitmap,
            preview.x1,
            preview.y1,
            preview.x2 - preview.x1,
            preview.y2 - preview.y1,
          );
        } else {
          ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
          ctx.fillRect(
            preview.x1,
            preview.y1,
            preview.x2 - preview.x1,
            preview.y2 - preview.y1,
          );
        }
        ctx.restore();
      }

      if (!selection.selectionBounds) return;
      const minX = Math.min(selection.selectionBounds.x1, selection.selectionBounds.x2);
      const maxX = Math.max(selection.selectionBounds.x1, selection.selectionBounds.x2);
      const minY = Math.min(selection.selectionBounds.y1, selection.selectionBounds.y2);
      const maxY = Math.max(selection.selectionBounds.y1, selection.selectionBounds.y2);

      const toPhysX = (wx: number) => (wx - transform.x) * transform.scale * dpr;
      const toPhysY = (wy: number) => (wy - transform.y) * transform.scale * dpr;

      const px1 = toPhysX(minX);
      const py1 = toPhysY(minY);
      const px2 = toPhysX(maxX);
      const py2 = toPhysY(maxY);

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.strokeRect(px1, py1, px2 - px1, py2 - py1);
      ctx.setLineDash([]);

      const handleRadius = 6 * dpr;
      const corners = [
        { x: px1, y: py1 },
        { x: px2, y: py1 },
        { x: px1, y: py2 },
        { x: px2, y: py2 },
      ];

      for (const corner of corners) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.arc(corner.x, corner.y, handleRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    },
    [opsArray, getCachedImage, setSuppressedImageOpId],
  );

  const getHoverCursor = useCallback(
    (
      worldPos: Point,
      transform: { x: number; y: number; scale: number },
    ): string => {
      const selection = selectionRef.current;
      if (selection.selectedOpId && selection.selectionBounds) {
        const handle = getHandleAtScreenPos(
          worldPos,
          selection.selectionBounds,
          transform,
        );
        if (handle) {
          if (handle === 'nw' || handle === 'se') return 'nwse-resize';
          if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
        }
      }

      const hitOp = hitTestImage(worldPos);
      if (hitOp) return 'move';
      return 'default';
    },
    [hitTestImage, getHandleAtScreenPos],
  );

  return {
    handleSelectStart,
    handleSelectMove,
    handleSelectEnd,
    getSelectedOpId,
    deleteSelectedImage,
    deselect,
    drawOverlay,
    getHoverCursor,
  };
}
