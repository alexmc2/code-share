import { useRef, useState, useCallback, useEffect } from 'react';
import type { DrawOp } from './types';
import type * as Y from 'yjs';
import type { Doc } from 'yjs';

export interface UndoRedoState {
  canUndo: boolean;
  canRedo: boolean;
  undoStack: React.RefObject<DrawOp[]>;
  redoStack: React.RefObject<DrawOp[]>;
  setCanUndo: React.Dispatch<React.SetStateAction<boolean>>;
  setCanRedo: React.Dispatch<React.SetStateAction<boolean>>;
  handleUndo: () => void;
  handleRedo: () => void;
  handleClear: () => void;
}

export function useUndoRedo(
  doc: Doc,
  opsArray: Y.Array<DrawOp>,
): UndoRedoState {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoStack = useRef<DrawOp[]>([]);
  const redoStack = useRef<DrawOp[]>([]);

  // Clear canvas
  const handleClear = useCallback(() => {
    doc.transact(() => {
      opsArray.delete(0, opsArray.length);
    });
    undoStack.current = [];
    redoStack.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }, [doc, opsArray]);

  // Undo last local op
  const handleUndo = useCallback(() => {
    if (undoStack.current.length === 0) return;

    const lastOp = undoStack.current.pop();
    if (!lastOp) return;

    // Find and remove from opsArray
    const ops = opsArray.toArray();
    const index = ops.findIndex((op) => op.id === lastOp.id);
    if (index !== -1) {
      opsArray.delete(index, 1);
      redoStack.current.push(lastOp);
      setCanRedo(true);
    }

    setCanUndo(undoStack.current.length > 0);
  }, [opsArray]);

  // Redo
  const handleRedo = useCallback(() => {
    if (redoStack.current.length === 0) return;

    const op = redoStack.current.pop();
    if (!op) return;

    opsArray.push([op]);
    undoStack.current.push(op);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
  }, [opsArray]);

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
