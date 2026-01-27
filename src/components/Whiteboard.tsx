import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useLayoutEffect,
  useMemo,
} from 'react';
import { useSession } from '../lib/useSession';
import { useTheme } from '../lib/useTheme';
import { nanoid } from 'nanoid';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from './ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

// Drawing operation types
type Tool = 'pen' | 'line' | 'rect' | 'circle' | 'eraser' | 'fill';

interface Point {
  x: number;
  y: number;
}

interface PointerState {
  x: number;
  y: number;
  pointerType: string;
}

interface DrawOp {
  id: string;
  ts: number;
  type: 'path' | 'line' | 'rect' | 'circle' | 'erase' | 'fill' | 'eraseStroke';
  colour: string;
  size: number;
  points?: Point[];
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  eraseIds?: string[];
}

const COLOURS = [
  '#ffffff',
  '#ef4444',
  '#f59e0b',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#000000',
];

// Brush sizes for pen/shapes
const SIZES = [
  { label: 'S', value: 2 },
  { label: 'M', value: 5 },
  { label: 'L', value: 10 },
];

// Eraser sizes (world-unit pixels)
const ERASER_SIZES = [
  { label: 'S', value: 10 },
  { label: 'M', value: 30 },
  { label: 'L', value: 60 },
];

// Virtual canvas size
const CANVAS_WIDTH = 3200;
const CANVAS_HEIGHT = 3200;

/**
 * Flood fill that keeps strokes and fills on separate layers to avoid anti-aliasing artifacts.
 */
function floodFillWithBoundary(
  fillCtx: CanvasRenderingContext2D,
  strokeImageData: ImageData,
  startX: number,
  startY: number,
  fillColor: string,
): void {
  const width = fillCtx.canvas.width;
  const height = fillCtx.canvas.height;

  // Clamp start position to canvas bounds
  const x = Math.floor(Math.max(0, Math.min(width - 1, startX)));
  const y = Math.floor(Math.max(0, Math.min(height - 1, startY)));

  // Convert fill color to RGBA
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 1;
  tempCanvas.height = 1;
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.fillStyle = fillColor;
  tempCtx.fillRect(0, 0, 1, 1);
  const fillRGBA = tempCtx.getImageData(0, 0, 1, 1).data;

  // Get fill canvas image data
  const fillImageData = fillCtx.getImageData(0, 0, width, height);
  const fillData = fillImageData.data;
  const strokeData = strokeImageData.data;

  // Check if start position has a stroke boundary
  const startStrokeIdx = (y * width + x) * 4;
  if (strokeData[startStrokeIdx + 3] > 30) {
    // Clicked on a stroke, don't fill
    return;
  }

  // Get target color at start position from fill canvas
  const startFillIdx = (y * width + x) * 4;
  const targetR = fillData[startFillIdx];
  const targetG = fillData[startFillIdx + 1];
  const targetB = fillData[startFillIdx + 2];
  const targetA = fillData[startFillIdx + 3];

  // Don't fill if clicking on the same color
  if (
    Math.abs(targetR - fillRGBA[0]) < 5 &&
    Math.abs(targetG - fillRGBA[1]) < 5 &&
    Math.abs(targetB - fillRGBA[2]) < 5 &&
    Math.abs(targetA - fillRGBA[3]) < 5
  ) {
    return;
  }

  // Tolerance for matching target color
  const tolerance = 32;

  // Match target color on fill canvas (what we're replacing)
  const matchesTarget = (idx: number): boolean => {
    return (
      Math.abs(fillData[idx] - targetR) <= tolerance &&
      Math.abs(fillData[idx + 1] - targetG) <= tolerance &&
      Math.abs(fillData[idx + 2] - targetB) <= tolerance &&
      Math.abs(fillData[idx + 3] - targetA) <= tolerance
    );
  };

  // Check if pixel is a stroke boundary (from strokeCanvas)
  const isBoundary = (pixelIdx: number): boolean => {
    const idx = pixelIdx * 4;
    // If stroke has significant alpha, it's a boundary
    return strokeData[idx + 3] > 30;
  };

  // Use Uint8Array for fast visited tracking
  const visited = new Uint8Array(width * height);

  // Scanline fill using spans
  const stack: [number, number, number, number][] = []; // [x1, x2, y, direction]

  // Check if starting point is valid
  const startPixelIdx = y * width + x;
  if (isBoundary(startPixelIdx) || !matchesTarget(startPixelIdx * 4)) {
    return;
  }

  // Find initial span
  let x1 = x;
  let x2 = x;
  while (x1 > 0) {
    const leftIdx = y * width + x1 - 1;
    if (isBoundary(leftIdx) || !matchesTarget(leftIdx * 4)) break;
    x1--;
  }
  while (x2 < width - 1) {
    const rightIdx = y * width + x2 + 1;
    if (isBoundary(rightIdx) || !matchesTarget(rightIdx * 4)) break;
    x2++;
  }

  // Fill the initial span immediately to prevent gap in the first row
  for (let fx = x1; fx <= x2; fx++) {
    const pixelIdx = y * width + fx;
    visited[pixelIdx] = 1;
    const di = pixelIdx * 4;
    fillData[di] = fillRGBA[0];
    fillData[di + 1] = fillRGBA[1];
    fillData[di + 2] = fillRGBA[2];
    fillData[di + 3] = fillRGBA[3];
  }

  stack.push([x1, x2, y, 1]); // down
  stack.push([x1, x2, y, -1]); // up

  while (stack.length > 0) {
    const [sx1, sx2, sy, dy] = stack.pop()!;
    const ny = sy + dy;

    if (ny < 0 || ny >= height) continue;

    let cx = sx1;
    while (cx <= sx2) {
      const pixelIdx = ny * width + cx;
      const dataIdx = pixelIdx * 4;

      // Skip if already visited, is a boundary, or doesn't match
      if (
        visited[pixelIdx] ||
        isBoundary(pixelIdx) ||
        !matchesTarget(dataIdx)
      ) {
        cx++;
        continue;
      }

      // Find span boundaries
      let spanX1 = cx;
      let spanX2 = cx;

      // Extend left
      while (spanX1 > 0) {
        const leftIdx = ny * width + spanX1 - 1;
        if (
          visited[leftIdx] ||
          isBoundary(leftIdx) ||
          !matchesTarget(leftIdx * 4)
        )
          break;
        spanX1--;
      }

      // Extend right and fill
      while (spanX2 < width) {
        const rightIdx = ny * width + spanX2;
        if (
          visited[rightIdx] ||
          isBoundary(rightIdx) ||
          !matchesTarget(rightIdx * 4)
        )
          break;

        // Fill this pixel
        visited[rightIdx] = 1;
        const di = rightIdx * 4;
        fillData[di] = fillRGBA[0];
        fillData[di + 1] = fillRGBA[1];
        fillData[di + 2] = fillRGBA[2];
        fillData[di + 3] = fillRGBA[3];

        spanX2++;
      }
      spanX2--;

      // Also mark and fill the left extension
      for (let fx = spanX1; fx < cx; fx++) {
        const fillIdx = ny * width + fx;
        visited[fillIdx] = 1;
        const di = fillIdx * 4;
        fillData[di] = fillRGBA[0];
        fillData[di + 1] = fillRGBA[1];
        fillData[di + 2] = fillRGBA[2];
        fillData[di + 3] = fillRGBA[3];
      }

      // Add spans for next rows
      stack.push([spanX1, spanX2, ny, dy]);
      // Check opposite direction if we extended beyond original span
      if (spanX1 < sx1) stack.push([spanX1, sx1 - 1, ny, -dy]);
      if (spanX2 > sx2) stack.push([sx2 + 1, spanX2, ny, -dy]);

      cx = spanX2 + 1;
    }
  }

  fillCtx.putImageData(fillImageData, 0, 0);
}

export function Whiteboard() {
  const { doc } = useSession();
  const { isDark } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Layered canvases:
  // 1) boundaryStroke: reference for flood fill boundaries (erased by eraser)
  // 2) visibleStroke: visible strokes (erased by eraser)
  // 3) fill: background + fills (erased by painting background color)
  // 4) world: final composite
  const worldCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const boundaryStrokeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const visibleStrokeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fillCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // CSS dimensions for DPR-aware rendering
  const canvasCssWidthRef = useRef<number>(0);
  const canvasCssHeightRef = useRef<number>(0);

  // Track if world canvas needs rebuild
  const worldNeedsRebuildRef = useRef(true);

  // Tool state
  const [tool, setTool] = useState<Tool>('pen');
  const [colour, setColour] = useState('#ffffff');
  const [size, setSize] = useState(5);

  // Drawing state
  const isDrawing = useRef(false);
  const currentOp = useRef<DrawOp | null>(null);
  const startPoint = useRef<Point>({ x: 0, y: 0 });

  // Get Y.Array for drawing ops
  const opsArray = doc.getArray<DrawOp>('whiteboard');

  // Undo stack (local only for now)
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoStack = useRef<DrawOp[]>([]);
  const redoStack = useRef<DrawOp[]>([]);

  // Viewport transform (refs for direct manipulation, bypassing React render cycle)
  const transformRef = useRef({
    x: 0,
    y: 0,
    scale: 1,
  }); // FIX: initial camera placement happens after resize using CSS size.
  const isPanning = useRef(false);
  const lastPanPoint = useRef<Point>({ x: 0, y: 0 }); // canvas-local CSS pixels
  const lastPinchDistance = useRef(0);
  const hasInitializedViewport = useRef(false);
  const lastResizeSizeRef = useRef<{ width: number; height: number } | null>(
    null,
  );
  const hasUserViewportChangeRef = useRef(false);
  const activePointersRef = useRef<Map<number, PointerState>>(new Map());
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 4;

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

  // Update size to appropriate default when switching to/from eraser
  // This ensures the size buttons (S/M/L) match the current tool's size range
  useEffect(() => {
    if (tool === 'eraser') {
      // Switch to eraser: use medium eraser size (30)
      setSize(ERASER_SIZES[1].value);
    } else {
      // Switch from eraser to another tool: use medium pen size (5)
      // Only do this if current size is an eraser size (not a pen size)
      if (
        ERASER_SIZES.some((s) => s.value === size) &&
        !SIZES.some((s) => s.value === size)
      ) {
        setSize(SIZES[1].value);
      }
    }
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate custom round cursor for pen and eraser tools
  // The cursor shows the brush size as a circle (scales with zoom)
  const brushCursor = useMemo(() => {
    // Only show round brush cursor for pen and eraser
    if (tool !== 'eraser' && tool !== 'pen') return 'crosshair';

    // Scale the cursor size based on the current zoom level
    // But clamp it to reasonable screen sizes (min 8px, max 128px)
    const screenSize = Math.max(
      8,
      Math.min(128, size * transformRef.current.scale),
    );
    const halfSize = screenSize / 2;

    // Create an SVG circle cursor
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${screenSize}" height="${screenSize}" viewBox="0 0 ${screenSize} ${screenSize}">
        <circle cx="${halfSize}" cy="${halfSize}" r="${halfSize - 1}" fill="none" stroke="rgba(128,128,128,0.8)" stroke-width="2"/>
        <circle cx="${halfSize}" cy="${halfSize}" r="1" fill="rgba(128,128,128,0.8)"/>
      </svg>
    `.trim();

    // Convert to data URL
    const dataUrl = `data:image/svg+xml;base64,${btoa(svg)}`;
    return `url(${dataUrl}) ${halfSize} ${halfSize}, crosshair`;
  }, [tool, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      // FIX: ensure pointer events can cancel native gestures on mobile.
      canvas.style.touchAction = 'none';
    }
  }, []);

  // Get canvas context
  const getContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext('2d');
  }, []);

  // Get background color based on theme
  const getBackgroundColor = useCallback(() => {
    return isDark ? '#111827' : '#ffffff';
  }, [isDark]);

  // Resize canvas to match container with proper DPR handling
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Set backing store size (physical pixels)
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);

    // Store CSS dimensions for renderViewport
    canvasCssWidthRef.current = rect.width;
    canvasCssHeightRef.current = rect.height;
  }, []);

  // Clamp viewport to world bounds using CSS pixels (not physical pixels).
  const clampTransform = useCallback((x: number, y: number, scale: number) => {
    const cssWidth = canvasCssWidthRef.current;
    const cssHeight = canvasCssHeightRef.current;

    if (cssWidth <= 0 || cssHeight <= 0) {
      return { x: 0, y: 0, scale };
    }

    const viewWorldW = cssWidth / scale;
    const viewWorldH = cssHeight / scale;
    const maxX = Math.max(0, CANVAS_WIDTH - viewWorldW);
    const maxY = Math.max(0, CANVAS_HEIGHT - viewWorldH);

    return {
      x: Math.max(0, Math.min(maxX, x)),
      y: Math.max(0, Math.min(maxY, y)),
      scale,
    };
  }, []);

  // Center viewport after initial sizing or major orientation/size changes.
  const centerViewport = useCallback(
    (scale = transformRef.current.scale) => {
      const cssWidth = canvasCssWidthRef.current;
      const cssHeight = canvasCssHeightRef.current;
      if (cssWidth <= 0 || cssHeight <= 0) return;

      const viewWorldW = cssWidth / scale;
      const viewWorldH = cssHeight / scale;
      const centeredX = (CANVAS_WIDTH - viewWorldW) / 2;
      const centeredY = (CANVAS_HEIGHT - viewWorldH) / 2;

      // Center using canvas CSS size, then clamp within world bounds.
      transformRef.current = clampTransform(centeredX, centeredY, scale);
    },
    [clampTransform],
  );

  const updateViewportForResize = useCallback(() => {
    const cssWidth = canvasCssWidthRef.current;
    const cssHeight = canvasCssHeightRef.current;
    if (cssWidth <= 0 || cssHeight <= 0) return;

    const prev = lastResizeSizeRef.current;
    const orientationChanged =
      prev !== null && prev.width > prev.height !== cssWidth > cssHeight;
    const sizeChangeLarge =
      prev !== null &&
      (Math.abs(cssWidth - prev.width) > prev.width * 0.15 ||
        Math.abs(cssHeight - prev.height) > prev.height * 0.15);

    const shouldRecenter =
      !hasInitializedViewport.current ||
      ((orientationChanged || sizeChangeLarge) &&
        !hasUserViewportChangeRef.current);

    if (shouldRecenter) {
      // Initial camera placement + sensible recenter on big resize.
      centerViewport();
    } else {
      // Keep current view but clamp using CSS size on resize.
      transformRef.current = clampTransform(
        transformRef.current.x,
        transformRef.current.y,
        transformRef.current.scale,
      );
    }

    hasInitializedViewport.current = true;
    lastResizeSizeRef.current = { width: cssWidth, height: cssHeight };
  }, [centerViewport, clampTransform]);

  // Initialize offscreen canvases
  const initOffscreenCanvases = useCallback(() => {
    if (!worldCanvasRef.current) {
      worldCanvasRef.current = document.createElement('canvas');
      worldCanvasRef.current.width = CANVAS_WIDTH;
      worldCanvasRef.current.height = CANVAS_HEIGHT;
    }
    if (!boundaryStrokeCanvasRef.current) {
      boundaryStrokeCanvasRef.current = document.createElement('canvas');
      boundaryStrokeCanvasRef.current.width = CANVAS_WIDTH;
      boundaryStrokeCanvasRef.current.height = CANVAS_HEIGHT;
    }
    if (!visibleStrokeCanvasRef.current) {
      visibleStrokeCanvasRef.current = document.createElement('canvas');
      visibleStrokeCanvasRef.current.width = CANVAS_WIDTH;
      visibleStrokeCanvasRef.current.height = CANVAS_HEIGHT;
    }
    if (!fillCanvasRef.current) {
      fillCanvasRef.current = document.createElement('canvas');
      fillCanvasRef.current.width = CANVAS_WIDTH;
      fillCanvasRef.current.height = CANVAS_HEIGHT;
    }
  }, []);

  // Draw a single stroke operation (not fill)
  const drawStrokeOp = useCallback(
    (ctx: CanvasRenderingContext2D, op: DrawOp) => {
      ctx.strokeStyle = op.colour;
      ctx.fillStyle = op.colour;
      ctx.lineWidth = op.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      switch (op.type) {
        case 'path':
          if (!op.points || op.points.length < 2) break;
          ctx.beginPath();
          ctx.moveTo(op.points[0].x, op.points[0].y);
          for (let i = 1; i < op.points.length; i++) {
            ctx.lineTo(op.points[i].x, op.points[i].y);
          }
          ctx.stroke();
          break;

        case 'line':
          if (
            op.x1 === undefined ||
            op.y1 === undefined ||
            op.x2 === undefined ||
            op.y2 === undefined
          )
            break;
          ctx.beginPath();
          ctx.moveTo(op.x1, op.y1);
          ctx.lineTo(op.x2, op.y2);
          ctx.stroke();
          break;

        case 'rect':
          if (
            op.x1 === undefined ||
            op.y1 === undefined ||
            op.x2 === undefined ||
            op.y2 === undefined
          )
            break;
          ctx.strokeRect(
            Math.min(op.x1, op.x2),
            Math.min(op.y1, op.y2),
            Math.abs(op.x2 - op.x1),
            Math.abs(op.y2 - op.y1),
          );
          break;

        case 'circle': {
          if (
            op.x1 === undefined ||
            op.y1 === undefined ||
            op.x2 === undefined ||
            op.y2 === undefined
          )
            break;
          const radius = Math.hypot(op.x2 - op.x1, op.y2 - op.y1);
          ctx.beginPath();
          ctx.arc(op.x1, op.y1, radius, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
      }
    },
    [],
  );

  // Helper to draw an eraseStroke op with destination-out compositing
  const drawEraseStrokePath = useCallback(
    (ctx: CanvasRenderingContext2D, op: DrawOp) => {
      if (!op.points || op.points.length < 1) return;

      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = op.size;
      ctx.strokeStyle = 'rgba(0,0,0,1)'; // Color doesn't matter for destination-out

      ctx.beginPath();
      ctx.moveTo(op.points[0].x, op.points[0].y);
      for (let i = 1; i < op.points.length; i++) {
        ctx.lineTo(op.points[i].x, op.points[i].y);
      }
      ctx.stroke();

      ctx.restore(); // Restores globalCompositeOperation to previous value
    },
    [],
  );

  // For fillCanvas, we paint the background color to "erase" since it's opaque.
  const drawEraseStrokeOnFill = useCallback(
    (ctx: CanvasRenderingContext2D, op: DrawOp, backgroundColor: string) => {
      if (!op.points || op.points.length < 1) return;

      ctx.save();
      ctx.globalCompositeOperation = 'source-over'; // Normal drawing
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = op.size;
      ctx.strokeStyle = backgroundColor; // Paint background color to "erase"

      ctx.beginPath();
      ctx.moveTo(op.points[0].x, op.points[0].y);
      for (let i = 1; i < op.points.length; i++) {
        ctx.lineTo(op.points[i].x, op.points[i].y);
      }
      ctx.stroke();

      ctx.restore();
    },
    [],
  );

  // Rebuilds the world canvas by replaying all operations in order.
  const rebuildWorldCanvas = useCallback(() => {
    initOffscreenCanvases();

    const worldCanvas = worldCanvasRef.current;
    const boundaryStrokeCanvas = boundaryStrokeCanvasRef.current;
    const visibleStrokeCanvas = visibleStrokeCanvasRef.current;
    const fillCanvas = fillCanvasRef.current;

    if (
      !worldCanvas ||
      !boundaryStrokeCanvas ||
      !visibleStrokeCanvas ||
      !fillCanvas
    )
      return;

    const worldCtx = worldCanvas.getContext('2d');
    const boundaryStrokeCtx = boundaryStrokeCanvas.getContext('2d');
    const visibleStrokeCtx = visibleStrokeCanvas.getContext('2d');
    const fillCtx = fillCanvas.getContext('2d');

    if (!worldCtx || !boundaryStrokeCtx || !visibleStrokeCtx || !fillCtx)
      return;

    // Clear canvases
    boundaryStrokeCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // visibleStrokeCanvas: transparent (visible strokes after erasing)
    visibleStrokeCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // fillCanvas: Use theme background color (solid base for flood fill)
    fillCtx.fillStyle = getBackgroundColor();
    fillCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Replay ops in order

    const deletedIds = new Set<string>();
    const ops = opsArray.toArray();

    for (const op of ops) {
      // Handle legacy erase ops: add eraseIds to deleted set
      if (op.type === 'erase' && op.eraseIds) {
        for (const id of op.eraseIds) {
          deletedIds.add(id);
        }
        continue;
      }

      // Skip deleted ops
      if (deletedIds.has(op.id)) continue;

      if (op.type === 'eraseStroke') {
        const bgColor = getBackgroundColor();
        drawEraseStrokePath(boundaryStrokeCtx, op);
        drawEraseStrokePath(visibleStrokeCtx, op);
        drawEraseStrokeOnFill(fillCtx, op, bgColor);
      } else if (op.type === 'fill') {
        // Read CURRENT boundaryStrokeCanvas state ensuring fill only sees strokes before it
        if (op.x1 !== undefined && op.y1 !== undefined) {
          const currentStrokeData = boundaryStrokeCtx.getImageData(
            0,
            0,
            CANVAS_WIDTH,
            CANVAS_HEIGHT,
          );
          floodFillWithBoundary(
            fillCtx,
            currentStrokeData,
            op.x1,
            op.y1,
            op.colour,
          );
        }
      } else {
        // Draw stroke to both stroke canvases
        // - boundaryStroke: visible to subsequent fills
        // - visibleStroke: visible to user
        drawStrokeOp(boundaryStrokeCtx, op);
        drawStrokeOp(visibleStrokeCtx, op);
      }
    }

    // Composite to world canvas (transparent background)
    worldCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Order: fillCanvas (bottom) -> visibleStrokeCanvas (top)
    worldCtx.drawImage(fillCanvas, 0, 0);
    worldCtx.drawImage(visibleStrokeCanvas, 0, 0);

    worldNeedsRebuildRef.current = false;
  }, [
    opsArray,
    drawStrokeOp,
    drawEraseStrokePath,
    drawEraseStrokeOnFill,
    initOffscreenCanvases,
    getBackgroundColor,
  ]);

  // Renders the viewport efficiently using physical pixels to prevent seams
  const renderViewport = useCallback(() => {
    const ctx = getContext();
    const canvas = canvasRef.current;
    const worldCanvas = worldCanvasRef.current;

    if (!ctx || !canvas || !worldCanvas) return;

    // Work in physical pixels directly (canvas.width/height are already DPR-scaled)
    const physWidth = canvas.width;
    const physHeight = canvas.height;
    const dpr = window.devicePixelRatio || 1;

    // Reset to identity transform - we work in physical pixels
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true; // Enable for smooth scaling
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Clear canvas (background already in worldCanvas)
    ctx.clearRect(0, 0, physWidth, physHeight);

    // Source coordinates in world space
    const srcX = Math.floor(Math.max(0, transformRef.current.x));
    const srcY = Math.floor(Math.max(0, transformRef.current.y));

    // Calculate how much of the world we're viewing
    const cssWidth = physWidth / dpr;
    const cssHeight = physHeight / dpr;
    const viewWorldW = cssWidth / transformRef.current.scale;
    const viewWorldH = cssHeight / transformRef.current.scale;

    // Clamp source dimensions to world canvas bounds
    const srcW = Math.min(viewWorldW, CANVAS_WIDTH - srcX);
    const srcH = Math.min(viewWorldH, CANVAS_HEIGHT - srcY);

    // Draw world canvas on top
    if (srcW > 0 && srcH > 0) {
      ctx.drawImage(
        worldCanvas,
        srcX,
        srcY,
        srcW,
        srcH, // Source: portion of world canvas
        0,
        0,
        physWidth,
        physHeight, // Destination: FULL physical canvas
      );
    }

    // Draw current operation preview
    if (
      currentOp.current &&
      currentOp.current.type !== 'erase' &&
      currentOp.current.type !== 'fill'
    ) {
      ctx.save();

      // Scale world coords to physical pixels
      const worldToPhys = dpr * transformRef.current.scale;
      ctx.scale(worldToPhys, worldToPhys);
      ctx.translate(-transformRef.current.x, -transformRef.current.y);

      if (currentOp.current.type === 'eraseStroke') {
        // Preview eraseStroke
        if (currentOp.current.points && currentOp.current.points.length > 0) {
          ctx.globalCompositeOperation = 'source-over';
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.lineWidth = currentOp.current.size;
          // Paint the background color to show erased effect
          ctx.strokeStyle = getBackgroundColor();

          ctx.beginPath();
          ctx.moveTo(
            currentOp.current.points[0].x,
            currentOp.current.points[0].y,
          );
          for (let i = 1; i < currentOp.current.points.length; i++) {
            ctx.lineTo(
              currentOp.current.points[i].x,
              currentOp.current.points[i].y,
            );
          }
          ctx.stroke();
        }
      } else {
        drawStrokeOp(ctx, currentOp.current);
      }

      ctx.restore();
    }
  }, [getContext, drawStrokeOp, getBackgroundColor]);

  // Schedule viewport render
  const rafIdRef = useRef<number | null>(null);
  const scheduleViewportRender = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(() => {
      renderViewport();
      rafIdRef.current = null;
    });
  }, [renderViewport]);

  // Rebuild world canvas on data changes
  useEffect(() => {
    worldNeedsRebuildRef.current = true;
    rebuildWorldCanvas();
    scheduleViewportRender();
  }, [opsArray, rebuildWorldCanvas, scheduleViewportRender]);

  // Re-render on theme change
  useEffect(() => {
    worldNeedsRebuildRef.current = true;
    rebuildWorldCanvas();
    scheduleViewportRender();
  }, [isDark, rebuildWorldCanvas, scheduleViewportRender]);

  // Handle resize
  useLayoutEffect(() => {
    resizeCanvas();
    updateViewportForResize();
    scheduleViewportRender();

    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      updateViewportForResize();
      scheduleViewportRender();
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [resizeCanvas, updateViewportForResize, scheduleViewportRender]);

  // Subscribe to Yjs changes
  useEffect(() => {
    const observer = () => {
      worldNeedsRebuildRef.current = true;
      rebuildWorldCanvas();
      scheduleViewportRender();
    };

    opsArray.observe(observer);

    return () => {
      opsArray.unobserve(observer);
    };
  }, [opsArray, rebuildWorldCanvas, scheduleViewportRender]);

  // Get mouse/touch position relative to canvas, accounting for viewport offset
  const getPosition = useCallback(
    (e: React.MouseEvent | React.TouchEvent | React.PointerEvent): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      let clientX: number, clientY: number;

      if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      // Convert screen coordinates to world coordinates by accounting for scale and viewport offset
      return {
        x:
          (clientX - rect.left) / transformRef.current.scale +
          transformRef.current.x,
        y:
          (clientY - rect.top) / transformRef.current.scale +
          transformRef.current.y,
      };
    },
    [],
  );

  const getActiveTouchPoints = useCallback((): PointerState[] => {
    const points: PointerState[] = [];
    activePointersRef.current.forEach((pointer) => {
      if (pointer.pointerType === 'touch') {
        points.push(pointer);
      }
    });
    return points;
  }, []);

  const getTouchCentroid = useCallback((points: PointerState[]): Point => {
    if (points.length === 0) return { x: 0, y: 0 };
    let sumX = 0;
    let sumY = 0;
    for (const p of points) {
      sumX += p.x;
      sumY += p.y;
    }
    return {
      x: sumX / points.length,
      y: sumY / points.length,
    };
  }, []);

  const getTouchDistance = useCallback((points: PointerState[]): number => {
    if (points.length < 2) return 0;
    const dx = points[1].x - points[0].x;
    const dy = points[1].y - points[0].y;
    return Math.hypot(dx, dy);
  }, []);

  // Start drawing
  const handleStart = useCallback(
    (e: React.PointerEvent) => {
      const pos = getPosition(e);
      isDrawing.current = true;
      startPoint.current = pos;

      if (tool === 'fill') {
        // Fill operation
        const fillOp: DrawOp = {
          id: nanoid(8),
          ts: Date.now(),
          type: 'fill',
          colour,
          size: 0,
          x1: pos.x,
          y1: pos.y,
        };
        opsArray.push([fillOp]);
        undoStack.current.push(fillOp);
        redoStack.current = [];
        setCanUndo(true);
        setCanRedo(false);
        isDrawing.current = false;
        // World canvas will be rebuilt by the opsArray observer
        return;
      } else if (tool === 'eraser') {
        // Brush eraser
        currentOp.current = {
          id: nanoid(8),
          ts: Date.now(),
          type: 'eraseStroke',
          colour: '',
          size,
          points: [pos],
        };
      } else if (tool === 'pen') {
        currentOp.current = {
          id: nanoid(8),
          ts: Date.now(),
          type: 'path',
          colour,
          size,
          points: [pos],
        };
      } else {
        currentOp.current = {
          id: nanoid(8),
          ts: Date.now(),
          type: tool as 'line' | 'rect' | 'circle',
          colour,
          size,
          x1: pos.x,
          y1: pos.y,
          x2: pos.x,
          y2: pos.y,
        };
      }

      scheduleViewportRender();
    },
    [tool, colour, size, getPosition, scheduleViewportRender, opsArray],
  );

  // Continue drawing
  const handleMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing.current || !currentOp.current) return;

      const pos = getPosition(e);

      if (tool === 'pen' && currentOp.current.points) {
        currentOp.current.points.push(pos);
      } else if (tool === 'eraser' && currentOp.current.points) {
        // Brush eraser
        currentOp.current.points.push(pos);
      } else {
        currentOp.current.x2 = pos.x;
        currentOp.current.y2 = pos.y;
      }

      scheduleViewportRender();
    },
    [tool, getPosition, scheduleViewportRender],
  );

  // End drawing
  const handleEnd = useCallback(() => {
    if (!isDrawing.current || !currentOp.current) return;

    isDrawing.current = false;

    // For pen or eraser, at least 2 points (duplicate first if only 1)
    if (
      (tool === 'pen' || tool === 'eraser') &&
      currentOp.current.points &&
      currentOp.current.points.length < 2
    ) {
      currentOp.current.points.push({ ...currentOp.current.points[0] });
    }

    // Always push to opsArray (eraseStroke always has points)
    opsArray.push([currentOp.current]);
    undoStack.current.push(currentOp.current);
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);

    currentOp.current = null;
    // World canvas will be rebuilt by the opsArray observer
  }, [tool, opsArray]);

  // Pointer handlers: touch = pan/zoom, mouse/pen = draw.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (e.pointerType === 'touch') {
        canvas.setPointerCapture(e.pointerId);
        activePointersRef.current.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
          pointerType: e.pointerType,
        });

        e.preventDefault();

        const touchPoints = getActiveTouchPoints();
        if (touchPoints.length >= 2) {
          // Pan/zoom
          isPanning.current = true;
          isDrawing.current = false;
          currentOp.current = null;

          const rect = canvas.getBoundingClientRect();
          const centroid = getTouchCentroid(touchPoints);
          lastPanPoint.current = {
            x: centroid.x - rect.left,
            y: centroid.y - rect.top,
          };
          lastPinchDistance.current = getTouchDistance(touchPoints);
          return;
        }

        if (!isPanning.current) {
          handleStart(e);
        }
        return;
      }

      handleStart(e);
    },
    [getActiveTouchPoints, getTouchCentroid, getTouchDistance, handleStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (e.pointerType === 'touch') {
        if (!activePointersRef.current.has(e.pointerId)) return;
        e.preventDefault();
        activePointersRef.current.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
          pointerType: e.pointerType,
        });

        const touchPoints = getActiveTouchPoints();
        if (touchPoints.length >= 2 || isPanning.current) {
          // Panning and/or pinch-zoom mode
          isPanning.current = true;

          const rect = canvas.getBoundingClientRect();
          const centroid = getTouchCentroid(touchPoints);
          const localCenter = {
            x: centroid.x - rect.left,
            y: centroid.y - rect.top,
          };

          let nextScale = transformRef.current.scale;
          let nextX = transformRef.current.x;
          let nextY = transformRef.current.y;

          if (touchPoints.length >= 2) {
            const currentDistance = getTouchDistance(touchPoints);
            if (lastPinchDistance.current > 0 && currentDistance > 0) {
              const pinchRatio = currentDistance / lastPinchDistance.current;
              const newScale = Math.max(
                MIN_SCALE,
                Math.min(MAX_SCALE, nextScale * pinchRatio),
              );

              const worldPoint = {
                x: localCenter.x / nextScale + nextX,
                y: localCenter.y / nextScale + nextY,
              };

              // Zoom top-left world origin
              nextScale = newScale;
              nextX = worldPoint.x - localCenter.x / newScale;
              nextY = worldPoint.y - localCenter.y / newScale;
            }
            lastPinchDistance.current = currentDistance;
          } else {
            lastPinchDistance.current = 0;
          }

          const deltaCx = localCenter.x - lastPanPoint.current.x;
          const deltaCy = localCenter.y - lastPanPoint.current.y;
          lastPanPoint.current = localCenter;

          // Pan world units
          nextX -= deltaCx / nextScale;
          nextY -= deltaCy / nextScale;

          // Clamp CSS size
          transformRef.current = clampTransform(nextX, nextY, nextScale);
          hasUserViewportChangeRef.current = true;

          scheduleViewportRender();
          return;
        }

        handleMove(e);
        return;
      }

      handleMove(e);
    },
    [
      clampTransform,
      getActiveTouchPoints,
      getTouchCentroid,
      getTouchDistance,
      handleMove,
      scheduleViewportRender,
    ],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (canvas && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }

      if (e.pointerType === 'touch') {
        activePointersRef.current.delete(e.pointerId);
        const touchPoints = getActiveTouchPoints();

        if (touchPoints.length === 0) {
          if (isPanning.current) {
            isPanning.current = false;
          } else {
            handleEnd();
          }
          lastPinchDistance.current = 0;
          return;
        }

        if (touchPoints.length === 1 && isPanning.current && canvas) {
          // Continue panning with remaining finger
          const rect = canvas.getBoundingClientRect();
          const centroid = getTouchCentroid(touchPoints);
          lastPanPoint.current = {
            x: centroid.x - rect.left,
            y: centroid.y - rect.top,
          };
          lastPinchDistance.current = 0;
        }
        return;
      }

      handleEnd();
    },
    [getActiveTouchPoints, getTouchCentroid, handleEnd],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      handlePointerUp(e);
    },
    [handlePointerUp],
  );

  const handlePointerLeave = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') {
        handleEnd();
      }
    },
    [handleEnd],
  );

  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);

  // Clear canvas
  const handleClear = useCallback(() => {
    doc.transact(() => {
      opsArray.delete(0, opsArray.length);
    });
    undoStack.current = [];
    redoStack.current = [];
    setCanUndo(false);
    setCanRedo(false);
    setIsClearDialogOpen(false);
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

  const toolButtonClass = (isActive: boolean) =>
    `w-9 h-9 rounded-md flex items-center justify-center text-base transition-all
     ${
       isActive
         ? 'bg-primary border-primary text-white'
         : 'bg-panel-2 border border-border text-text hover:bg-border/50'
     }
     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`;

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Toolbar */}
      <div className="flex items-center gap-4 px-4 py-2 bg-panel border-b border-border flex-wrap">
        {/* Tools */}
        <div className="flex gap-1 items-center pr-3 border-r border-border">
          <button
            className={toolButtonClass(tool === 'pen')}
            onClick={() => setTool('pen')}
            title="Pen"
          >
            ✏️
          </button>
          <button
            className={toolButtonClass(tool === 'line')}
            onClick={() => setTool('line')}
            title="Line"
          >
            ╱
          </button>
          <button
            className={toolButtonClass(tool === 'rect')}
            onClick={() => setTool('rect')}
            title="Rectangle"
          >
            ▢
          </button>
          <button
            className={toolButtonClass(tool === 'circle')}
            onClick={() => setTool('circle')}
            title="Circle"
          >
            ◯
          </button>
          <button
            className={toolButtonClass(tool === 'eraser')}
            onClick={() => setTool('eraser')}
            title="Eraser (select and delete)"
          >
            🧹
          </button>
          <button
            className={toolButtonClass(tool === 'fill')}
            onClick={() => setTool('fill')}
            title="Fill Bucket"
          >
            🪣
          </button>
        </div>

        {/* Mobile pan hint - justified to far right on first row */}
        {isMobile && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                title="Pan hint"
                className="w-7 h-7 ml-auto flex items-center justify-center rounded-full
                  bg-panel-2 border border-border text-text/80 text-base font-bold font-mono
                  hover:bg-border/50 transition-colors"
              >
                i
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="end"
              className="w-auto max-w-50 p-3 text-sm"
            >
              <p className="text-text-muted">
                Use <span className="font-semibold text-text">two fingers</span>{' '}
                to pan around the whiteboard.{' '}
                <span className="font-semibold text-text">Pinch</span> to zoom
                in/out.
              </p>
            </PopoverContent>
          </Popover>
        )}

        {/* Colours */}
        <div className="flex gap-1 items-center pr-3 border-r border-border">
          {COLOURS.map((c) => (
            <button
              key={c}
              className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110
                ${
                  colour === c
                    ? 'border-white shadow-[0_0_0_2px_var(--primary)]'
                    : 'border-transparent'
                }
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
              style={{ backgroundColor: c }}
              onClick={() => setColour(c)}
              title={c}
            />
          ))}
        </div>

        {/* Sizes - use different sizes for eraser vs other tools */}
        <div className="flex gap-1 items-center pr-3 border-r border-border">
          {(tool === 'eraser' ? ERASER_SIZES : SIZES).map((s) => (
            <button
              key={s.label}
              className={`px-2 py-1 text-xs font-semibold rounded transition-all
                ${
                  size === s.value
                    ? 'bg-primary border-primary text-white'
                    : 'bg-panel-2 border border-border text-text-muted hover:text-text hover:bg-border/50'
                }
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
              onClick={() => setSize(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2 items-center">
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            title="Undo"
            className={`flex items-center justify-center rounded transition-all
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
              disabled:opacity-40 disabled:cursor-not-allowed
              ${
                isMobile
                  ? 'w-9 h-9 text-base bg-panel-2 border border-border hover:bg-border/50'
                  : 'w-8 h-8 text-sm hover:bg-border/30'
              }`}
          >
            ↩
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            title="Redo"
            className={`flex items-center justify-center rounded transition-all
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
              disabled:opacity-40 disabled:cursor-not-allowed
              ${
                isMobile
                  ? 'w-9 h-9 text-base bg-panel-2 border border-border hover:bg-border/50'
                  : 'w-8 h-8 text-sm hover:bg-border/30'
              }`}
          >
            ↪
          </button>

          <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
            <DialogTrigger asChild>
              <button
                title="Clear All"
                className={`flex items-center justify-center rounded transition-all text-danger
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
                  hover:bg-danger/10
                  ${
                    isMobile
                      ? 'w-9 h-9 text-base bg-panel-2 border border-border'
                      : 'w-8 h-8 text-sm'
                  }`}
              >
                🗑️
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Clear Whiteboard?</DialogTitle>
                <DialogDescription>
                  Are you sure you want to clear the entire whiteboard? This
                  affects all participants and cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button variant="destructive" onClick={handleClear}>
                  Clear All
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Canvas container */}
      <div
        className="flex-1 min-h-0 relative overflow-hidden"
        ref={containerRef}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full touch-none"
          style={{ cursor: brushCursor }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerLeave}
        />
      </div>
    </div>
  );
}
