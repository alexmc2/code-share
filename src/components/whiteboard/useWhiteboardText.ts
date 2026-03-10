import { useState, useRef, useCallback } from 'react';
import { nanoid } from 'nanoid';
import type { DrawOp, TextRun } from './types';
import type { TextEditorHandle } from './WhiteboardTextEditor';
import type { RunStyle } from './text-model';
import {
  normaliseRuns,
  runsToPlainText,
  getOpRuns,
  applyStyleToRange,
  getStyleAtOffset,
  allInRangeHaveStyle,
} from './text-model';
import { measureRichText } from './text-measure';
import type * as Y from 'yjs';

export interface TextInputState {
  worldX: number;
  worldY: number;
  screenX: number;
  screenY: number;
  minWidthPx: number;
  minHeightPx: number;
  editingOpId: string | null;
  initialRuns: TextRun[];
}

export interface UseWhiteboardTextResult {
  textInputPos: TextInputState | null;
  textEditorRef: React.RefObject<TextEditorHandle | null>;
  openTextInputAtClientPoint: (clientX: number, clientY: number) => void;
  commitText: () => void;
  closeTextInputEditor: () => void;
  applyFormattingToSelection: (style: Partial<RunStyle>) => void;
  toggleBoldOnSelection: () => void;
  toggleItalicOnSelection: () => void;
  getSelectionStyle: () => Required<RunStyle> | null;
  findTextOpAtWorldPoint: (worldX: number, worldY: number) => DrawOp | null;
}

export function useWhiteboardText(
  opsArray: Y.Array<DrawOp>,
  transformRef: React.RefObject<{ x: number; y: number; scale: number }>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  defaultSize: number,
  defaultColour: string,
  setSuppressedOpIds: (ids: Set<string> | null) => void,
  scheduleViewportRender: () => void,
  undoStackRef: React.RefObject<{ action?: string; op: DrawOp; previousOp?: DrawOp; index?: number }[]>,
  redoStackRef: React.RefObject<{ action?: string; op: DrawOp; previousOp?: DrawOp; index?: number }[]>,
  setCanUndo: (v: boolean) => void,
  setCanRedo: (v: boolean) => void,
): UseWhiteboardTextResult {
  const [textInputPos, setTextInputPos] = useState<TextInputState | null>(null);
  const textEditorRef = useRef<TextEditorHandle | null>(null);
  const closeTextInputEditor = useCallback(() => {
    setSuppressedOpIds(null);
    scheduleViewportRender();
    setTextInputPos(null);
  }, [setSuppressedOpIds, scheduleViewportRender]);

  const findTextOpAtWorldPoint = useCallback(
    (worldX: number, worldY: number): DrawOp | null => {
      const ops = opsArray.toArray();
      const hitPadding = 5 / transformRef.current.scale;
      for (let i = ops.length - 1; i >= 0; i--) {
        const op = ops[i];
        if (
          op.type !== 'text' ||
          op.x1 === undefined ||
          op.y1 === undefined ||
          op.x2 === undefined ||
          op.y2 === undefined
        ) {
          continue;
        }
        const minX = Math.min(op.x1, op.x2);
        const maxX = Math.max(op.x1, op.x2);
        const minY = Math.min(op.y1, op.y2);
        const maxY = Math.max(op.y1, op.y2);
        if (
          worldX >= minX - hitPadding &&
          worldX <= maxX + hitPadding &&
          worldY >= minY - hitPadding &&
          worldY <= maxY + hitPadding
        ) {
          return op;
        }
      }
      return null;
    },
    [opsArray, transformRef],
  );

  const commitText = useCallback(() => {
    const input = textInputPos;
    if (!input) return;

    const editor = textEditorRef.current;
    const runs = editor ? editor.getRuns() : input.initialRuns;
    const plainText = runsToPlainText(runs);
    const hasMeaningfulContent = plainText.trim().length > 0;

    const applyOpsMutation = (mutation: () => void) => {
      if (opsArray.doc) {
        opsArray.doc.transact(mutation);
      } else {
        mutation();
      }
    };

    if (input.editingOpId) {
      const ops = opsArray.toArray();
      const index = ops.findIndex((op) => op.id === input.editingOpId);
      const existingOp = index !== -1 ? ops[index] : null;
      if (existingOp && existingOp.type === 'text') {
        if (!hasMeaningfulContent) {
          applyOpsMutation(() => {
            opsArray.delete(index, 1);
          });
          undoStackRef.current.push({
            action: 'delete',
            op: existingOp,
            index,
          });
          redoStackRef.current = [];
          setCanUndo(true);
          setCanRedo(false);
          closeTextInputEditor();
          return;
        }

        const normalised = normaliseRuns(runs);
        const measured = measureRichText(normalised, defaultSize);

        // Preserve any scale factor from previous resize/transform
        let scaleX = 1;
        let scaleY = 1;
        if (
          existingOp.x1 !== undefined &&
          existingOp.y1 !== undefined &&
          existingOp.x2 !== undefined &&
          existingOp.y2 !== undefined
        ) {
          const prevRuns = getOpRuns(existingOp);
          const prevMeasured = measureRichText(prevRuns, existingOp.size || defaultSize);
          scaleX = Math.abs(existingOp.x2 - existingOp.x1) / prevMeasured.width;
          scaleY = Math.abs(existingOp.y2 - existingOp.y1) / prevMeasured.height;
        }

        const nextOp: DrawOp = {
          ...existingOp,
          ts: Date.now(),
          runs: normalised,
          // Keep legacy fields for backward compat
          text: plainText,
          colour: normalised[0]?.colour || defaultColour,
          size: normalised[0]?.size || defaultSize,
          bold: normalised[0]?.bold || undefined,
          italic: normalised[0]?.italic || undefined,
          fontFamily: normalised[0]?.fontFamily || undefined,
          x1: input.worldX,
          y1: input.worldY,
          x2: input.worldX + Math.max(1, measured.width * scaleX),
          y2: input.worldY + Math.max(1, measured.height * scaleY),
        };

        applyOpsMutation(() => {
          opsArray.delete(index, 1);
          opsArray.insert(index, [nextOp]);
        });
        undoStackRef.current.push({
          action: 'transform',
          op: nextOp,
          previousOp: existingOp,
          index,
        });
        redoStackRef.current = [];
        setCanUndo(true);
        setCanRedo(false);
        closeTextInputEditor();
        return;
      }
    }

    if (!hasMeaningfulContent) {
      closeTextInputEditor();
      return;
    }

    const normalised = normaliseRuns(runs);
    const measured = measureRichText(normalised, defaultSize);

    const op: DrawOp = {
      id: nanoid(8),
      ts: Date.now(),
      type: 'text',
      runs: normalised,
      text: plainText,
      colour: normalised[0]?.colour || defaultColour,
      size: normalised[0]?.size || defaultSize,
      bold: normalised[0]?.bold || undefined,
      italic: normalised[0]?.italic || undefined,
      fontFamily: normalised[0]?.fontFamily || undefined,
      x1: input.worldX,
      y1: input.worldY,
      x2: input.worldX + measured.width,
      y2: input.worldY + measured.height,
    };

    opsArray.push([op]);
    undoStackRef.current.push({ action: 'add', op });
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
    closeTextInputEditor();
  }, [
    textInputPos,
    closeTextInputEditor,
    defaultSize,
    defaultColour,
    opsArray,
    undoStackRef,
    redoStackRef,
    setCanUndo,
    setCanRedo,
  ]);

  const openTextInputAtClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const transform = transformRef.current;
      const worldX = (clientX - rect.left) / transform.scale + transform.x;
      const worldY = (clientY - rect.top) / transform.scale + transform.y;
      const hitTextOp = findTextOpAtWorldPoint(worldX, worldY);

      if (
        hitTextOp &&
        hitTextOp.x1 !== undefined &&
        hitTextOp.y1 !== undefined &&
        hitTextOp.x2 !== undefined &&
        hitTextOp.y2 !== undefined
      ) {
        const minX = Math.min(hitTextOp.x1, hitTextOp.x2);
        const minY = Math.min(hitTextOp.y1, hitTextOp.y2);
        const widthPx = Math.max(
          60,
          Math.abs(hitTextOp.x2 - hitTextOp.x1) * transform.scale,
        );
        const heightPx = Math.max(
          Math.ceil((hitTextOp.size || defaultSize) * transform.scale * 1.2 + 8),
          Math.abs(hitTextOp.y2 - hitTextOp.y1) * transform.scale,
        );

        const initialRuns = getOpRuns(hitTextOp);
        setSuppressedOpIds(new Set([hitTextOp.id]));
        scheduleViewportRender();


        setTextInputPos({
          worldX: minX,
          worldY: minY,
          screenX: (minX - transform.x) * transform.scale,
          screenY: (minY - transform.y) * transform.scale,
          minWidthPx: widthPx,
          minHeightPx: heightPx,
          editingOpId: hitTextOp.id,
          initialRuns,
        });
        return;
      }

      const defaultMinHeight = Math.ceil(defaultSize * transform.scale * 1.2 + 8);
      setSuppressedOpIds(null);
      scheduleViewportRender();
      setTextInputPos({
        worldX,
        worldY,
        screenX: clientX - rect.left,
        screenY: clientY - rect.top,
        minWidthPx: 60,
        minHeightPx: defaultMinHeight,
        editingOpId: null,
        initialRuns: [{ text: '', colour: defaultColour, size: defaultSize }],
      });
    },
    [
      canvasRef,
      transformRef,
      findTextOpAtWorldPoint,
      defaultSize,
      defaultColour,
      scheduleViewportRender,
      setSuppressedOpIds,
    ],
  );

  // ---------------------------------------------------------------------------
  // Selection-based formatting
  // ---------------------------------------------------------------------------

  const applyFormattingToSelection = useCallback(
    (style: Partial<RunStyle>) => {
      const editor = textEditorRef.current;
      if (!editor) return;

      const runs = editor.getRuns();
      const sel = editor.getSelection();
      if (!sel) return;

      const { start, end } = sel;
      if (start === end) {
        // No selection: apply style at caret for future typing
        // Insert a zero-width space with the new style, then re-select it
        // Actually, we modify the run at the caret position so new typing
        // inherits the style. We'll insert a marker run.
        // Simpler approach: just track "pending style" — but that needs more state.
        // For now, apply to the run at the caret.
        const updated = applyStyleToRange(runs, Math.max(0, start - 1), start, style);
        editor.setRuns(updated, sel);
        return;
      }

      const updated = applyStyleToRange(runs, start, end, style);
      editor.setRuns(updated, sel);
    },
    [],
  );

  const toggleBoldOnSelection = useCallback(() => {
    const editor = textEditorRef.current;
    if (!editor) return;
    const runs = editor.getRuns();
    const sel = editor.getSelection();
    if (!sel) return;
    const { start, end } = sel;
    const allBold =
      start < end
        ? allInRangeHaveStyle(runs, start, end, 'bold')
        : getStyleAtOffset(runs, start).bold;
    applyFormattingToSelection({ bold: !allBold });
  }, [applyFormattingToSelection]);

  const toggleItalicOnSelection = useCallback(() => {
    const editor = textEditorRef.current;
    if (!editor) return;
    const runs = editor.getRuns();
    const sel = editor.getSelection();
    if (!sel) return;
    const { start, end } = sel;
    const allItalic =
      start < end
        ? allInRangeHaveStyle(runs, start, end, 'italic')
        : getStyleAtOffset(runs, start).italic;
    applyFormattingToSelection({ italic: !allItalic });
  }, [applyFormattingToSelection]);

  const getSelectionStyle = useCallback((): Required<RunStyle> | null => {
    const editor = textEditorRef.current;
    if (!editor) return null;
    const runs = editor.getRuns();
    const sel = editor.getSelection();
    if (!sel) return null;
    return getStyleAtOffset(runs, sel.start);
  }, []);

  return {
    textInputPos,
    textEditorRef,
    openTextInputAtClientPoint,
    commitText,
    closeTextInputEditor,
    applyFormattingToSelection,
    toggleBoldOnSelection,
    toggleItalicOnSelection,
    getSelectionStyle,
    findTextOpAtWorldPoint,
  };
}
