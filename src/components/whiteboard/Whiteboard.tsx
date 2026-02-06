import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { useSession } from '../../lib/useSession';
import { useTheme } from '../../lib/useTheme';
import type { Tool, DrawOp } from './types';
import { SIZES, ERASER_SIZES } from './types';
import { useViewport } from './useViewport';
import { useWhiteboardCanvas } from './useWhiteboardCanvas';
import { useUndoRedo } from './useUndoRedo';
import { useDrawing } from './useDrawing';
import { usePointerHandlers } from './usePointerHandlers';
import { Toolbar } from './Toolbar';

export function Whiteboard() {
  const { doc } = useSession();
  const { isDark } = useTheme();

  // Tool state
  const [tool, setToolRaw] = useState<Tool>('pen');
  const [colour, setColour] = useState('#ffffff');
  const [size, setSize] = useState(5);

  // Wrap setTool to adjust size when switching to/from eraser
  const setTool = useCallback((newTool: Tool) => {
    setToolRaw(newTool);
    if (newTool === 'eraser') {
      setSize(ERASER_SIZES[1].value);
    } else {
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
  );

  // Undo/redo
  const undoRedo = useUndoRedo(doc, opsArray);

  // Drawing interaction
  const drawing = useDrawing(
    tool,
    colour,
    size,
    opsArray,
    viewport.transformRef,
    canvasRef,
    canvas.scheduleViewportRender,
    undoRedo.undoStack,
    undoRedo.redoStack,
    undoRedo.setCanUndo,
    undoRedo.setCanRedo,
    currentOp,
  );

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
    drawing.handleStart,
    drawing.handleMove,
    drawing.handleEnd,
    canvas.scheduleViewportRender,
  );

  // Generate custom round cursor for pen and eraser tools
  const brushCursor = useMemo(() => {
    if (tool !== 'eraser' && tool !== 'pen') return 'crosshair';

    const screenSize = Math.max(
      8,
      Math.min(128, size * viewport.transformRef.current.scale),
    );
    const halfSize = screenSize / 2;

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${screenSize}" height="${screenSize}" viewBox="0 0 ${screenSize} ${screenSize}">
        <circle cx="${halfSize}" cy="${halfSize}" r="${halfSize - 1}" fill="none" stroke="rgba(128,128,128,0.8)" stroke-width="2"/>
        <circle cx="${halfSize}" cy="${halfSize}" r="1" fill="rgba(128,128,128,0.8)"/>
      </svg>
    `.trim();

    const dataUrl = `data:image/svg+xml;base64,${btoa(svg)}`;
    return `url(${dataUrl}) ${halfSize} ${halfSize}, crosshair`;
  }, [tool, size, viewport.transformRef]);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <Toolbar
        tool={tool}
        colour={colour}
        size={size}
        canUndo={undoRedo.canUndo}
        canRedo={undoRedo.canRedo}
        isMobile={isMobile}
        setTool={setTool}
        setColour={setColour}
        setSize={setSize}
        handleUndo={undoRedo.handleUndo}
        handleRedo={undoRedo.handleRedo}
        handleClear={undoRedo.handleClear}
      />

      {/* Canvas container */}
      <div
        className="flex-1 min-h-0 relative overflow-hidden"
        ref={containerRef}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full touch-none"
          style={{ cursor: brushCursor }}
          onPointerDown={pointers.handlePointerDown}
          onPointerMove={pointers.handlePointerMove}
          onPointerUp={pointers.handlePointerUp}
          onPointerCancel={pointers.handlePointerCancel}
          onPointerLeave={pointers.handlePointerLeave}
        />
      </div>
    </div>
  );
}
