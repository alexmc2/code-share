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
      const index = ops.findIndex((op) => op.id === entry.op.id);
      if (index !== -1 && previousOp) {
        doc.transact(() => {
          opsArray.delete(index, 1);
          opsArray.insert(index, [previousOp]);
        });
      }
      redoStack.current.push(entry);
      setCanRedo(true);
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
      }
      redoStack.current.push(entry);
      setCanRedo(true);
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

    if (action === 'transform') {
      const previousOp = entry.previousOp;
      const index = previousOp
        ? ops.findIndex((op) => op.id === previousOp.id)
        : -1;
      if (index !== -1) {
        doc.transact(() => {
          opsArray.delete(index, 1);
          opsArray.insert(index, [entry.op]);
        });
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
          opsArray.delete(index, 1);
        });
      }
    }

    undoStack.current.push(entry);
    setCanUndo(true);
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
