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
const CANVAS_WIDTH = 2000;
const CANVAS_HEIGHT = 2000;

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

// Optimized flood fill using scanline algorithm with span-based filling
// Much faster than per-pixel approach for large areas
function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillColor: string,
): void {
  const canvas = ctx.canvas;
  const width = canvas.width;
  const height = canvas.height;

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

  // Get image data
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Get target color at start position
  const startIdx = (y * width + x) * 4;
  const targetR = data[startIdx];
  const targetG = data[startIdx + 1];
  const targetB = data[startIdx + 2];
  const targetA = data[startIdx + 3];

  // Don't fill if clicking on the same color
  if (
    Math.abs(targetR - fillRGBA[0]) < 5 &&
    Math.abs(targetG - fillRGBA[1]) < 5 &&
    Math.abs(targetB - fillRGBA[2]) < 5 &&
    Math.abs(targetA - fillRGBA[3]) < 5
  ) {
    return;
  }

  // Color matching with tolerance (helps with anti-aliasing)
  const tolerance = 32;
  const matchesTarget = (idx: number): boolean => {
    return (
      Math.abs(data[idx] - targetR) <= tolerance &&
      Math.abs(data[idx + 1] - targetG) <= tolerance &&
      Math.abs(data[idx + 2] - targetB) <= tolerance &&
      Math.abs(data[idx + 3] - targetA) <= tolerance
    );
  };

  // Use Uint8Array for fast visited tracking (much faster than Set)
  const visited = new Uint8Array(width * height);

  // Scanline fill using spans
  const stack: [number, number, number, number][] = []; // [x1, x2, y, direction]

  // Find initial span
  let x1 = x;
  let x2 = x;
  while (x1 > 0 && matchesTarget((y * width + x1 - 1) * 4)) x1--;
  while (x2 < width - 1 && matchesTarget((y * width + x2 + 1) * 4)) x2++;

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

      // Skip if already visited or doesn't match
      if (visited[pixelIdx] || !matchesTarget(dataIdx)) {
        cx++;
        continue;
      }

      // Find span boundaries
      let spanX1 = cx;
      let spanX2 = cx;

      // Extend left
      while (spanX1 > 0) {
        const leftIdx = ny * width + spanX1 - 1;
        if (visited[leftIdx] || !matchesTarget(leftIdx * 4)) break;
        spanX1--;
      }

      // Extend right and fill
      while (spanX2 < width) {
        const rightIdx = ny * width + spanX2;
        if (visited[rightIdx] || !matchesTarget(rightIdx * 4)) break;

        // Fill this pixel
        visited[rightIdx] = 1;
        const di = rightIdx * 4;
        data[di] = fillRGBA[0];
        data[di + 1] = fillRGBA[1];
        data[di + 2] = fillRGBA[2];
        data[di + 3] = fillRGBA[3];

        spanX2++;
      }
      spanX2--;

      // Also mark and fill the left extension
      for (let fx = spanX1; fx < cx; fx++) {
        const fillIdx = ny * width + fx;
        visited[fillIdx] = 1;
        const di = fillIdx * 4;
        data[di] = fillRGBA[0];
        data[di + 1] = fillRGBA[1];
        data[di + 2] = fillRGBA[2];
        data[di + 3] = fillRGBA[3];
      }

      // Add spans for next rows
      stack.push([spanX1, spanX2, ny, dy]);
      // Check opposite direction if we extended beyond original span
      if (spanX1 < sx1) stack.push([spanX1, sx1 - 1, ny, -dy]);
      if (spanX2 > sx2) stack.push([sx2 + 1, spanX2, ny, -dy]);

      cx = spanX2 + 1;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

export function Whiteboard() {
  const { doc } = useSession();
  const { isDark } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Offscreen canvas for consistent world-space rendering
  // This ensures flood fill works identically on all devices
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Tool state
  const [tool, setTool] = useState<Tool>('pen');
  const [colour, setColour] = useState('#ffffff');
  const [size, setSize] = useState(5);

  // Drawing state
  const isDrawing = useRef(false);
  const currentOp = useRef<DrawOp | null>(null);
  const startPoint = useRef<Point>({ x: 0, y: 0 });
  const lastRenderTime = useRef(0);

  // Get Y.Array for drawing ops
  const opsArray = doc.getArray<DrawOp>('whiteboard');

  // Undo stack (local only for now)
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoStack = useRef<DrawOp[]>([]);
  const redoStack = useRef<DrawOp[]>([]);

  // Viewport state for pan/scroll (mobile two-finger gesture)
  const [viewportOffset, setViewportOffset] = useState<Point>({ x: 0, y: 0 });
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

  // Resize canvas to match container
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }, []);

  // Draw a single operation
  const drawOp = useCallback((ctx: CanvasRenderingContext2D, op: DrawOp) => {
    ctx.strokeStyle = op.colour;
    ctx.fillStyle = op.colour;
    ctx.lineWidth = op.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (op.type) {
      // Note: 'fill' operations are handled separately via floodFill in render()

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
  }, []);

  // Render all operations using offscreen canvas for consistent flood fill
  const render = useCallback(() => {
    const ctx = getContext();
    if (!ctx) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create or reuse offscreen canvas at fixed world size
    // This ensures flood fill works identically on all devices
    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement('canvas');
      offscreenCanvasRef.current.width = CANVAS_WIDTH;
      offscreenCanvasRef.current.height = CANVAS_HEIGHT;
    }
    const offscreen = offscreenCanvasRef.current;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    // Clear offscreen canvas with theme-appropriate background
    offCtx.fillStyle = isDark ? '#111827' : '#ffffff';
    offCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Get erased IDs from all ops
    const erasedIds = new Set<string>();
    const ops = opsArray.toArray();

    // Also consider the current operation if it is an eraser
    if (
      currentOp.current &&
      currentOp.current.type === 'erase' &&
      currentOp.current.eraseIds
    ) {
      for (const id of currentOp.current.eraseIds) {
        erasedIds.add(id);
      }
    }

    for (const op of ops) {
      if (op.type === 'erase' && op.eraseIds) {
        for (const id of op.eraseIds) {
          erasedIds.add(id);
        }
      }
    }

    // Process operations in chronological order
    // For fill operations, we apply flood fill at the stored position
    // This renders to the offscreen canvas in world coordinates
    for (const op of ops) {
      if (erasedIds.has(op.id)) continue;

      if (op.type === 'fill') {
        // Apply flood fill at the world position stored in the operation
        if (op.x1 !== undefined && op.y1 !== undefined) {
          floodFill(offCtx, op.x1, op.y1, op.colour);
        }
      } else if (op.type !== 'erase') {
        // Draw stroke operations
        drawOp(offCtx, op);
      }
    }

    // Draw current operation preview (for strokes only, fills are instant)
    if (
      currentOp.current &&
      currentOp.current.type !== 'erase' &&
      currentOp.current.type !== 'fill'
    ) {
      drawOp(offCtx, currentOp.current);
    }

    // Now copy the visible viewport portion from offscreen canvas to screen
    ctx.fillStyle = isDark ? '#111827' : '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate source rectangle (what part of the world canvas to show)
    const srcX = Math.max(0, viewportOffset.x);
    const srcY = Math.max(0, viewportOffset.y);
    const srcW = canvas.width / scale;
    const srcH = canvas.height / scale;

    // Draw the visible portion scaled to fill the screen canvas
    ctx.drawImage(
      offscreen,
      srcX,
      srcY,
      srcW,
      srcH, // Source rectangle (world coords)
      0,
      0,
      canvas.width,
      canvas.height, // Destination rectangle (screen)
    );
  }, [getContext, opsArray, drawOp, isDark, viewportOffset, scale]);

  // Use requestAnimationFrame for smooth rendering
  const scheduleRender = useCallback(() => {
    const now = performance.now();
    if (now - lastRenderTime.current > 16) {
      // ~60fps
      lastRenderTime.current = now;
      requestAnimationFrame(render);
    }
  }, [render]);

  // Handle resize - use ResizeObserver for container resizes (sidebar toggle)
  useLayoutEffect(() => {
    resizeCanvas();
    render();

    const container = containerRef.current;
    if (!container) return;

    // ResizeObserver handles both window resize and sidebar toggle
    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      render();
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [resizeCanvas, render]);

  // Subscribe to Yjs changes
  useEffect(() => {
    const observer = () => {
      scheduleRender();
    };

    opsArray.observe(observer);
    render();

    return () => {
      opsArray.unobserve(observer);
    };
  }, [opsArray, render, scheduleRender]);

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
        scheduleRender();
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

      scheduleRender();
    },
    [tool, colour, size, getPosition, scheduleRender, opsArray],
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

      scheduleRender();
    },
    [tool, getPosition, scheduleRender, opsArray],
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
    scheduleRender();
  }, [tool, opsArray, scheduleRender]);

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
