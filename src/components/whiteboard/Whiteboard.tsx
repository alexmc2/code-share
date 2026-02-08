import { useRef, useEffect, useState, useCallback } from 'react';
import { useSession } from '../../lib/useSession';
import { useTheme } from '../../lib/useTheme';
import type { Tool, DrawOp } from './types';
import { SIZES, ERASER_SIZES, MAX_IMAGES } from './types';
import { useViewport } from './useViewport';
import { useWhiteboardCanvas } from './useWhiteboardCanvas';
import { useUndoRedo } from './useUndoRedo';
import { useDrawing } from './useDrawing';
import { usePointerHandlers } from './usePointerHandlers';
import { useWhiteboardImages } from './useWhiteboardImages';
import { useImageSelect } from './useImageSelect';
import { Toolbar } from './Toolbar';

export function Whiteboard() {
  const { doc } = useSession();
  const { isDark } = useTheme();

  // Tool state
  const [tool, setToolRaw] = useState<Tool>('pen');
  const [colour, setColour] = useState('#ffffff');
  const [size, setSize] = useState(5);
  const [selectCursor, setSelectCursor] = useState('default');

  // Wrap setTool to adjust size when switching to/from eraser
  const setTool = useCallback((newTool: Tool) => {
    setToolRaw(newTool);
    if (newTool === 'select') {
      setSelectCursor('default');
    }
    if (newTool === 'eraser') {
      setSize(ERASER_SIZES[1].value);
    } else if (newTool !== 'select') {
      setSize((prev) => {
        if (
          ERASER_SIZES.some((s) => s.value === prev) &&
          !SIZES.some((s) => s.value === prev)
        ) {
          return SIZES[1].value;
        }
        return prev;
      });
    }
  }, []);

  // Get Y.Array for drawing ops
  const opsArray = doc.getArray<DrawOp>('whiteboard');

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
  const viewport = useViewport(canvasCssWidthRef, canvasCssHeightRef);

  // Canvas & rendering
  const canvas = useWhiteboardCanvas(
    isDark,
    opsArray,
    viewport.transformRef,
    currentOp,
    viewport.updateViewportForResize,
    canvasCssWidthRef,
    canvasCssHeightRef,
    canvasRef,
    containerRef,
    images.getCachedImage,
  );
  const {
    scheduleViewportRender,
    rebuildAndRender,
    setOverlayRenderer,
    setSuppressedImageOpId,
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
    viewport.transformRef,
    canvasRef,
    scheduleViewportRender,
    undoStackRef,
    redoStackRef,
    setCanUndo,
    setCanRedo,
    currentOp,
  );

  // Image select (move/resize)
  const imageSelect = useImageSelect(
    opsArray,
    images.imageMap,
    viewport.transformRef,
    canvasRef,
    scheduleViewportRender,
    setSuppressedImageOpId,
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
    deleteSelectedImage,
    deselect: deselectSelectedImage,
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
      deselectSelectedImage();
    }
  }, [tool, deselectSelectedImage]);

  useEffect(() => {
    const handleDelete = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!getSelectedOpId()) return;

      e.preventDefault();
      deleteSelectedImage();
      setSelectCursor('default');
    };

    document.addEventListener('keydown', handleDelete);
    return () => document.removeEventListener('keydown', handleDelete);
  }, [getSelectedOpId, deleteSelectedImage]);

  // Wrapped handlers that delegate to select tool or drawing tool
  const wrappedHandleStart = useCallback(
    (e: React.PointerEvent) => {
      if (tool === 'select') {
        handleSelectStart(e);
      } else {
        drawing.handleStart(e);
      }
    },
    [tool, handleSelectStart, drawing],
  );

  const wrappedHandleMove = useCallback(
    (e: React.PointerEvent) => {
      if (tool === 'select') {
        handleSelectMove(e);
      } else {
        drawing.handleMove(e);
      }
    },
    [tool, handleSelectMove, drawing],
  );

  const wrappedHandleEnd = useCallback(() => {
    if (tool === 'select') {
      handleSelectEnd();
    } else {
      drawing.handleEnd();
    }
  }, [tool, handleSelectEnd, drawing]);

  // Pointer event dispatch
  const pointers = usePointerHandlers(
    canvasRef,
    viewport.transformRef,
    viewport.isPanning,
    viewport.lastPanPoint,
    viewport.lastPinchDistance,
    viewport.hasUserViewportChangeRef,
    viewport.activePointersRef,
    viewport.clampTransform,
    viewport.getActiveTouchPoints,
    viewport.getTouchCentroid,
    viewport.getTouchDistance,
    drawing.isDrawing,
    currentOp,
    wrappedHandleStart,
    wrappedHandleMove,
    wrappedHandleEnd,
    scheduleViewportRender,
  );

  // --- Image upload handler ---
  const handleImageUpload = useCallback(
    async (source: File | Blob) => {
      if (images.imageCount() >= MAX_IMAGES) {
        alert(`Maximum of ${MAX_IMAGES} images reached.`);
        return;
      }

      try {
        const transform = viewport.transformRef.current;
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
      viewport.transformRef,
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

      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) {
            await handleImageUpload(blob);
          }
          return;
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handleImageUpload]);

  // Generate custom round cursor for pen and eraser tools
  const brushCursor = (() => {
    if (tool === 'select') return 'default';
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
    (e: React.MouseEvent) => {
      if (tool !== 'select') return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const worldPos = {
        x:
          (e.clientX - rect.left) / viewport.transformRef.current.scale +
          viewport.transformRef.current.x,
        y:
          (e.clientY - rect.top) / viewport.transformRef.current.scale +
          viewport.transformRef.current.y,
      };
      const cursor = getHoverCursor(
        worldPos,
        viewport.transformRef.current,
      );
      setSelectCursor(cursor);
    },
    [tool, viewport.transformRef, getHoverCursor],
  );

  const activeCursor = tool === 'select' ? selectCursor : brushCursor;

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <Toolbar
        tool={tool}
        colour={colour}
        size={size}
        canUndo={canUndo}
        canRedo={canRedo}
        isMobile={isMobile}
        setTool={setTool}
        setColour={setColour}
        setSize={setSize}
        handleUndo={handleUndo}
        handleRedo={handleRedo}
        handleClear={handleClear}
        onImageUpload={handleImageUpload}
      />

      {/* Canvas container */}
      <div
        className="flex-1 min-h-0 relative overflow-hidden"
        ref={containerRef}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full touch-none"
          style={{ cursor: activeCursor }}
          onPointerDown={pointers.handlePointerDown}
          onPointerMove={(e) => {
            pointers.handlePointerMove(e);
            handleMouseMoveForCursor(e);
          }}
          onPointerUp={pointers.handlePointerUp}
          onPointerCancel={pointers.handlePointerCancel}
          onPointerLeave={pointers.handlePointerLeave}
        />
      </div>
    </div>
  );
}
