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

// Drawing operation types
type Tool = 'pen' | 'line' | 'rect' | 'circle' | 'eraser';

interface Point {
  x: number;
  y: number;
}

interface DrawOp {
  id: string;
  ts: number;
  type: 'path' | 'line' | 'rect' | 'circle' | 'erase';
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

function hitTest(point: Point, op: DrawOp): boolean {
  const threshold = Math.max(5, op.size);

  if (op.type === 'path') {
    if (!op.points || op.points.length < 2) return false;
    // Check distance to any point in path (simplified hit test)
    // A better approach would be point-to-segment distance
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

export function Whiteboard() {
  const { doc } = useSession();
  const { isDark } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Render all operations
  const render = useCallback(() => {
    const ctx = getContext();
    if (!ctx) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Clear canvas with theme-appropriate background
    ctx.fillStyle = isDark ? '#111827' : '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Get erased IDs from all ops (including historical ones)
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

    // Draw all non-erased operations
    for (const op of ops) {
      if (op.type !== 'erase' && !erasedIds.has(op.id)) {
        drawOp(ctx, op);
      }
    }

    // Draw current operation preview
    if (currentOp.current && currentOp.current.type !== 'erase') {
      drawOp(ctx, currentOp.current);
    }
  }, [getContext, opsArray, drawOp, isDark]);

  // Use requestAnimationFrame for smooth rendering
  const scheduleRender = useCallback(() => {
    const now = performance.now();
    if (now - lastRenderTime.current > 16) {
      // ~60fps
      lastRenderTime.current = now;
      requestAnimationFrame(render);
    }
  }, [render]);

  // Handle resize
  useLayoutEffect(() => {
    resizeCanvas();
    render();

    const handleResize = () => {
      resizeCanvas();
      render();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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

  // Get mouse/touch position relative to canvas
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

      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    },
    [],
  );

  // Start drawing
  const handleStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const pos = getPosition(e);
      isDrawing.current = true;
      startPoint.current = pos;

      if (tool === 'eraser') {
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
    [tool, colour, size, getPosition, scheduleRender],
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

    // For pen, make sure we have at least 2 points
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
        </div>

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
          <Button
            variant="ghost"
            size="icon"
            onClick={handleUndo}
            disabled={!canUndo}
            title="Undo"
          >
            ↩
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRedo}
            disabled={!canRedo}
            title="Redo"
          >
            ↪
          </Button>

          <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-danger hover:text-danger hover:bg-danger/10"
              >
                🗑️
              </Button>
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
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
        />
      </div>
    </div>
  );
}
