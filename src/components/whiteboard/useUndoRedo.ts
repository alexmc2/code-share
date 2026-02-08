import { useRef, useState, useCallback, useEffect } from 'react';
import type { DrawOp, UndoEntry } from './types';
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

    const ops = opsArray.toArray();

    if (entry.previousOp) {
      // This was a move/resize — delete edited op, re-insert original
      const index = ops.findIndex((op) => op.id === entry.op.id);
      if (index !== -1) {
        doc.transact(() => {
          opsArray.delete(index, 1);
          opsArray.push([entry.previousOp!]);
        });
      }
      redoStack.current.push(entry);
      setCanRedo(true);
    } else {
      // Standard draw/image op — find and remove
      const index = ops.findIndex((op) => op.id === entry.op.id);
      if (index !== -1) {
        // If it's an image op, save the image data for redo and remove from Y.Map
        if (entry.op.type === 'image' && entry.op.imageId && imageMap) {
          const imageData = imageMap.get(entry.op.imageId);
          if (imageData) {
            entry.imageData = imageData;
          }
          imageMap.delete(entry.op.imageId);
        }
        opsArray.delete(index, 1);
        redoStack.current.push(entry);
        setCanRedo(true);
      }
    }

    setCanUndo(undoStack.current.length > 0);
  }, [doc, opsArray, imageMap]);

  // Redo
  const handleRedo = useCallback(() => {
    if (redoStack.current.length === 0) return;

    const entry = redoStack.current.pop();
    if (!entry) return;

    if (entry.previousOp) {
      // Move/resize redo — delete the restored original, re-insert the moved version
      const ops = opsArray.toArray();
      const index = ops.findIndex((op) => op.id === entry.previousOp!.id);
      if (index !== -1) {
        doc.transact(() => {
          opsArray.delete(index, 1);
          opsArray.push([entry.op]);
        });
      }
    } else {
      // Standard draw/image op redo — re-push
      if (
        entry.op.type === 'image' &&
        entry.op.imageId &&
        entry.imageData &&
        imageMap
      ) {
        doc.transact(() => {
          imageMap!.set(entry.op.imageId!, entry.imageData!);
          opsArray.push([entry.op]);
        });
      } else {
        opsArray.push([entry.op]);
      }
    }

    undoStack.current.push(entry);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
  }, [doc, opsArray, imageMap]);

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
