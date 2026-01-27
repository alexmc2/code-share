import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useLayoutEffect,
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

interface DrawOp {
  id: string;
  ts: number;
  type: 'path' | 'line' | 'rect' | 'circle' | 'erase' | 'fill';
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

const SIZES = [
  { label: 'S', value: 2 },
  { label: 'M', value: 5 },
  { label: 'L', value: 10 },
];

// Virtual canvas size - users can pan around this area
// Larger size for better coverage, but not so large it causes memory issues
const CANVAS_WIDTH = 3200;
const CANVAS_HEIGHT = 3200;

function hitTest(point: Point, op: DrawOp): boolean {
  const threshold = Math.max(5, op.size);

  if (op.type === 'path') {
    if (!op.points || op.points.length < 2) return false;
    // Check distance to any point in path (simplified hit test)

    for (const p of op.points) {
      const dist = Math.hypot(p.x - point.x, p.y - point.y);
      if (dist < threshold) return true;
    }
    return false;
  }

  if (op.type === 'line') {
    if (
      op.x1 === undefined ||
      op.y1 === undefined ||
      op.x2 === undefined ||
      op.y2 === undefined
    )
      return false;

    // Point to line segment distance
    const A = point.x - op.x1;
    const B = point.y - op.y1;
    const C = op.x2 - op.x1;
    const D = op.y2 - op.y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;

    if (param < 0) {
      xx = op.x1;
      yy = op.y1;
    } else if (param > 1) {
      xx = op.x2;
      yy = op.y2;
    } else {
      xx = op.x1 + param * C;
      yy = op.y1 + param * D;
    }

    const dx = point.x - xx;
    const dy = point.y - yy;
    return Math.hypot(dx, dy) < threshold;
  }

  if (op.type === 'rect') {
    if (
      op.x1 === undefined ||
      op.y1 === undefined ||
      op.x2 === undefined ||
      op.y2 === undefined
    )
      return false;

    // Check if point is near the borders of the rect
    const x = Math.min(op.x1, op.x2);
    const y = Math.min(op.y1, op.y2);
    const w = Math.abs(op.x2 - op.x1);
    const h = Math.abs(op.y2 - op.y1);

    // Outer and inner bounds
    const outerLeft = x - threshold;
    const outerRight = x + w + threshold;
    const outerTop = y - threshold;
    const outerBottom = y + h + threshold;

    const innerLeft = x + threshold;
    const innerRight = x + w - threshold;
    const innerTop = y + threshold;
    const innerBottom = y + h - threshold;

    const insideOuter =
      point.x >= outerLeft &&
      point.x <= outerRight &&
      point.y >= outerTop &&
      point.y <= outerBottom;
    const insideInner =
      point.x >= innerLeft &&
      point.x <= innerRight &&
      point.y >= innerTop &&
      point.y <= innerBottom;

    return insideOuter && !insideInner;
  }

  if (op.type === 'circle') {
    if (
      op.x1 === undefined ||
      op.y1 === undefined ||
      op.x2 === undefined ||
      op.y2 === undefined
    )
      return false;

    const radius = Math.hypot(op.x2 - op.x1, op.y2 - op.y1);
    const dist = Math.hypot(point.x - op.x1, point.y - op.y1);

    return Math.abs(dist - radius) < threshold;
  }

  return false;
}

/**
 * Flood fill algorithm that reads boundaries from strokeCanvas and writes to fillCanvas.
 * This prevents anti-aliasing artifacts by keeping strokes and fills on separate layers.
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

  // CRITICAL FIX: Fill the initial span immediately
  // Without this, the initial row has a gap (the seam line bug)
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

  // ============================================
  // LAYERED OFFLINE CANVASES
  // ============================================
  // worldCanvas: Final composited result (fills + strokes)
  // strokeCanvas: Intermediate layer for strokes only
  // fillCanvas: Intermediate layer for fills only
  const worldCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokeCanvasRef = useRef<HTMLCanvasElement | null>(null);
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

  // Viewport state for pan/scroll (mobile two-finger gesture)
  // Center the initial viewport
  const [viewportOffset, setViewportOffset] = useState<Point>(() => ({
    x: (CANVAS_WIDTH - window.innerWidth) / 2,
    y: (CANVAS_HEIGHT - window.innerHeight) / 2,
  }));
  const isPanning = useRef(false);
  const lastPanPoint = useRef<Point>({ x: 0, y: 0 });
  const touchCount = useRef(0);

  // Zoom state for pinch-to-zoom (local only, not synced)
  const [scale, setScale] = useState(1);
  const lastPinchDistance = useRef(0);
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

  // Initialize offscreen canvases
  const initOffscreenCanvases = useCallback(() => {
    if (!worldCanvasRef.current) {
      worldCanvasRef.current = document.createElement('canvas');
      worldCanvasRef.current.width = CANVAS_WIDTH;
      worldCanvasRef.current.height = CANVAS_HEIGHT;
    }
    if (!strokeCanvasRef.current) {
      strokeCanvasRef.current = document.createElement('canvas');
      strokeCanvasRef.current.width = CANVAS_WIDTH;
      strokeCanvasRef.current.height = CANVAS_HEIGHT;
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

  // ============================================
  // REBUILD WORLD CANVAS
  // ============================================
  // This is the HEAVY operation - only runs when opsArray changes
  // Uses INCREMENTAL TIMELINE REPLAY to prevent "time travel" fills:
  // - Each fill operation sees only the strokes that came BEFORE it in the ops array
  // - This ensures later strokes don't retroactively change earlier fill results
  // - Y.Array order is the authoritative timeline (not timestamp-based sorting)
  const rebuildWorldCanvas = useCallback(() => {
    initOffscreenCanvases();

    const worldCanvas = worldCanvasRef.current;
    const strokeCanvas = strokeCanvasRef.current;
    const fillCanvas = fillCanvasRef.current;

    if (!worldCanvas || !strokeCanvas || !fillCanvas) return;

    const worldCtx = worldCanvas.getContext('2d');
    const strokeCtx = strokeCanvas.getContext('2d');
    const fillCtx = fillCanvas.getContext('2d');

    if (!worldCtx || !strokeCtx || !fillCtx) return;

    // ============================================
    // CLEAR CANVASES
    // ============================================
    // strokeCanvas: transparent (strokes only)
    strokeCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // fillCanvas: Use theme background color (solid base for flood fill)
    // Solid opaque background eliminates interpolation artifacts (seam lines)
    fillCtx.fillStyle = getBackgroundColor();
    fillCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // ============================================
    // INCREMENTAL TIMELINE REPLAY
    // ============================================
    // Iterate ops in Y.Array order (authoritative timeline).
    // For each op:
    // - If erase: add eraseIds to deletedIds set
    // - If stroke (and not deleted): draw to strokeCanvas immediately
    // - If fill (and not deleted): run flood fill on fillCanvas using CURRENT
    //   strokeCanvas state (only strokes drawn so far, not future strokes)

    const deletedIds = new Set<string>();
    const ops = opsArray.toArray();

    for (const op of ops) {
      // Handle erase ops: add eraseIds to deleted set
      if (op.type === 'erase' && op.eraseIds) {
        for (const id of op.eraseIds) {
          deletedIds.add(id);
        }
        continue;
      }

      // Skip deleted ops
      if (deletedIds.has(op.id)) continue;

      if (op.type === 'fill') {
        // CRITICAL: Read CURRENT strokeCanvas state (strokes drawn so far)
        // This ensures the fill only sees strokes that occurred BEFORE it
        if (op.x1 !== undefined && op.y1 !== undefined) {
          const currentStrokeData = strokeCtx.getImageData(
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
        // Draw stroke to strokeCanvas immediately
        // This stroke will be visible to subsequent fill operations
        drawStrokeOp(strokeCtx, op);
      }
    }

    // ============================================
    // COMPOSITE TO WORLD CANVAS
    // ============================================
    // Keep worldCanvas transparent - theme background is applied in renderViewport
    // This is critical for collaboration: world state is theme-independent
    worldCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Order: fillCanvas (bottom) -> strokeCanvas (top)
    // This ensures strokes render ON TOP of fills, hiding anti-aliasing artifacts
    worldCtx.drawImage(fillCanvas, 0, 0);
    worldCtx.drawImage(strokeCanvas, 0, 0);

    worldNeedsRebuildRef.current = false;
  }, [opsArray, drawStrokeOp, initOffscreenCanvases, getBackgroundColor]);

  // ============================================
  // RENDER VIEWPORT
  // ============================================
  // This is the LIGHT operation - runs on every frame, pan, zoom
  // Simply copies the pre-rendered world canvas to the screen
  // Works in PHYSICAL PIXELS directly to prevent seam line artifacts
  const renderViewport = useCallback(() => {
    const ctx = getContext();
    const canvas = canvasRef.current;
    const worldCanvas = worldCanvasRef.current;

    if (!ctx || !canvas || !worldCanvas) return;

    // Work in physical pixels directly (canvas.width/height are already DPR-scaled)
    const physWidth = canvas.width;
    const physHeight = canvas.height;
    const dpr = window.devicePixelRatio || 1;

    // ============================================
    // RESET CONTEXT STATE
    // ============================================
    // Reset to identity transform - we work in physical pixels
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true; // Enable for smooth scaling
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Clear canvas (background already in worldCanvas)
    ctx.clearRect(0, 0, physWidth, physHeight);

    // ============================================
    // CALCULATE SOURCE RECTANGLE
    // ============================================
    // Source coordinates in world space (integer to prevent subpixel sampling)
    const srcX = Math.floor(Math.max(0, viewportOffset.x));
    const srcY = Math.floor(Math.max(0, viewportOffset.y));

    // Calculate how much of the world we're viewing
    // CSS dimensions = physical / dpr, then divided by zoom scale
    const cssWidth = physWidth / dpr;
    const cssHeight = physHeight / dpr;
    const viewWorldW = cssWidth / scale;
    const viewWorldH = cssHeight / scale;

    // Clamp source dimensions to world canvas bounds
    const srcW = Math.min(viewWorldW, CANVAS_WIDTH - srcX);
    const srcH = Math.min(viewWorldH, CANVAS_HEIGHT - srcY);

    // ============================================
    // DRAW WORLD CANVAS ON TOP
    // ============================================
    // worldCanvas contains fills (white base + colors) and strokes
    // Draw it normally - the white base will show through for unfilled areas
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

    // ============================================
    // DRAW CURRENT OPERATION PREVIEW
    // ============================================
    // (for strokes only, fills are instant)
    if (
      currentOp.current &&
      currentOp.current.type !== 'erase' &&
      currentOp.current.type !== 'fill'
    ) {
      ctx.save();

      // Scale from world coords to physical pixels
      // Combined transform: world -> CSS -> physical
      const worldToPhys = dpr * scale;
      ctx.scale(worldToPhys, worldToPhys);
      ctx.translate(-viewportOffset.x, -viewportOffset.y);

      drawStrokeOp(ctx, currentOp.current);

      ctx.restore();
    }
  }, [getContext, viewportOffset, scale, drawStrokeOp]);

  // Schedule viewport render with requestAnimationFrame
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

  // ============================================
  // EFFECTS
  // ============================================

  // Effect 1: Rebuild world canvas on data changes (opsArray)
  useEffect(() => {
    worldNeedsRebuildRef.current = true;
    rebuildWorldCanvas();
    scheduleViewportRender();
  }, [opsArray, rebuildWorldCanvas, scheduleViewportRender]);

  // Effect 2: Re-render viewport on visual changes (pan/zoom) - NO heavy calculation
  useEffect(() => {
    scheduleViewportRender();
  }, [viewportOffset, scale, scheduleViewportRender]);

  // Effect 3: Re-render on theme change (need to rebuild world canvas)
  useEffect(() => {
    worldNeedsRebuildRef.current = true;
    rebuildWorldCanvas();
    scheduleViewportRender();
  }, [isDark, rebuildWorldCanvas, scheduleViewportRender]);

  // Effect 4: Handle resize - use ResizeObserver for container resizes
  useLayoutEffect(() => {
    resizeCanvas();
    scheduleViewportRender();

    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      scheduleViewportRender();
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [resizeCanvas, scheduleViewportRender]);

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
    (e: React.MouseEvent | React.TouchEvent): Point => {
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
        x: (clientX - rect.left) / scale + viewportOffset.x,
        y: (clientY - rect.top) / scale + viewportOffset.y,
      };
    },
    [viewportOffset, scale],
  );

  // Get center point of multiple touches (for pan gesture)
  const getTouchCenter = useCallback((touches: React.TouchList): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < touches.length; i++) {
      sumX += touches[i].clientX;
      sumY += touches[i].clientY;
    }
    return {
      x: sumX / touches.length,
      y: sumY / touches.length,
    };
  }, []);

  // Get distance between two touches (for pinch gesture)
  const getTouchDistance = useCallback((touches: React.TouchList): number => {
    if (touches.length < 2) return 0;
    const dx = touches[1].clientX - touches[0].clientX;
    const dy = touches[1].clientY - touches[0].clientY;
    return Math.hypot(dx, dy);
  }, []);

  // Start drawing
  const handleStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const pos = getPosition(e);
      isDrawing.current = true;
      startPoint.current = pos;

      if (tool === 'fill') {
        // Fill is an instant operation - execute immediately on click
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
        currentOp.current = {
          id: nanoid(8),
          ts: Date.now(),
          type: 'erase',
          colour: '',
          size: 0,
          eraseIds: [],
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
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing.current || !currentOp.current) return;

      const pos = getPosition(e);

      if (tool === 'pen' && currentOp.current.points) {
        currentOp.current.points.push(pos);
      } else if (tool === 'eraser') {
        // Find items intersecting with eraser
        const ops = opsArray.toArray();
        const existingErased = new Set(currentOp.current.eraseIds || []);

        for (const op of ops) {
          if (op.type !== 'erase' && !existingErased.has(op.id)) {
            if (hitTest(pos, op)) {
              if (!currentOp.current.eraseIds) currentOp.current.eraseIds = [];
              currentOp.current.eraseIds.push(op.id);
            }
          }
        }
      } else {
        currentOp.current.x2 = pos.x;
        currentOp.current.y2 = pos.y;
      }

      scheduleViewportRender();
    },
    [tool, getPosition, scheduleViewportRender, opsArray],
  );

  // End drawing
  const handleEnd = useCallback(() => {
    if (!isDrawing.current || !currentOp.current) return;

    isDrawing.current = false;

    // For pen, at least 2 points
    if (
      tool === 'pen' &&
      currentOp.current.points &&
      currentOp.current.points.length < 2
    ) {
      currentOp.current.points.push({ ...currentOp.current.points[0] });
    }

    // For eraser, or other tools, add to opsArray
    if (
      tool !== 'eraser' ||
      (currentOp.current.eraseIds && currentOp.current.eraseIds.length > 0)
    ) {
      opsArray.push([currentOp.current]);
      undoStack.current.push(currentOp.current);
      redoStack.current = [];
      setCanUndo(true);
      setCanRedo(false);
    }

    currentOp.current = null;
    // World canvas will be rebuilt by the opsArray observer
  }, [tool, opsArray]);

  // Touch-specific handlers for pan gesture (two-finger) vs drawing (one-finger)
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      touchCount.current = e.touches.length;

      if (e.touches.length >= 2) {
        // Two or more fingers: start panning/pinching
        e.preventDefault();
        isPanning.current = true;
        isDrawing.current = false;
        currentOp.current = null;
        lastPanPoint.current = getTouchCenter(e.touches);
        lastPinchDistance.current = getTouchDistance(e.touches);
      } else if (e.touches.length === 1 && !isPanning.current) {
        // Single finger: draw (only if not already panning)
        const syntheticEvent = e as React.TouchEvent;
        handleStart(syntheticEvent);
      }
    },
    [handleStart, getTouchCenter, getTouchDistance],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length >= 2 || isPanning.current) {
        // Panning and/or pinch-zoom mode
        e.preventDefault();
        isPanning.current = true;

        const center = getTouchCenter(e.touches);
        const deltaX = lastPanPoint.current.x - center.x;
        const deltaY = lastPanPoint.current.y - center.y;
        lastPanPoint.current = center;

        // Handle pinch-to-zoom when two fingers are present
        if (e.touches.length >= 2) {
          const currentDistance = getTouchDistance(e.touches);
          if (lastPinchDistance.current > 0 && currentDistance > 0) {
            const pinchRatio = currentDistance / lastPinchDistance.current;
            setScale((prevScale) => {
              const newScale = prevScale * pinchRatio;
              return Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
            });
          }
          lastPinchDistance.current = currentDistance;
        }

        // Apply panning (adjusted for current scale)
        setViewportOffset((prev) => {
          const canvas = canvasRef.current;
          const maxX = canvas
            ? Math.max(0, CANVAS_WIDTH - canvas.width / scale)
            : CANVAS_WIDTH;
          const maxY = canvas
            ? Math.max(0, CANVAS_HEIGHT - canvas.height / scale)
            : CANVAS_HEIGHT;

          return {
            x: Math.max(0, Math.min(maxX, prev.x + deltaX / scale)),
            y: Math.max(0, Math.min(maxY, prev.y + deltaY / scale)),
          };
        });
      } else if (e.touches.length === 1 && !isPanning.current) {
        // Drawing mode
        handleMove(e);
      }
    },
    [getTouchCenter, getTouchDistance, handleMove, setViewportOffset, scale],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 0) {
        // All fingers lifted
        if (isPanning.current) {
          isPanning.current = false;
        } else {
          handleEnd();
        }
        touchCount.current = 0;
        lastPinchDistance.current = 0;
      } else if (e.touches.length === 1 && isPanning.current) {
        // Went from multi-touch to single touch, stay in pan mode
        lastPanPoint.current = getTouchCenter(e.touches);
        lastPinchDistance.current = 0;
      }
    },
    [handleEnd, getTouchCenter],
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

  // Undo (local operation only - removes last op we added)
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

        {/* Sizes */}
        <div className="flex gap-1 items-center pr-3 border-r border-border">
          {SIZES.map((s) => (
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
          className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
      </div>
    </div>
  );
}
