import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import type { TextRun } from './types';
import { normaliseRuns, runsToPlainText } from './text-model';
import { renderRunsToDOM, extractRunsFromDOM } from './text-dom';
import {
  saveFlatSelection,
  restoreFlatSelection,
  type FlatSelection,
} from './text-selection';

export interface TextEditorHandle {
  /** Get the current model from the DOM. */
  getRuns: () => TextRun[];
  /** Get the current flat selection. */
  getSelection: () => FlatSelection | null;
  /** Replace the model and restore selection. */
  setRuns: (runs: TextRun[], selection?: FlatSelection | null) => void;
  /** Focus the editor. */
  focus: () => void;
}

interface WhiteboardTextEditorProps {
  initialRuns: TextRun[];
  defaultSize: number;
  defaultColour: string;
  screenX: number;
  screenY: number;
  minWidthPx: number;
  minHeightPx: number;
  scale: number;
  lightTextColour: boolean;
  onBlur: (runs: TextRun[]) => void;
  onEscape: () => void;
  onCommit: (runs: TextRun[]) => void;
  onModelChange?: (runs: TextRun[]) => void;
}

export const WhiteboardTextEditor = forwardRef<
  TextEditorHandle,
  WhiteboardTextEditorProps
>(function WhiteboardTextEditor(
  {
    initialRuns,
    defaultSize,
    defaultColour,
    screenX,
    screenY,
    minWidthPx,
    minHeightPx,
    scale,
    lightTextColour,
    onBlur,
    onEscape,
    onCommit,
    onModelChange,
  },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<TextRun[]>(initialRuns);
  const suppressBlurRef = useRef(false);

  // Render initial content
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    renderRunsToDOM(el, initialRuns, defaultSize);
    modelRef.current = initialRuns;

    // Focus and place caret at end
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!editorRef.current) return;
        editorRef.current.focus();
        const plainText = runsToPlainText(initialRuns);
        restoreFlatSelection(editorRef.current, {
          start: plainText.length,
          end: plainText.length,
        });
      });
    });
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCurrentRuns = useCallback((): TextRun[] => {
    const el = editorRef.current;
    if (!el) return modelRef.current;
    return extractRunsFromDOM(el, defaultSize, defaultColour);
  }, [defaultSize, defaultColour]);

  const getSelection = useCallback((): FlatSelection | null => {
    const el = editorRef.current;
    if (!el) return null;
    return saveFlatSelection(el);
  }, []);

  const setRunsAndRestore = useCallback(
    (runs: TextRun[], selection?: FlatSelection | null) => {
      const el = editorRef.current;
      if (!el) return;

      const normalised = normaliseRuns(runs);
      modelRef.current = normalised;
      renderRunsToDOM(el, normalised, defaultSize);

      if (selection) {
        restoreFlatSelection(el, selection);
      }
    },
    [defaultSize],
  );

  useImperativeHandle(
    ref,
    () => ({
      getRuns: getCurrentRuns,
      getSelection,
      setRuns: setRunsAndRestore,
      focus: () => editorRef.current?.focus(),
    }),
    [getCurrentRuns, getSelection, setRunsAndRestore],
  );

  const handleInput = useCallback(() => {
    const runs = getCurrentRuns();
    modelRef.current = runs;
    onModelChange?.(runs);
  }, [getCurrentRuns, onModelChange]);

  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      if (suppressBlurRef.current) {
        suppressBlurRef.current = false;
        return;
      }

      // Don't commit if focus is moving to a toolbar control
      const nextFocus = e.relatedTarget;
      if (
        nextFocus instanceof Element &&
        nextFocus.closest('[data-text-editor-focus-safe="true"]')
      ) {
        return;
      }

      // Handle null relatedTarget (click on canvas, etc.)
      if (!nextFocus) {
        requestAnimationFrame(() => {
          const active = document.activeElement;
          if (
            active instanceof Element &&
            active.closest('[data-text-editor-focus-safe="true"]')
          ) {
            return;
          }
          const runs = getCurrentRuns();
          modelRef.current = runs;
          onBlur(runs);
        });
        return;
      }

      const runs = getCurrentRuns();
      modelRef.current = runs;
      onBlur(runs);
    },
    [getCurrentRuns, onBlur],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();

      if (e.key === 'Escape') {
        onEscape();
        return;
      }

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        const runs = getCurrentRuns();
        modelRef.current = runs;
        onCommit(runs);
        return;
      }
    },
    [getCurrentRuns, onEscape, onCommit],
  );

  // Prevent default paste to handle it ourselves (strip formatting from pasted content)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      if (!text) return;
      document.execCommand('insertText', false, text);
    },
    [],
  );

  // The editor is scaled from world coords to screen coords via CSS transform.
  // So min dimensions (which are in screen pixels) need to be divided by scale
  // to appear correct after the transform is applied.
  const firstRun = initialRuns[0];
  const baseFontSize = firstRun?.size ?? defaultSize;

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      className="absolute outline-none overflow-hidden"
      style={{
        left: `${screenX}px`,
        top: `${screenY}px`,
        minWidth: `${minWidthPx / scale}px`,
        minHeight: `${minHeightPx / scale}px`,
        fontSize: `${baseFontSize}px`,
        lineHeight: '1.2',
        background: 'transparent',
        border: lightTextColour
          ? '2px solid rgba(255, 255, 255, 0.85)'
          : '2px solid #3b82f6',
        borderRadius: '4px',
        padding: '2px 4px',
        zIndex: 50,
        caretColor: lightTextColour ? '#ffffff' : '#111827',
        // Scale all the run font sizes from world coords to screen coords
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
      onInput={handleInput}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
    />
  );
});
