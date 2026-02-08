import { useRef, useState, useCallback, useEffect } from 'react';
import type { DrawOp, UndoAction, UndoEntry } from './types';
import type * as Y from 'yjs';
import type { Doc } from 'yjs';

export interface UndoRedoState {
  canUndo: boolean;
  canRedo: boolean;
  undoStack: React.RefObject<UndoEntry[]>;
  redoStack: React.RefObject<UndoEntry[]>;
  setCanUndo: React.Dispatch<React.SetStateAction<boolean>>;
  setCanRedo: React.Dispatch<React.SetStateAction<boolean>>;
  handleUndo: () => void;
  handleRedo: () => void;
  handleClear: () => void;
}

export function useUndoRedo(
  doc: Doc,
  opsArray: Y.Array<DrawOp>,
  imageMap?: Y.Map<Uint8Array>,
): UndoRedoState {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);

  const getAction = useCallback((entry: UndoEntry): UndoAction => {
    if (entry.action) return entry.action;
    if (entry.previousOp) return 'transform';
    return 'add';
  }, []);

  // Clear canvas
  const handleClear = useCallback(() => {
    doc.transact(() => {
      opsArray.delete(0, opsArray.length);
      // Also clear all images
      if (imageMap) {
        for (const key of Array.from(imageMap.keys())) {
          imageMap.delete(key);
        }
      }
    });
    undoStack.current = [];
    redoStack.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }, [doc, opsArray, imageMap]);

  // Undo last local op
  const handleUndo = useCallback(() => {
    if (undoStack.current.length === 0) return;

    const entry = undoStack.current.pop();
    if (!entry) return;

    const action = getAction(entry);
    const ops = opsArray.toArray();

    if (action === 'transform') {
      const previousOp = entry.previousOp;
      if (entry.groupedOps && entry.groupedOps.length > 0 && previousOp) {
        // Grouped undo: revert primary + associated ops to original positions
        const currentOps = opsArray.toArray();
        const revertOps = [
          {
            currentId: entry.op.id,
            prevOp: previousOp,
            prevIndex: entry.index ?? 0,
          },
          ...entry.groupedOps.map((g) => ({
            currentId: g.op.id,
            prevOp: g.previousOp,
            prevIndex: g.index,
          })),
        ];

        // Find current indices to delete (descending)
        const deletions: number[] = [];
        for (const { currentId } of revertOps) {
          const idx = currentOps.findIndex((o) => o.id === currentId);
          if (idx !== -1) deletions.push(idx);
        }
        deletions.sort((a, b) => b - a);

        // Sort insertions ascending by original index
        revertOps.sort((a, b) => a.prevIndex - b.prevIndex);

        doc.transact(() => {
          for (const idx of deletions) {
            opsArray.delete(idx, 1);
          }
          for (const { prevOp, prevIndex } of revertOps) {
            const idx = Math.min(prevIndex, opsArray.length);
            opsArray.insert(idx, [prevOp]);
          }
        });

        redoStack.current.push(entry);
        setCanRedo(true);
      } else {
        const index = ops.findIndex((op) => op.id === entry.op.id);
        if (index !== -1 && previousOp) {
          doc.transact(() => {
            opsArray.delete(index, 1);
            opsArray.insert(index, [previousOp]);
          });
          redoStack.current.push(entry);
          setCanRedo(true);
        }
      }
    } else if (action === 'add') {
      const index = ops.findIndex((op) => op.id === entry.op.id);
      if (index !== -1) {
        doc.transact(() => {
          if (entry.op.type === 'image' && entry.op.imageId && imageMap) {
            const imageData = imageMap.get(entry.op.imageId);
            if (imageData) {
              entry.imageData = new Uint8Array(imageData);
            }
            imageMap.delete(entry.op.imageId);
          }
          opsArray.delete(index, 1);
        });
        redoStack.current.push(entry);
        setCanRedo(true);
      }
    } else if (action === 'delete') {
      const exists = ops.some((op) => op.id === entry.op.id);
      if (!exists) {
        doc.transact(() => {
          if (
            entry.op.type === 'image' &&
            entry.op.imageId &&
            entry.imageData &&
            imageMap
          ) {
            imageMap.set(entry.op.imageId, entry.imageData);
          }

          // Restore grouped ops first (ascending by original index)
          if (entry.groupedOps) {
            const sorted = [...entry.groupedOps].sort(
              (a, b) => a.index - b.index,
            );
            for (const g of sorted) {
              const idx = Math.min(g.index, opsArray.length);
              opsArray.insert(idx, [g.previousOp]);
            }
          }

          if (
            typeof entry.index === 'number' &&
            entry.index >= 0 &&
            entry.index <= opsArray.length
          ) {
            opsArray.insert(entry.index, [entry.op]);
          } else {
            opsArray.push([entry.op]);
          }
        });
        redoStack.current.push(entry);
        setCanRedo(true);
      }
    }

    setCanUndo(undoStack.current.length > 0);
  }, [doc, opsArray, imageMap, getAction]);

  // Redo
  const handleRedo = useCallback(() => {
    if (redoStack.current.length === 0) return;

    const entry = redoStack.current.pop();
    if (!entry) return;

    const action = getAction(entry);
    const ops = opsArray.toArray();
    let applied = false;

    if (action === 'transform') {
      if (entry.groupedOps && entry.groupedOps.length > 0) {
        // Grouped redo: move all ops back to end
        const currentOps = opsArray.toArray();
        const allIds = [
          entry.previousOp!.id,
          ...entry.groupedOps.map((g) => g.previousOp.id),
        ];
        const allNewOps = [entry.op, ...entry.groupedOps.map((g) => g.op)];

        const indicesToDelete: number[] = [];
        for (const id of allIds) {
          const idx = currentOps.findIndex((o) => o.id === id);
          if (idx !== -1) indicesToDelete.push(idx);
        }
        indicesToDelete.sort((a, b) => b - a);

        doc.transact(() => {
          for (const idx of indicesToDelete) {
            opsArray.delete(idx, 1);
          }
          opsArray.push(allNewOps);
        });
        applied = true;
      } else {
        const previousOp = entry.previousOp;
        const index = previousOp
          ? ops.findIndex((op) => op.id === previousOp.id)
          : -1;
        if (index !== -1) {
          doc.transact(() => {
            opsArray.delete(index, 1);
            opsArray.insert(index, [entry.op]);
          });
          applied = true;
        }
      }
    } else if (action === 'add') {
      const exists = ops.some((op) => op.id === entry.op.id);
      if (!exists) {
        if (
          entry.op.type === 'image' &&
          entry.op.imageId &&
          entry.imageData &&
          imageMap
        ) {
          doc.transact(() => {
            imageMap.set(entry.op.imageId!, entry.imageData!);
            opsArray.push([entry.op]);
          });
        } else {
          opsArray.push([entry.op]);
        }
        applied = true;
      }
    } else if (action === 'delete') {
      const index = ops.findIndex((op) => op.id === entry.op.id);
      if (index !== -1) {
        doc.transact(() => {
          if (entry.op.type === 'image' && entry.op.imageId && imageMap) {
            const imageData = imageMap.get(entry.op.imageId);
            if (imageData) {
              entry.imageData = new Uint8Array(imageData);
            }
            imageMap.delete(entry.op.imageId);
          }
          // Also delete grouped ops (descending index for safety)
          if (entry.groupedOps) {
            // Refresh indices since array may have shifted
            const currentOps = opsArray.toArray();
            const groupIds = entry.groupedOps.map((g) => g.previousOp.id);
            const groupIndices: number[] = [];
            for (const gid of groupIds) {
              const gi = currentOps.findIndex((o) => o.id === gid);
              if (gi !== -1) groupIndices.push(gi);
            }
            // Delete primary first (we already have its index), then grouped
            // But we need all indices relative to current state.
            // Collect all indices, sort descending, delete
            const primaryIdx = currentOps.findIndex(
              (o) => o.id === entry.op.id,
            );
            const allDel = [...groupIndices, primaryIdx].filter(
              (i) => i !== -1,
            );
            allDel.sort((a, b) => b - a);
            for (const di of allDel) {
              opsArray.delete(di, 1);
            }
          } else {
            opsArray.delete(index, 1);
          }
        });
        applied = true;
      }
    }

    if (applied) {
      undoStack.current.push(entry);
      setCanUndo(true);
    }
    setCanRedo(redoStack.current.length > 0);
  }, [doc, opsArray, imageMap, getAction]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if the event target is an input element (to not interfere with text input)
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      // Ctrl+Z or Cmd+Z for undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      // Ctrl+Y or Cmd+Y for redo (Windows style)
      // Ctrl+Shift+Z or Cmd+Shift+Z for redo (Mac style)
      else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'y' ||
          (e.key === 'z' && e.shiftKey) ||
          (e.key === 'Z' && e.shiftKey))
      ) {
        e.preventDefault();
        handleRedo();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  return {
    canUndo,
    canRedo,
    undoStack,
    redoStack,
    setCanUndo,
    setCanRedo,
    handleUndo,
    handleRedo,
    handleClear,
  };
}
