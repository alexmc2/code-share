import { useRef, useEffect, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import { ImagePlus, X } from 'lucide-react';
import { useSession } from '../../lib/useSession';
import { useTheme } from '../../lib/useTheme';
import type { Tool, DrawOp, Point } from './types';
import {
  SIZES,
  ERASER_SIZES,
  TEXT_SIZES,
  MAX_IMAGES,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  MIN_SCALE,
  MAX_SCALE,
} from './types';
import { useViewport } from './useViewport';
import { useWhiteboardCanvas } from './useWhiteboardCanvas';
import { useUndoRedo } from './useUndoRedo';
import { useDrawing } from './useDrawing';
import { usePointerHandlers } from './usePointerHandlers';
import { useWhiteboardImages } from './useWhiteboardImages';
import { useImageSelect } from './useImageSelect';
import { Toolbar } from './Toolbar';

function normalizeWheelDelta(
  delta: number,
  deltaMode: number,
  pageSize: number,
): number {
  if (deltaMode === 1) return delta * 16; // line units
  if (deltaMode === 2) return delta * pageSize; // page units
  return delta; // pixel units
}

function isTypingInEditableField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

function isLightHexColour(colour: string): boolean {
  const hex = colour.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance >= 0.72;
}

const PASTE_TIP_STORAGE_KEY = 'code-share-whiteboard-paste-tip-seen-v1';
const PASTE_TIP_ENTER_DELAY_MS = 250;
const PASTE_TIP_AUTO_HIDE_MS = 15000;
const PASTE_TIP_EXIT_MS = 240;

interface TextInputState {
  worldX: number;
  worldY: number;
  screenX: number;
  screenY: number;
  minWidthPx: number;
  minHeightPx: number;
  editingOpId: string | null;
  initialValue: string;
}

export function Whiteboard() {
  const { doc } = useSession();
  const { isDark } = useTheme();

  // Tool state
  const [tool, setToolRaw] = useState<Tool>('pen');
  const [colour, setColour] = useState(isDark ? '#ffffff' : '#000000');
  const [size, setSize] = useState(5);
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);
  const [fontFamily, setFontFamily] = useState('sans-serif');
  const commitTextRef = useRef<() => void>(() => {});
  const [selectCursor, setSelectCursor] = useState('default');
  const selectCursorRef = useRef('default');
  const [zoomPercent, setZoomPercent] = useState(100);
  const [showPasteTipToast, setShowPasteTipToast] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(PASTE_TIP_STORAGE_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const [pasteTipVisible, setPasteTipVisible] = useState(false);
  const pasteTipDismissedRef = useRef(false);
  const pasteTipExitTimerRef = useRef<number | undefined>(undefined);
  const pasteShortcutLabel =
    typeof navigator !== 'undefined' &&
    /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)
      ? 'Cmd+V'
      : 'Ctrl+V';

  // Wrap setTool to adjust size when switching to/from eraser
  const setTool = useCallback((newTool: Tool) => {
    // Commit any in-progress text when switching away from text tool
    if (newTool !== 'text') {
      commitTextRef.current();
    }
    skipCaptureRef.current = newTool === 'text';
    setToolRaw(newTool);
    if (newTool === 'select') {
      selectCursorRef.current = 'default';
      setSelectCursor('default');
    }
    if (newTool === 'text') {
      setSize((prev) => {
        if (TEXT_SIZES.some((s) => s.value === prev)) return prev;
        return TEXT_SIZES[1].value;
      });
    } else if (newTool === 'eraser') {
      setSize(ERASER_SIZES[1].value);
    } else if (newTool !== 'select') {
      setSize((prev) => {
        if (
          (ERASER_SIZES.some((s) => s.value === prev) &&
            !SIZES.some((s) => s.value === prev)) ||
          (TEXT_SIZES.some((s) => s.value === prev) &&
            !SIZES.some((s) => s.value === prev))
        ) {
          return SIZES[1].value;
        }
        return prev;
      });
    }
  }, []);

  // Get Y.Array for drawing ops
  const opsArray = doc.getArray<DrawOp>('whiteboard');

  // CRDT-synced whiteboard settings (shared across all peers)
  const settingsMap = doc.getMap<boolean>('whiteboard-settings');
  const [imagesOnTop, setImagesOnTop] = useState<boolean>(() => {
    return settingsMap.get('imagesOnTop') ?? true;
  });

  useEffect(() => {
    const observer = (event: Y.YMapEvent<boolean>) => {
      if (event.keysChanged.has('imagesOnTop')) {
        setImagesOnTop(settingsMap.get('imagesOnTop') ?? true);
      }
    };
    settingsMap.observe(observer);
    return () => settingsMap.unobserve(observer);
  }, [settingsMap]);

  const toggleImagesOnTop = useCallback(() => {
    const next = !(settingsMap.get('imagesOnTop') ?? true);
    settingsMap.set('imagesOnTop', next);
  }, [settingsMap]);

  // Shared refs lifted here to break circular deps between hooks
  const canvasCssWidthRef = useRef(0);
  const canvasCssHeightRef = useRef(0);
  const currentOp = useRef<DrawOp | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Mobile detection for UI adjustments
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.matchMedia('(max-width: 768px)').matches);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Image storage & cache (Y.Map)
  const images = useWhiteboardImages(doc, opsArray);

  // Viewport (pan/zoom/transform)
  const {
    transformRef,
    isPanning,
    lastPanPoint,
    lastPinchDistance,
    hasUserViewportChangeRef,
    activePointersRef,
    clampTransform,
    updateViewportForResize,
    getActiveTouchPoints,
    getTouchCentroid,
    getTouchDistance,
  } = useViewport(canvasCssWidthRef, canvasCssHeightRef);

  const setZoomFromScale = useCallback((scale: number) => {
    const next = Math.round(scale * 100);
    setZoomPercent((prev) => (prev === next ? prev : next));
  }, []);

  const refreshZoomPercent = useCallback(() => {
    setZoomFromScale(transformRef.current.scale);
  }, [setZoomFromScale, transformRef]);

  useEffect(() => {
    const onResize = () => {
      requestAnimationFrame(refreshZoomPercent);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [refreshZoomPercent]);

  const dismissPasteTipToast = useCallback(() => {
    if (pasteTipDismissedRef.current) return;
    pasteTipDismissedRef.current = true;
    setPasteTipVisible(false);
    try {
      localStorage.setItem(PASTE_TIP_STORAGE_KEY, '1');
    } catch {
      // Ignore storage errors; this is a non-critical preference.
    }
    window.clearTimeout(pasteTipExitTimerRef.current);
    pasteTipExitTimerRef.current = window.setTimeout(() => {
      setShowPasteTipToast(false);
    }, PASTE_TIP_EXIT_MS);
  }, []);

  // Cleanup paste-tip exit timer on unmount
  useEffect(() => {
    return () => {
      window.clearTimeout(pasteTipExitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!showPasteTipToast) {
      return;
    }

    const enterTimer = window.setTimeout(() => {
      setPasteTipVisible(true);
    }, PASTE_TIP_ENTER_DELAY_MS);

    const hideTimer = window.setTimeout(() => {
      dismissPasteTipToast();
    }, PASTE_TIP_ENTER_DELAY_MS + PASTE_TIP_AUTO_HIDE_MS);

    return () => {
      window.clearTimeout(enterTimer);
      window.clearTimeout(hideTimer);
    };
  }, [dismissPasteTipToast, showPasteTipToast]);

  // Canvas & rendering
  const canvas = useWhiteboardCanvas(
    isDark,
    opsArray,
    transformRef,
    currentOp,
    updateViewportForResize,
    canvasCssWidthRef,
    canvasCssHeightRef,
    canvasRef,
    containerRef,
    images.getCachedImage,
    imagesOnTop,
  );
  const {
    scheduleViewportRender,
    rebuildAndRender,
    setOverlayRenderer,
    setSuppressedOpIds,
  } = canvas;

  // Connect image hook rebuild callback to canvas
  useEffect(() => {
    images.setRebuildCallback(rebuildAndRender);
  }, [images, rebuildAndRender]);

  // Undo/redo
  const undoRedo = useUndoRedo(doc, opsArray, images.imageMap);
  const {
    canUndo,
    canRedo,
    undoStack: undoStackRef,
    redoStack: redoStackRef,
    setCanUndo,
    setCanRedo,
    handleUndo,
    handleRedo,
    handleClear,
  } = undoRedo;

  // Drawing interaction
  const drawing = useDrawing(
    tool,
    colour,
    size,
    opsArray,
    transformRef,
    canvasRef,
    scheduleViewportRender,
    undoStackRef,
    redoStackRef,
    setCanUndo,
    setCanRedo,
    currentOp,
  );

  // Object select (move & resize images and other drawing ops)
  const imageSelect = useImageSelect(
    opsArray,
    images.imageMap,
    transformRef,
    canvasRef,
    scheduleViewportRender,
    setSuppressedOpIds,
    undoStackRef,
    redoStackRef,
    setCanUndo,
    setCanRedo,
    images.getCachedImage,
  );
  const {
    handleSelectStart,
    handleSelectMove,
    handleSelectEnd,
    getSelectedOpId,
    deleteSelected,
    deselect: deselectSelected,
    drawOverlay,
    getHoverCursor,
  } = imageSelect;

  useEffect(() => {
    if (tool === 'select') {
      setOverlayRenderer(drawOverlay);
    } else {
      setOverlayRenderer(null);
    }

    return () => {
      setOverlayRenderer(null);
    };
  }, [tool, setOverlayRenderer, drawOverlay]);

  // Deselect when switching away from select tool
  useEffect(() => {
    if (tool !== 'select') {
      deselectSelected();
    }
  }, [tool, deselectSelected]);

  // --- Text input state ---
  const [textInputPos, setTextInputPos] = useState<TextInputState | null>(
    null,
  );
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const [textInputKey, setTextInputKey] = useState(0);
  /** Tells usePointerHandlers to skip setPointerCapture for text tool. */
  const skipCaptureRef = useRef(false);

  const measureTextBounds = useCallback(
    (
      text: string,
      fontSize: number,
      bold: boolean,
      italic: boolean,
      family: string,
    ): { width: number; height: number } | null => {
      const measureCanvas = document.createElement('canvas');
      const measureCtx = measureCanvas.getContext('2d');
      if (!measureCtx) return null;
      const boldStr = bold ? 'bold ' : '';
      const italicStr = italic ? 'italic ' : '';
      measureCtx.font = `${italicStr}${boldStr}${fontSize}px ${family}`;
      const lines = text.split('\n');
      const lineHeight = fontSize * 1.2;
      let maxWidth = 0;
      for (const line of lines) {
        const w = measureCtx.measureText(line).width;
        if (w > maxWidth) maxWidth = w;
      }
      const totalHeight = lineHeight * lines.length;
      if (maxWidth <= 0 || totalHeight <= 0) return null;
      return { width: maxWidth, height: totalHeight };
    },
    [],
  );

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

  useEffect(() => {
    const handleDelete = (e: KeyboardEvent) => {
      if (isTypingInEditableField(e.target)) return;
      if (!containerRef.current || containerRef.current.offsetParent === null)
        return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!getSelectedOpId()) return;

      e.preventDefault();
      deleteSelected();
      selectCursorRef.current = 'default';
      setSelectCursor('default');
    };

    document.addEventListener('keydown', handleDelete);
    return () => document.removeEventListener('keydown', handleDelete);
  }, [getSelectedOpId, deleteSelected]);

  // Tool shortcuts: V=select, B=pen, E=eraser, G=fill, T=text, S=cycle shape tools
  useEffect(() => {
    const handleToolShortcuts = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInEditableField(e.target)) return;
      if (textInputPos) return;
      if (!containerRef.current || containerRef.current.offsetParent === null) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'v') {
        e.preventDefault();
        setTool('select');
      } else if (key === 'b') {
        e.preventDefault();
        setTool('pen');
      } else if (key === 'e') {
        e.preventDefault();
        setTool('eraser');
      } else if (key === 'g') {
        e.preventDefault();
        setTool('fill');
      } else if (key === 't') {
        e.preventDefault();
        setTool('text');
      } else if (key === 's') {
        e.preventDefault();
        if (tool === 'line') {
          setTool('rect');
        } else if (tool === 'rect') {
          setTool('circle');
        } else {
          setTool('line');
        }
      }
    };

    document.addEventListener('keydown', handleToolShortcuts);
    return () => document.removeEventListener('keydown', handleToolShortcuts);
  }, [setTool, tool, textInputPos]);

  // --- Spacebar + drag pan ---
  const isSpaceHeldRef = useRef(false);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const isSpaceDraggingRef = useRef(false);
  const [isSpaceDragging, setIsSpaceDragging] = useState(false);
  const spacePanStartRef = useRef<Point>({ x: 0, y: 0 });

  const commitText = useCallback(() => {
    const input = textInputPos;
    if (!input) return;

    const textarea = textInputRef.current;
    const rawValue = textarea?.value ?? input.initialValue;
    const hasMeaningfulContent = rawValue.trim().length > 0;
    // Clear textarea value immediately to prevent double-commit (blur + enter race)
    if (textarea) textarea.value = '';

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

        const nextTextBounds = measureTextBounds(
          rawValue,
          size,
          textBold,
          textItalic,
          fontFamily,
        );
        if (!nextTextBounds) {
          closeTextInputEditor();
          return;
        }

        let scaleX = 1;
        let scaleY = 1;
        if (
          existingOp.x1 !== undefined &&
          existingOp.y1 !== undefined &&
          existingOp.x2 !== undefined &&
          existingOp.y2 !== undefined &&
          existingOp.text
        ) {
          const previousTextBounds = measureTextBounds(
            existingOp.text,
            existingOp.size,
            !!existingOp.bold,
            !!existingOp.italic,
            existingOp.fontFamily || 'sans-serif',
          );
          if (previousTextBounds) {
            scaleX =
              Math.abs(existingOp.x2 - existingOp.x1) / previousTextBounds.width;
            scaleY =
              Math.abs(existingOp.y2 - existingOp.y1) /
              previousTextBounds.height;
          }
        }

        const nextOp: DrawOp = {
          ...existingOp,
          ts: Date.now(),
          colour,
          size,
          text: rawValue,
          bold: textBold || undefined,
          italic: textItalic || undefined,
          fontFamily: fontFamily !== 'sans-serif' ? fontFamily : undefined,
          x1: input.worldX,
          y1: input.worldY,
          x2: input.worldX + Math.max(1, nextTextBounds.width * scaleX),
          y2: input.worldY + Math.max(1, nextTextBounds.height * scaleY),
        };

        const unchanged =
          existingOp.text === nextOp.text &&
          existingOp.colour === nextOp.colour &&
          existingOp.size === nextOp.size &&
          !!existingOp.bold === !!nextOp.bold &&
          !!existingOp.italic === !!nextOp.italic &&
          (existingOp.fontFamily || undefined) ===
            (nextOp.fontFamily || undefined) &&
          existingOp.x1 === nextOp.x1 &&
          existingOp.y1 === nextOp.y1 &&
          existingOp.x2 === nextOp.x2 &&
          existingOp.y2 === nextOp.y2;

        if (!unchanged) {
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
        }

        closeTextInputEditor();
        return;
      }
    }

    if (!hasMeaningfulContent) {
      closeTextInputEditor();
      return;
    }

    const bounds = measureTextBounds(
      rawValue,
      size,
      textBold,
      textItalic,
      fontFamily,
    );
    if (!bounds) {
      closeTextInputEditor();
      return;
    }

    const op: DrawOp = {
      id: nanoid(8),
      ts: Date.now(),
      type: 'text',
      colour,
      size,
      text: rawValue,
      bold: textBold || undefined,
      italic: textItalic || undefined,
      fontFamily: fontFamily !== 'sans-serif' ? fontFamily : undefined,
      x1: input.worldX,
      y1: input.worldY,
      x2: input.worldX + bounds.width,
      y2: input.worldY + bounds.height,
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
    measureTextBounds,
    size,
    colour,
    textBold,
    textItalic,
    fontFamily,
    opsArray,
    undoStackRef,
    redoStackRef,
    setCanUndo,
    setCanRedo,
  ]);

  // Keep ref in sync so setTool can call the latest commitText.
  // This must run in an effect to satisfy react-hooks/refs.
  useEffect(() => {
    commitTextRef.current = commitText;
  }, [commitText]);

  // Focus textarea reliably after it renders (autoFocus alone is unreliable
  // when React batches the state update inside a pointer-event handler)
  useEffect(() => {
    if (textInputPos && textInputRef.current) {
      // Double-rAF to ensure the DOM has painted before focusing
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const textarea = textInputRef.current;
          if (!textarea) return;
          textarea.focus();
          const length = textarea.value.length;
          textarea.setSelectionRange(length, length);
        });
      });
    }
  }, [textInputPos, textInputKey]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat) return;
      if (textInputPos) return;
      if (isTypingInEditableField(e.target)) return;
      if (!containerRef.current || containerRef.current.offsetParent === null)
        return;
      e.preventDefault();
      isSpaceHeldRef.current = true;
      setIsSpaceHeld(true);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ') return;
      isSpaceHeldRef.current = false;
      isSpaceDraggingRef.current = false;
      setIsSpaceHeld(false);
      setIsSpaceDragging(false);
    };

    const handleBlur = () => {
      isSpaceHeldRef.current = false;
      isSpaceDraggingRef.current = false;
      setIsSpaceHeld(false);
      setIsSpaceDragging(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [textInputPos]);

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
          Math.ceil(hitTextOp.size * transform.scale * 1.2 + 8),
          Math.abs(hitTextOp.y2 - hitTextOp.y1) * transform.scale,
        );

        setColour(hitTextOp.colour);
        setSize(hitTextOp.size);
        setTextBold(!!hitTextOp.bold);
        setTextItalic(!!hitTextOp.italic);
        setFontFamily(hitTextOp.fontFamily || 'sans-serif');
        setSuppressedOpIds(new Set([hitTextOp.id]));
        scheduleViewportRender();

        setTextInputKey((k) => k + 1);
        setTextInputPos({
          worldX: minX,
          worldY: minY,
          screenX: (minX - transform.x) * transform.scale,
          screenY: (minY - transform.y) * transform.scale,
          minWidthPx: widthPx,
          minHeightPx: heightPx,
          editingOpId: hitTextOp.id,
          initialValue: hitTextOp.text || '',
        });
        return;
      }

      const defaultMinHeight = Math.ceil(size * transform.scale * 1.2 + 8);
      setSuppressedOpIds(null);
      scheduleViewportRender();
      setTextInputKey((k) => k + 1);
      setTextInputPos({
        worldX,
        worldY,
        screenX: clientX - rect.left,
        screenY: clientY - rect.top,
        minWidthPx: 60,
        minHeightPx: defaultMinHeight,
        editingOpId: null,
        initialValue: '',
      });
    },
    [
      canvasRef,
      transformRef,
      findTextOpAtWorldPoint,
      size,
      scheduleViewportRender,
      setSuppressedOpIds,
    ],
  );

  // Wrapped handlers that delegate to select tool or drawing tool
  const wrappedHandleStart = useCallback(
    (e: React.PointerEvent) => {
      // Spacebar + drag pan (mouse/pen only)
      if (isSpaceHeldRef.current && e.pointerType !== 'touch') {
        isSpaceDraggingRef.current = true;
        setIsSpaceDragging(true);
        spacePanStartRef.current = { x: e.clientX, y: e.clientY };
        canvasRef.current?.setPointerCapture(e.pointerId);
        return;
      }
      if (tool === 'select') {
        handleSelectStart(e);
      } else if (tool === 'text') {
        // Commit any in-progress text on pointer down.
        // Actual input placement is done on click, which is more reliable for focus.
        commitText();
      } else {
        drawing.handleStart(e);
      }
    },
    [tool, handleSelectStart, drawing, commitText],
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (tool !== 'text') return;
      if (isSpaceHeldRef.current) return;
      openTextInputAtClientPoint(e.clientX, e.clientY);
    },
    [tool, openTextInputAtClientPoint],
  );

  const handleCanvasDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (textInputPos) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const transform = transformRef.current;
      const worldX = (e.clientX - rect.left) / transform.scale + transform.x;
      const worldY = (e.clientY - rect.top) / transform.scale + transform.y;
      const hitTextOp = findTextOpAtWorldPoint(worldX, worldY);
      if (!hitTextOp) return;
      setTool('text');
      openTextInputAtClientPoint(e.clientX, e.clientY);
    },
    [
      textInputPos,
      canvasRef,
      transformRef,
      findTextOpAtWorldPoint,
      setTool,
      openTextInputAtClientPoint,
    ],
  );

  const wrappedHandleMove = useCallback(
    (e: React.PointerEvent) => {
      if (isSpaceDraggingRef.current) {
        const dx = e.clientX - spacePanStartRef.current.x;
        const dy = e.clientY - spacePanStartRef.current.y;
        spacePanStartRef.current = { x: e.clientX, y: e.clientY };

        const t = transformRef.current;
        const nextX = t.x - dx / t.scale;
        const nextY = t.y - dy / t.scale;
        transformRef.current = clampTransform(nextX, nextY, t.scale);
        hasUserViewportChangeRef.current = true;
        scheduleViewportRender();
        return;
      }
      if (tool === 'select') {
        handleSelectMove(e);
      } else {
        drawing.handleMove(e);
      }
    },
    [
      tool,
      handleSelectMove,
      drawing,
      transformRef,
      clampTransform,
      hasUserViewportChangeRef,
      scheduleViewportRender,
    ],
  );

  const wrappedHandleEnd = useCallback(() => {
    if (isSpaceDraggingRef.current) {
      isSpaceDraggingRef.current = false;
      setIsSpaceDragging(false);
      return;
    }
    if (tool === 'select') {
      handleSelectEnd();
    } else {
      drawing.handleEnd();
    }
  }, [tool, handleSelectEnd, drawing]);

  // Pointer event dispatch
  const pointers = usePointerHandlers(
    canvasRef,
    transformRef,
    isPanning,
    lastPanPoint,
    lastPinchDistance,
    hasUserViewportChangeRef,
    activePointersRef,
    clampTransform,
    getActiveTouchPoints,
    getTouchCentroid,
    getTouchDistance,
    drawing.isDrawing,
    currentOp,
    wrappedHandleStart,
    wrappedHandleMove,
    wrappedHandleEnd,
    scheduleViewportRender,
    setZoomFromScale,
    skipCaptureRef,
  );

  // --- Image upload handler ---
  const handleImageUpload = useCallback(
    async (source: File | Blob) => {
      if (images.imageCount() >= MAX_IMAGES) {
        alert(`Maximum of ${MAX_IMAGES} images reached.`);
        return;
      }

      try {
        const transform = transformRef.current;
        const viewW = canvasCssWidthRef.current / transform.scale;
        const viewH = canvasCssHeightRef.current / transform.scale;
        const centerX = transform.x + viewW / 2;
        const centerY = transform.y + viewH / 2;

        const op = await images.addImage(
          source,
          centerX,
          centerY,
          viewW,
          viewH,
        );
        if (op) {
          // Push to undo stack
          const imageData = images.imageMap.get(op.imageId!);
          undoStackRef.current.push({
            action: 'add',
            op,
            imageData: imageData ? new Uint8Array(imageData) : undefined,
          });
          redoStackRef.current = [];
          setCanUndo(true);
          setCanRedo(false);

          // Switch to select tool so user can reposition
          setTool('select');
        } else {
          alert(`Maximum of ${MAX_IMAGES} images reached.`);
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to process image');
      }
    },
    [
      images,
      transformRef,
      undoStackRef,
      redoStackRef,
      setCanUndo,
      setCanRedo,
      setTool,
    ],
  );

  // --- Clipboard paste ---
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      // Don't intercept paste in text inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      // Skip when whiteboard tab is not visible
      if (!containerRef.current || containerRef.current.offsetParent === null) {
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) {
            await handleImageUpload(blob);
            dismissPasteTipToast();
          }
          return;
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handleImageUpload, dismissPasteTipToast]);

  // Generate custom round cursor for pen and eraser tools
  const brushCursor = (() => {
    if (tool === 'select') return 'default';
    if (tool === 'text') return 'text';
    if (tool !== 'eraser' && tool !== 'pen') return 'crosshair';

    const screenSize = Math.max(8, Math.min(128, size));
    const halfSize = screenSize / 2;

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${screenSize}" height="${screenSize}" viewBox="0 0 ${screenSize} ${screenSize}">
        <circle cx="${halfSize}" cy="${halfSize}" r="${halfSize - 1}" fill="none" stroke="rgba(128,128,128,0.8)" stroke-width="2"/>
        <circle cx="${halfSize}" cy="${halfSize}" r="1" fill="rgba(128,128,128,0.8)"/>
      </svg>
    `.trim();

    const dataUrl = `data:image/svg+xml;base64,${btoa(svg)}`;
    return `url(${dataUrl}) ${halfSize} ${halfSize}, crosshair`;
  })();

  // Dynamic cursor for select tool (move/resize feedback)
  const handleMouseMoveForCursor = useCallback(
    (e: React.PointerEvent) => {
      if (tool !== 'select') return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const worldPos = {
        x:
          (e.clientX - rect.left) / transformRef.current.scale +
          transformRef.current.x,
        y:
          (e.clientY - rect.top) / transformRef.current.scale +
          transformRef.current.y,
      };
      const cursor = getHoverCursor(worldPos, transformRef.current);
      if (cursor !== selectCursorRef.current) {
        selectCursorRef.current = cursor;
        setSelectCursor(cursor);
      }
    },
    [tool, transformRef, getHoverCursor],
  );

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const transform = transformRef.current;
      const deltaY = normalizeWheelDelta(e.deltaY, e.deltaMode, rect.height);
      if (!Number.isFinite(deltaY) || deltaY === 0) return;

      // Zoom anchored at viewport center for predictable in/out behavior
      const localX = rect.width / 2;
      const localY = rect.height / 2;
      const zoomFactor = Math.exp(-deltaY * 0.0015);
      const minScaleForViewport = Math.max(
        MIN_SCALE,
        rect.width / CANVAS_WIDTH,
        rect.height / CANVAS_HEIGHT,
      );
      const nextScale = Math.max(
        minScaleForViewport,
        Math.min(MAX_SCALE, transform.scale * zoomFactor),
      );

      const anchorWorldX = localX / transform.scale + transform.x;
      const anchorWorldY = localY / transform.scale + transform.y;
      const nextX = anchorWorldX - localX / nextScale;
      const nextY = anchorWorldY - localY / nextScale;

      transformRef.current = clampTransform(nextX, nextY, nextScale);
      hasUserViewportChangeRef.current = true;
      setZoomFromScale(transformRef.current.scale);
      scheduleViewportRender();
    },
    [
      transformRef,
      clampTransform,
      hasUserViewportChangeRef,
      setZoomFromScale,
      scheduleViewportRender,
    ],
  );

  // Attach wheel listener with { passive: false } so preventDefault() works
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handleZoomChange = useCallback(
    (nextPercent: number) => {
      const transform = transformRef.current;
      const requestedScale = nextPercent / 100;
      transformRef.current = clampTransform(
        transform.x,
        transform.y,
        requestedScale,
      );
      hasUserViewportChangeRef.current = true;
      setZoomFromScale(transformRef.current.scale);
      scheduleViewportRender();
    },
    [
      transformRef,
      clampTransform,
      hasUserViewportChangeRef,
      setZoomFromScale,
      scheduleViewportRender,
    ],
  );

  const activeCursor = isSpaceHeld
    ? isSpaceDragging
      ? 'grabbing'
      : 'grab'
    : tool === 'select'
      ? selectCursor
      : brushCursor;
  const lightTextColour = isLightHexColour(colour);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <Toolbar
        tool={tool}
        colour={colour}
        size={size}
        zoomPercent={zoomPercent}
        canUndo={canUndo}
        canRedo={canRedo}
        isMobile={isMobile}
        imagesOnTop={imagesOnTop}
        setTool={setTool}
        setColour={setColour}
        setSize={setSize}
        onZoomChange={handleZoomChange}
        handleUndo={handleUndo}
        handleRedo={handleRedo}
        handleClear={handleClear}
        onImageUpload={handleImageUpload}
        onToggleImagesOnTop={toggleImagesOnTop}
        textBold={textBold}
        textItalic={textItalic}
        fontFamily={fontFamily}
        setTextBold={setTextBold}
        setTextItalic={setTextItalic}
        setFontFamily={setFontFamily}
        preserveTextEditorFocus={!!textInputPos}
      />

      {/* Canvas container */}
      <div
        className="flex-1 min-h-0 relative overflow-hidden"
        ref={containerRef}
      >
        {showPasteTipToast && (
          <div className="pointer-events-none absolute inset-x-0 top-4 z-60 flex justify-center px-4">
            <div
              className={`pointer-events-auto w-full max-w-[min(95vw,38rem)] rounded-2xl border border-slate-300/90 bg-white/98 p-3.5 text-slate-700 shadow-[0_18px_36px_rgba(15,23,42,0.2)] backdrop-blur-sm transition-all duration-300 dark:border-slate-700/80 dark:bg-slate-900/96 dark:text-slate-100 dark:shadow-[0_18px_36px_rgba(2,6,23,0.5)] ${pasteTipVisible ? 'translate-y-0 opacity-100 scale-100' : '-translate-y-2 opacity-0 scale-95'}`}
              role="status"
              aria-live="polite"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                  <ImagePlus className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold sm:text-base">
                    Paste images directly into the whiteboard
                  </p>
                  <p className="mt-1 text-xs text-slate-600 sm:text-sm dark:text-slate-300">
                    Press{' '}
                    <kbd className="rounded-md border border-slate-300/90 bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-900 dark:border-slate-600/70 dark:bg-slate-800 dark:text-slate-100">
                      {pasteShortcutLabel}
                    </kbd>{' '}
                    anywhere while whiteboard is open.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={dismissPasteTipToast}
                  className="shrink-0 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                  aria-label="Dismiss paste tip"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full touch-none"
          style={{ cursor: activeCursor }}
          onPointerDown={pointers.handlePointerDown}
          onClick={handleCanvasClick}
          onDoubleClick={handleCanvasDoubleClick}
          onPointerMove={(e) => {
            pointers.handlePointerMove(e);
            handleMouseMoveForCursor(e);
          }}
          onPointerUp={pointers.handlePointerUp}
          onPointerCancel={pointers.handlePointerCancel}
          onPointerLeave={pointers.handlePointerLeave}
        />

        {/* Text input overlay */}
        {textInputPos && (
          <textarea
            key={textInputKey}
            ref={textInputRef}
            autoFocus
            defaultValue={textInputPos.initialValue}
            className="absolute outline-none resize-none overflow-hidden"
            style={{
              left: `${textInputPos.screenX}px`,
              top: `${textInputPos.screenY}px`,
              color: colour,
              fontSize: `${size * (zoomPercent / 100)}px`,
              fontWeight: textBold ? 'bold' : 'normal',
              fontStyle: textItalic ? 'italic' : 'normal',
              fontFamily,
              caretColor: lightTextColour ? '#ffffff' : '#111827',
              lineHeight: '1.2',
              background: 'transparent',
              border: lightTextColour
                ? '2px solid rgba(255, 255, 255, 0.85)'
                : '2px solid #3b82f6',
              borderRadius: '4px',
              padding: '2px 4px',
              minWidth: `${textInputPos.minWidthPx}px`,
              minHeight: `${textInputPos.minHeightPx}px`,
              zIndex: 50,
            }}
            onBlur={(e) => {
              const nextFocus = e.relatedTarget;
              if (
                nextFocus instanceof Element &&
                nextFocus.closest('[data-text-editor-focus-safe="true"]')
              ) {
                return;
              }
              if (!nextFocus) {
                requestAnimationFrame(() => {
                  const active = document.activeElement;
                  if (
                    active instanceof Element &&
                    active.closest('[data-text-editor-focus-safe="true"]')
                  ) {
                    return;
                  }
                  commitText();
                });
                return;
              }
              commitText();
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                closeTextInputEditor();
              } else if (
                e.key === 'Enter' &&
                (e.metaKey || e.ctrlKey) &&
                !e.shiftKey
              ) {
                e.preventDefault();
                commitText();
              }
            }}
            onInput={(e) => {
              const target = e.currentTarget;
              target.style.height = 'auto';
              target.style.height = `${target.scrollHeight}px`;
            }}
          />
        )}
      </div>
    </div>
  );
}
