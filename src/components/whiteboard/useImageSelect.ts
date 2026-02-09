import { useRef, useCallback } from 'react';
import type { DrawOp, Point, ResizeHandle, UndoEntry } from './types';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './types';
import { drawStrokeOp } from './drawing';
import type * as Y from 'yjs';

const HANDLE_RADIUS = 10;
const MIN_IMAGE_SIZE = 30;
const MIN_DRAWING_SIZE = 10;

/** Op types that can be selected and moved. */
const SELECTABLE_TYPES = new Set(['path', 'line', 'rect', 'circle', 'image']);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Squared distance from point p to line segment a→b. */
function pointToSegmentDistSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0, 1);
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return (p.x - projX) ** 2 + (p.y - projY) ** 2;
}

/** Compute axis-aligned bounding box for any selectable op. */
function getOpBounds(
  op: DrawOp,
): { x1: number; y1: number; x2: number; y2: number } | null {
  if (op.type === 'image' || op.type === 'rect' || op.type === 'line') {
    if (
      op.x1 === undefined ||
      op.y1 === undefined ||
      op.x2 === undefined ||
      op.y2 === undefined
    )
      return null;
    return {
      x1: Math.min(op.x1, op.x2),
      y1: Math.min(op.y1, op.y2),
      x2: Math.max(op.x1, op.x2),
      y2: Math.max(op.y1, op.y2),
    };
  }
  if (op.type === 'circle') {
    if (
      op.x1 === undefined ||
      op.y1 === undefined ||
      op.x2 === undefined ||
      op.y2 === undefined
    )
      return null;
    // rx/ry encoding: centre (x1,y1), rx = |x2-x1|, ry = |y2-y1|
    const rx = Math.abs(op.x2 - op.x1);
    const ry = Math.abs(op.y2 - op.y1);
    return {
      x1: op.x1 - rx,
      y1: op.y1 - ry,
      x2: op.x1 + rx,
      y2: op.y1 + ry,
    };
  }
  if (op.type === 'path') {
    if (!op.points || op.points.length === 0) return null;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of op.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = op.size / 2;
    return {
      x1: minX - pad,
      y1: minY - pad,
      x2: maxX + pad,
      y2: maxY + pad,
    };
  }
  return null;
}

/** Hit-test a drawing op (path, line, rect, circle). */
function hitTestDrawingOp(
  worldPos: Point,
  op: DrawOp,
  hitPadding: number,
): boolean {
  if (op.type === 'path') {
    if (!op.points || op.points.length < 2) return false;
    const threshold = Math.max(op.size / 2, 3) + hitPadding;
    const thresholdSq = threshold * threshold;
    for (let i = 1; i < op.points.length; i++) {
      if (
        pointToSegmentDistSq(worldPos, op.points[i - 1], op.points[i]) <=
        thresholdSq
      )
        return true;
    }
    return false;
  }
  if (op.type === 'line') {
    if (
      op.x1 === undefined ||
      op.y1 === undefined ||
      op.x2 === undefined ||
      op.y2 === undefined
    )
      return false;
    const threshold = Math.max(op.size / 2, 3) + hitPadding;
    const thresholdSq = threshold * threshold;
    return (
      pointToSegmentDistSq(
        worldPos,
        { x: op.x1, y: op.y1 },
        { x: op.x2, y: op.y2 },
      ) <= thresholdSq
    );
  }
  if (op.type === 'rect') {
    if (
      op.x1 === undefined ||
      op.y1 === undefined ||
      op.x2 === undefined ||
      op.y2 === undefined
    )
      return false;
    const minX = Math.min(op.x1, op.x2);
    const maxX = Math.max(op.x1, op.x2);
    const minY = Math.min(op.y1, op.y2);
    const maxY = Math.max(op.y1, op.y2);
    return (
      worldPos.x >= minX - hitPadding &&
      worldPos.x <= maxX + hitPadding &&
      worldPos.y >= minY - hitPadding &&
      worldPos.y <= maxY + hitPadding
    );
  }
  if (op.type === 'circle') {
    if (
      op.x1 === undefined ||
      op.y1 === undefined ||
      op.x2 === undefined ||
      op.y2 === undefined
    )
      return false;
    // Ellipse hit-test: (dx/rx)^2 + (dy/ry)^2 <= 1 (with padding)
    const rx = Math.abs(op.x2 - op.x1);
    const ry = Math.abs(op.y2 - op.y1);
    const threshold = Math.max(op.size / 2, 3) + hitPadding;
    const dxE = worldPos.x - op.x1;
    const dyE = worldPos.y - op.y1;
    const rxP = rx + threshold;
    const ryP = ry + threshold;
    return (dxE * dxE) / (rxP * rxP) + (dyE * dyE) / (ryP * ryP) <= 1;
  }
  return false;
}

/**
 * Create a scaled copy of an op.
 * scaleX/scaleY multiply coordinates relative to (anchorX, anchorY).
 * Corners resize both axes; sides resize one axis; top/bottom resize the other.
 */
function scaleOp(
  op: DrawOp,
  anchorX: number,
  anchorY: number,
  scaleX: number,
  scaleY: number,
): DrawOp {
  const newOp: DrawOp = { ...op, ts: Date.now() };
  const sx = (v: number) => anchorX + (v - anchorX) * scaleX;
  const sy = (v: number) => anchorY + (v - anchorY) * scaleY;

  if (
    op.type === 'circle' &&
    op.x1 !== undefined &&
    op.y1 !== undefined &&
    op.x2 !== undefined &&
    op.y2 !== undefined
  ) {
    // Circles are stored as centre (x1,y1) + radii encoded in (x2,y2).
    // Scale via the bounding box so non-uniform scaling stretches correctly.
    const rx = Math.abs(op.x2 - op.x1);
    const ry = Math.abs(op.y2 - op.y1);
    const bx1 = op.x1 - rx;
    const by1 = op.y1 - ry;
    const bx2 = op.x1 + rx;
    const by2 = op.y1 + ry;
    const sbx1 = anchorX + (bx1 - anchorX) * scaleX;
    const sby1 = anchorY + (by1 - anchorY) * scaleY;
    const sbx2 = anchorX + (bx2 - anchorX) * scaleX;
    const sby2 = anchorY + (by2 - anchorY) * scaleY;
    newOp.x1 = (sbx1 + sbx2) / 2; // new centre X
    newOp.y1 = (sby1 + sby2) / 2; // new centre Y
    newOp.x2 = newOp.x1 + Math.abs(sbx2 - sbx1) / 2; // new rx
    newOp.y2 = newOp.y1 + Math.abs(sby2 - sby1) / 2; // new ry
    return newOp;
  }

  if (op.points) {
    newOp.points = op.points.map((p) => ({ x: sx(p.x), y: sy(p.y) }));
  }
  if (op.x1 !== undefined) newOp.x1 = sx(op.x1);
  if (op.y1 !== undefined) newOp.y1 = sy(op.y1);
  if (op.x2 !== undefined) newOp.x2 = sx(op.x2);
  if (op.y2 !== undefined) newOp.y2 = sy(op.y2);
  return newOp;
}

/** Create a copy of an op with all coordinates translated by (dx, dy). */
function translateOp(op: DrawOp, dx: number, dy: number): DrawOp {
  const newOp: DrawOp = { ...op, ts: Date.now() };
  if (op.points) {
    newOp.points = op.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  if (op.x1 !== undefined) newOp.x1 = op.x1 + dx;
  if (op.y1 !== undefined) newOp.y1 = op.y1 + dy;
  if (op.x2 !== undefined) newOp.x2 = op.x2 + dx;
  if (op.y2 !== undefined) newOp.y2 = op.y2 + dy;
  return newOp;
}

interface SelectionState {
  selectedOpId: string | null;
  selectionBounds: { x1: number; y1: number; x2: number; y2: number } | null;
}

interface DragState {
  mode: 'move' | 'resize';
  startWorld: Point;
  originalOp: DrawOp;
  handle?: ResizeHandle;
  /** Fill ops that move together with the primary drawing op. */
  groupedOps: { op: DrawOp; index: number }[];
}

export interface ImageSelectState {
  handleSelectStart: (e: React.PointerEvent) => void;
  handleSelectMove: (e: React.PointerEvent) => void;
  handleSelectEnd: () => void;
  getSelectedOpId: () => string | null;
  deleteSelected: () => boolean;
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
  setSuppressedOpIds: (opIds: Set<string> | null) => void,
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

  const hitTestAny = useCallback(
    (worldPos: Point): DrawOp | null => {
      const ops = opsArray.toArray();
      const hitPadding = 5 / transformRef.current.scale;
      for (let i = ops.length - 1; i >= 0; i--) {
        const op = ops[i];
        if (!SELECTABLE_TYPES.has(op.type)) continue;

        if (op.type === 'image') {
          if (
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
        } else if (hitTestDrawingOp(worldPos, op, hitPadding)) {
          return op;
        }
      }
      return null;
    },
    [opsArray, transformRef],
  );

  const getHandleAtScreenPos = useCallback(
    (
      worldPos: Point,
      bounds: { x1: number; y1: number; x2: number; y2: number },
      transform: { x: number; y: number; scale: number },
    ): ResizeHandle | null => {
      const minX = Math.min(bounds.x1, bounds.x2);
      const maxX = Math.max(bounds.x1, bounds.x2);
      const minY = Math.min(bounds.y1, bounds.y2);
      const maxY = Math.max(bounds.y1, bounds.y2);
      const midX = (minX + maxX) / 2;
      const midY = (minY + maxY) / 2;

      const corners: { handle: ResizeHandle; wx: number; wy: number }[] = [
        { handle: 'nw', wx: minX, wy: minY },
        { handle: 'ne', wx: maxX, wy: minY },
        { handle: 'sw', wx: minX, wy: maxY },
        { handle: 'se', wx: maxX, wy: maxY },
      ];

      const handleWorldRadius = HANDLE_RADIUS / transform.scale;
      for (const { handle, wx, wy } of corners) {
        const dx = worldPos.x - wx;
        const dy = worldPos.y - wy;
        if (Math.hypot(dx, dy) <= handleWorldRadius) return handle;
      }

      if (
        worldPos.x >= minX + handleWorldRadius &&
        worldPos.x <= maxX - handleWorldRadius
      ) {
        if (Math.abs(worldPos.y - minY) <= handleWorldRadius) return 'n';
        if (Math.abs(worldPos.y - maxY) <= handleWorldRadius) return 's';
      }

      if (
        worldPos.y >= minY + handleWorldRadius &&
        worldPos.y <= maxY - handleWorldRadius
      ) {
        if (Math.abs(worldPos.x - minX) <= handleWorldRadius) return 'w';
        if (Math.abs(worldPos.x - maxX) <= handleWorldRadius) return 'e';
      }

      const dxToMidX = Math.abs(worldPos.x - midX);
      const dyToMidY = Math.abs(worldPos.y - midY);
      if (
        dxToMidX <= handleWorldRadius &&
        Math.abs(worldPos.y - minY) <= handleWorldRadius
      )
        return 'n';
      if (
        dxToMidX <= handleWorldRadius &&
        Math.abs(worldPos.y - maxY) <= handleWorldRadius
      )
        return 's';
      if (
        dyToMidY <= handleWorldRadius &&
        Math.abs(worldPos.x - minX) <= handleWorldRadius
      )
        return 'w';
      if (
        dyToMidY <= handleWorldRadius &&
        Math.abs(worldPos.x - maxX) <= handleWorldRadius
      )
        return 'e';

      return null;
    },
    [],
  );

  const updateSelectionBounds = useCallback(
    (opId: string): void => {
      const ops = opsArray.toArray();
      const op = ops.find((o) => o.id === opId);
      if (op) {
        const bounds = getOpBounds(op);
        if (bounds) {
          selectionRef.current.selectionBounds = bounds;
        }
      }
    },
    [opsArray],
  );

  const deselect = useCallback((): void => {
    selectionRef.current = { selectedOpId: null, selectionBounds: null };
    previewOpRef.current = null;
    dragRef.current = null;
    setSuppressedOpIds(null);
    scheduleViewportRender();
  }, [setSuppressedOpIds, scheduleViewportRender]);

  const getSelectedOpId = useCallback((): string | null => {
    return selectionRef.current.selectedOpId;
  }, []);

  const deleteSelected = useCallback((): boolean => {
    const selectedId = selectionRef.current.selectedOpId;
    if (!selectedId) return false;

    const ops = opsArray.toArray();
    const index = ops.findIndex((op) => op.id === selectedId);
    if (index === -1) {
      deselect();
      return false;
    }

    const op = ops[index];
    if (!SELECTABLE_TYPES.has(op.type)) {
      deselect();
      return false;
    }

    // For image ops, also remove the image data
    const storedImageData = op.imageId ? imageMap.get(op.imageId) : undefined;
    const imageData = storedImageData
      ? new Uint8Array(storedImageData)
      : undefined;

    // Find associated fill ops for drawing ops
    const bounds = getOpBounds(op);
    const groupedFills: { op: DrawOp; index: number }[] = [];
    if (op.type !== 'image' && bounds) {
      for (let i = 0; i < ops.length; i++) {
        if (i === index) continue;
        const fillOp = ops[i];
        if (
          fillOp.type === 'fill' &&
          fillOp.x1 !== undefined &&
          fillOp.y1 !== undefined &&
          fillOp.x1 >= bounds.x1 &&
          fillOp.x1 <= bounds.x2 &&
          fillOp.y1 >= bounds.y1 &&
          fillOp.y1 <= bounds.y2
        ) {
          groupedFills.push({ op: { ...fillOp }, index: i });
        }
      }
    }

    // Collect all indices to delete (descending order for safe deletion)
    const indicesToDelete = [index, ...groupedFills.map((g) => g.index)].sort(
      (a, b) => b - a,
    );

    opsArray.doc?.transact(() => {
      for (const idx of indicesToDelete) {
        opsArray.delete(idx, 1);
      }
      if (op.imageId) {
        imageMap.delete(op.imageId);
      }
    });

    undoStackRef.current.push({
      action: 'delete',
      op: { ...op },
      imageData,
      index,
      groupedOps:
        groupedFills.length > 0
          ? groupedFills.map((g) => ({
              op: g.op,
              previousOp: g.op,
              index: g.index,
            }))
          : undefined,
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

      // Check for resize handle on currently selected op
      if (selection.selectedOpId && selection.selectionBounds) {
        const selectedOps = opsArray.toArray();
        const selectedOp = selectedOps.find(
          (o) => o.id === selection.selectedOpId,
        );

        if (selectedOp && SELECTABLE_TYPES.has(selectedOp.type)) {
          const handle = getHandleAtScreenPos(
            worldPos,
            selection.selectionBounds,
            transformRef.current,
          );
          if (handle) {
            // Find associated fill ops so they are suppressed during resize.
            // Without this, removing the boundary stroke from the render while
            // the fill op is still active causes flood fill to cover the canvas.
            const bounds = getOpBounds(selectedOp);
            let resizeGroupedOps: { op: DrawOp; index: number }[] = [];
            if (selectedOp.type !== 'image' && bounds) {
              const allOps = opsArray.toArray();
              for (let i = 0; i < allOps.length; i++) {
                const fillOp = allOps[i];
                if (
                  fillOp.type === 'fill' &&
                  fillOp.x1 !== undefined &&
                  fillOp.y1 !== undefined &&
                  fillOp.x1 >= bounds.x1 &&
                  fillOp.x1 <= bounds.x2 &&
                  fillOp.y1 >= bounds.y1 &&
                  fillOp.y1 <= bounds.y2
                ) {
                  resizeGroupedOps.push({ op: { ...fillOp }, index: i });
                }
              }
            }

            dragRef.current = {
              mode: 'resize',
              startWorld: worldPos,
              originalOp: { ...selectedOp },
              handle,
              groupedOps: resizeGroupedOps,
            };
            previewOpRef.current = { ...selectedOp };

            // Suppress the original op (and grouped fills for drawings) so
            // the world canvas rebuilds without them. The overlay will render
            // the scaled preview with fill + stroke in real time.
            const suppressIds = new Set([
              selectedOp.id,
              ...resizeGroupedOps.map((g) => g.op.id),
            ]);
            setSuppressedOpIds(suppressIds);
            scheduleViewportRender();
            return;
          }
        }
      }

      const hitOp = hitTestAny(worldPos);
      if (hitOp) {
        const bounds = getOpBounds(hitOp);
        selectionRef.current = {
          selectedOpId: hitOp.id,
          selectionBounds: bounds,
        };

        // Find associated fill ops for drawing ops
        let groupedOps: { op: DrawOp; index: number }[] = [];
        if (hitOp.type !== 'image' && bounds) {
          const ops = opsArray.toArray();
          for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            if (
              op.type === 'fill' &&
              op.x1 !== undefined &&
              op.y1 !== undefined &&
              op.x1 >= bounds.x1 &&
              op.x1 <= bounds.x2 &&
              op.y1 >= bounds.y1 &&
              op.y1 <= bounds.y2
            ) {
              groupedOps.push({ op: { ...op }, index: i });
            }
          }
        }

        dragRef.current = {
          mode: 'move',
          startWorld: worldPos,
          originalOp: { ...hitOp },
          groupedOps,
        };
        previewOpRef.current = { ...hitOp };
        const suppressIds = new Set([
          hitOp.id,
          ...groupedOps.map((g) => g.op.id),
        ]);
        setSuppressedOpIds(suppressIds);
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
      hitTestAny,
      setSuppressedOpIds,
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
        // Translate the op from its original position
        const translated = translateOp(orig, dx, dy);
        const bounds = getOpBounds(translated);

        if (bounds) {
          // Clamp within the canvas
          let adjustX = 0;
          let adjustY = 0;
          const width = bounds.x2 - bounds.x1;
          const height = bounds.y2 - bounds.y1;

          if (width >= CANVAS_WIDTH) {
            adjustX = -bounds.x1;
          } else if (bounds.x1 < 0) {
            adjustX = -bounds.x1;
          } else if (bounds.x2 > CANVAS_WIDTH) {
            adjustX = CANVAS_WIDTH - bounds.x2;
          }

          if (height >= CANVAS_HEIGHT) {
            adjustY = -bounds.y1;
          } else if (bounds.y1 < 0) {
            adjustY = -bounds.y1;
          } else if (bounds.y2 > CANVAS_HEIGHT) {
            adjustY = CANVAS_HEIGHT - bounds.y2;
          }

          const clamped =
            adjustX !== 0 || adjustY !== 0
              ? translateOp(translated, adjustX, adjustY)
              : translated;

          // Copy all properties to preview
          Object.assign(previewOpRef.current!, clamped);

          const clampedBounds = getOpBounds(clamped);
          selectionRef.current.selectionBounds = clampedBounds;
        } else {
          Object.assign(previewOpRef.current!, translated);
        }
      } else if (drag.mode === 'resize' && drag.handle) {
        const origBounds = getOpBounds(orig);
        if (!origBounds) return;

        const bW = origBounds.x2 - origBounds.x1;
        const bH = origBounds.y2 - origBounds.y1;
        const minSize =
          orig.type === 'image' ? MIN_IMAGE_SIZE : MIN_DRAWING_SIZE;

        const isCorner =
          drag.handle === 'nw' ||
          drag.handle === 'ne' ||
          drag.handle === 'sw' ||
          drag.handle === 'se';

        if (orig.type === 'image' && isCorner && !e.shiftKey) {
          // Aspect-ratio-locked corner resize for images
          const aspect = (orig.x2! - orig.x1!) / (orig.y2! - orig.y1!);
          const minWidth = Math.max(minSize, minSize * aspect);

          let anchorX: number;
          let anchorY: number;
          let dirX: 1 | -1;
          let dirY: 1 | -1;

          switch (drag.handle) {
            case 'nw':
              anchorX = orig.x2!;
              anchorY = orig.y2!;
              dirX = -1;
              dirY = -1;
              break;
            case 'ne':
              anchorX = orig.x1!;
              anchorY = orig.y2!;
              dirX = 1;
              dirY = -1;
              break;
            case 'sw':
              anchorX = orig.x2!;
              anchorY = orig.y1!;
              dirX = -1;
              dirY = 1;
              break;
            case 'se':
            default:
              anchorX = orig.x1!;
              anchorY = orig.y1!;
              dirX = 1;
              dirY = 1;
              break;
          }

          const widthFromPointer =
            dirX === 1 ? worldPos.x - anchorX : anchorX - worldPos.x;
          const heightFromPointer =
            dirY === 1 ? worldPos.y - anchorY : anchorY - worldPos.y;

          const widthFromHeight = heightFromPointer * aspect;
          const targetWidth = Math.max(widthFromPointer, widthFromHeight);

          const maxWidthByX = dirX === 1 ? CANVAS_WIDTH - anchorX : anchorX;
          const maxHeightByY = dirY === 1 ? CANVAS_HEIGHT - anchorY : anchorY;
          const maxWidthByY = maxHeightByY * aspect;
          const maxWidth = Math.min(maxWidthByX, maxWidthByY);

          const nextWidth = clamp(targetWidth, minWidth, maxWidth);
          const nextHeight = nextWidth / aspect;

          let newX1: number, newY1: number, newX2: number, newY2: number;
          if (dirX === 1) {
            newX1 = anchorX;
            newX2 = anchorX + nextWidth;
          } else {
            newX1 = anchorX - nextWidth;
            newX2 = anchorX;
          }

          if (dirY === 1) {
            newY1 = anchorY;
            newY2 = anchorY + nextHeight;
          } else {
            newY1 = anchorY - nextHeight;
            newY2 = anchorY;
          }

          preview.x1 = newX1;
          preview.y1 = newY1;
          preview.x2 = newX2;
          preview.y2 = newY2;
        } else {
          // Generic scale-based resize for drawings (and image side/Shift drags)
          // Compute the anchor and scale factors based on handle direction.
          let anchorX: number;
          let anchorY: number;
          let scaleX = 1;
          let scaleY = 1;

          if (bW > 0) {
            if (drag.handle.includes('w')) {
              anchorX = origBounds.x2;
              const newW = clamp(bW - dx, minSize, anchorX);
              scaleX = newW / bW;
            } else if (drag.handle.includes('e')) {
              anchorX = origBounds.x1;
              const newW = clamp(bW + dx, minSize, CANVAS_WIDTH - anchorX);
              scaleX = newW / bW;
            } else {
              anchorX = (origBounds.x1 + origBounds.x2) / 2;
            }
          } else {
            anchorX = origBounds.x1;
          }

          if (bH > 0) {
            if (drag.handle.includes('n')) {
              anchorY = origBounds.y2;
              const newH = clamp(bH - dy, minSize, anchorY);
              scaleY = newH / bH;
            } else if (drag.handle.includes('s')) {
              anchorY = origBounds.y1;
              const newH = clamp(bH + dy, minSize, CANVAS_HEIGHT - anchorY);
              scaleY = newH / bH;
            } else {
              anchorY = (origBounds.y1 + origBounds.y2) / 2;
            }
          } else {
            anchorY = origBounds.y1;
          }

          // For non-image drawing types, corners scale uniformly (proportional).
          // Side handles stretch only one axis — same behaviour as images.
          if (orig.type !== 'image' && isCorner) {
            const uniformScale = Math.max(scaleX, scaleY);
            scaleX = uniformScale;
            scaleY = uniformScale;
          }

          const scaled = scaleOp(orig, anchorX!, anchorY!, scaleX, scaleY);
          Object.assign(previewOpRef.current!, scaled);
        }
      }

      // Update selection bounds from preview (works for both move and resize)
      const previewBounds = getOpBounds(preview);
      if (previewBounds) {
        selectionRef.current.selectionBounds = previewBounds;
      } else {
        selectionRef.current.selectionBounds = {
          x1: preview.x1!,
          y1: preview.y1!,
          x2: preview.x2!,
          y2: preview.y2!,
        };
      }
      scheduleViewportRender();
    },
    [getPosition, scheduleViewportRender],
  );

  const handleSelectEnd = useCallback((): void => {
    const drag = dragRef.current;
    const preview = previewOpRef.current;
    if (!drag || !preview) return;

    // Detect whether coordinates actually changed
    const origBounds = getOpBounds(drag.originalOp);
    const previewBounds = getOpBounds(preview);
    const hasMoved =
      origBounds &&
      previewBounds &&
      (previewBounds.x1 !== origBounds.x1 ||
        previewBounds.y1 !== origBounds.y1 ||
        previewBounds.x2 !== origBounds.x2 ||
        previewBounds.y2 !== origBounds.y2);

    if (hasMoved) {
      const ops = opsArray.toArray();
      const primaryIndex = ops.findIndex((o) => o.id === drag.originalOp.id);
      if (primaryIndex !== -1) {
        // Build the new primary op from the preview
        const newOp: DrawOp = { ...preview, ts: Date.now() };

        // Compute the delta applied to the primary op (for translating grouped fills)
        const moveDx = previewBounds!.x1 - origBounds!.x1;
        const moveDy = previewBounds!.y1 - origBounds!.y1;

        // Prepare all indices to delete (primary + grouped fills, descending)
        const indicesToDelete: number[] = [primaryIndex];
        const newOps: DrawOp[] = [newOp];
        const undoGroupedOps: {
          op: DrawOp;
          previousOp: DrawOp;
          index: number;
        }[] = [];

        // Translate grouped fill ops by the same delta
        if (drag.mode === 'move') {
          for (const { op: fillOp, index: fillIndex } of drag.groupedOps) {
            // Verify the op still exists at this index
            if (fillIndex < ops.length && ops[fillIndex].id === fillOp.id) {
              indicesToDelete.push(fillIndex);
              const translatedFill = translateOp(fillOp, moveDx, moveDy);
              newOps.push(translatedFill);
              undoGroupedOps.push({
                op: translatedFill,
                previousOp: fillOp,
                index: fillIndex,
              });
            }
          }
        } else if (drag.mode === 'resize') {
          // Scale grouped fill op origins by the same transform applied to the primary op.
          // Compute scale factors from original bounds → preview bounds.
          const oW = origBounds!.x2 - origBounds!.x1;
          const oH = origBounds!.y2 - origBounds!.y1;
          const pW = previewBounds!.x2 - previewBounds!.x1;
          const pH = previewBounds!.y2 - previewBounds!.y1;
          const sX = oW > 0 ? pW / oW : 1;
          const sY = oH > 0 ? pH / oH : 1;
          const anchorX = origBounds!.x1;
          const anchorY = origBounds!.y1;
          // Offset accounts for the anchor shifting between orig and preview
          const offsetX = previewBounds!.x1 - anchorX * sX;
          const offsetY = previewBounds!.y1 - anchorY * sY;

          for (const { op: fillOp, index: fillIndex } of drag.groupedOps) {
            if (fillIndex < ops.length && ops[fillIndex].id === fillOp.id) {
              indicesToDelete.push(fillIndex);
              const scaledFill: DrawOp = { ...fillOp, ts: Date.now() };
              if (scaledFill.x1 !== undefined)
                scaledFill.x1 = scaledFill.x1 * sX + offsetX;
              if (scaledFill.y1 !== undefined)
                scaledFill.y1 = scaledFill.y1 * sY + offsetY;
              newOps.push(scaledFill);
              undoGroupedOps.push({
                op: scaledFill,
                previousOp: fillOp,
                index: fillIndex,
              });
            }
          }
        }

        // Sort descending for safe deletion
        indicesToDelete.sort((a, b) => b - a);

        opsArray.doc?.transact(() => {
          for (const idx of indicesToDelete) {
            opsArray.delete(idx, 1);
          }
          // Push all ops at the end (z-order: moved to top)
          opsArray.push(newOps);
        });

        undoStackRef.current.push({
          action: 'transform',
          op: newOp,
          previousOp: drag.originalOp,
          index: primaryIndex,
          groupedOps: undoGroupedOps.length > 0 ? undoGroupedOps : undefined,
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
    setSuppressedOpIds(null);
    scheduleViewportRender();
  }, [
    opsArray,
    undoStackRef,
    redoStackRef,
    setCanUndo,
    setCanRedo,
    updateSelectionBounds,
    setSuppressedOpIds,
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
        if (!selectedOp || !SELECTABLE_TYPES.has(selectedOp.type)) {
          selectionRef.current = { selectedOpId: null, selectionBounds: null };
          previewOpRef.current = null;
          setSuppressedOpIds(null);
          return;
        }
        const latestBounds = getOpBounds(selectedOp);
        if (!latestBounds) {
          selectionRef.current = { selectedOpId: null, selectionBounds: null };
          previewOpRef.current = null;
          setSuppressedOpIds(null);
          return;
        }
        selection.selectionBounds = latestBounds;
      }

      const preview = previewOpRef.current;

      if (preview) {
        ctx.save();
        const worldToPhys = dpr * transform.scale;
        ctx.scale(worldToPhys, worldToPhys);
        ctx.translate(-transform.x, -transform.y);

        if (
          preview.type === 'image' &&
          preview.imageId &&
          preview.x1 !== undefined &&
          preview.y1 !== undefined &&
          preview.x2 !== undefined &&
          preview.y2 !== undefined
        ) {
          // Image preview
          const bitmap = getCachedImage?.(preview.imageId);
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
        } else if (
          SELECTABLE_TYPES.has(preview.type) &&
          preview.type !== 'image'
        ) {
          // Drawing op preview: render fill (if any) then stroke
          const drag = dragRef.current;
          if (drag && drag.groupedOps.length > 0) {
            // Use the colour from the first grouped fill op
            const fillColor = drag.groupedOps[0].op.colour;
            ctx.fillStyle = fillColor;
            if (
              preview.type === 'rect' &&
              preview.x1 !== undefined &&
              preview.y1 !== undefined &&
              preview.x2 !== undefined &&
              preview.y2 !== undefined
            ) {
              ctx.fillRect(
                Math.min(preview.x1, preview.x2),
                Math.min(preview.y1, preview.y2),
                Math.abs(preview.x2 - preview.x1),
                Math.abs(preview.y2 - preview.y1),
              );
            } else if (
              preview.type === 'circle' &&
              preview.x1 !== undefined &&
              preview.y1 !== undefined &&
              preview.x2 !== undefined &&
              preview.y2 !== undefined
            ) {
              const rx = Math.abs(preview.x2 - preview.x1);
              const ry = Math.abs(preview.y2 - preview.y1);
              ctx.beginPath();
              ctx.ellipse(preview.x1, preview.y1, rx, ry, 0, 0, Math.PI * 2);
              ctx.fill();
            }
            // paths/lines: complex fill regions — stroke-only is fine
          }
          drawStrokeOp(ctx, preview);
        }

        ctx.restore();
      }

      if (!selection.selectionBounds) return;
      const minX = Math.min(
        selection.selectionBounds.x1,
        selection.selectionBounds.x2,
      );
      const maxX = Math.max(
        selection.selectionBounds.x1,
        selection.selectionBounds.x2,
      );
      const minY = Math.min(
        selection.selectionBounds.y1,
        selection.selectionBounds.y2,
      );
      const maxY = Math.max(
        selection.selectionBounds.y1,
        selection.selectionBounds.y2,
      );

      const toPhysX = (wx: number) =>
        (wx - transform.x) * transform.scale * dpr;
      const toPhysY = (wy: number) =>
        (wy - transform.y) * transform.scale * dpr;

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

      // Show resize handles for all selectable ops
      const handleRadius = 6 * dpr;
      const handles = [
        { x: px1, y: py1 },
        { x: px2, y: py1 },
        { x: px1, y: py2 },
        { x: px2, y: py2 },
        { x: (px1 + px2) / 2, y: py1 },
        { x: (px1 + px2) / 2, y: py2 },
        { x: px1, y: (py1 + py2) / 2 },
        { x: px2, y: (py1 + py2) / 2 },
      ];

      for (const handle of handles) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, handleRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    },
    [opsArray, getCachedImage, setSuppressedOpIds],
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
          if (handle === 'n' || handle === 's') return 'ns-resize';
          if (handle === 'e' || handle === 'w') return 'ew-resize';
        }
      }

      const hitOp = hitTestAny(worldPos);
      if (hitOp) return 'move';
      return 'default';
    },
    [opsArray, hitTestAny, getHandleAtScreenPos],
  );

  return {
    handleSelectStart,
    handleSelectMove,
    handleSelectEnd,
    getSelectedOpId,
    deleteSelected,
    deselect,
    drawOverlay,
    getHoverCursor,
  };
}
