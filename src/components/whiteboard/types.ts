// Drawing operation types
export type Tool =
  | 'select'
  | 'pen'
  | 'line'
  | 'rect'
  | 'circle'
  | 'eraser'
  | 'fill'
  | 'text';

export interface Point {
  x: number;
  y: number;
}

export interface PointerState {
  x: number;
  y: number;
  pointerType: string;
}

export interface DrawOp {
  id: string;
  ts: number;
  type:
    | 'path'
    | 'line'
    | 'rect'
    | 'circle'
    | 'erase'
    | 'fill'
    | 'eraseStroke'
    | 'image'
    | 'text';
  colour: string;
  size: number;
  points?: Point[];
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  eraseIds?: string[];
  imageId?: string; // Key into Y.Map('whiteboard-images')
  text?: string;
  bold?: boolean;
  italic?: boolean;
  fontFamily?: string;
  /** Rich text runs – when present, these override the flat text/bold/italic/fontFamily fields for rendering. */
  runs?: TextRun[];
}

/** A run of text with uniform formatting within a rich text op. */
export interface TextRun {
  text: string;
  colour?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  fontFamily?: string;
}

export const FONT_FAMILIES = [
  { label: 'Sans', value: 'sans-serif' },
  { label: 'Serif', value: 'serif' },
  { label: 'Mono', value: 'monospace' },
  { label: 'Cursive', value: 'cursive' },
];

export type UndoAction = 'add' | 'transform' | 'delete';

export interface UndoEntry {
  action?: UndoAction;
  op: DrawOp;
  previousOp?: DrawOp;
  imageData?: Uint8Array; // Stored for redo of image placement
  index?: number; // Optional original index for restoration (e.g., delete undo)
  // For grouped transforms (e.g., drawing + associated fills moved together)
  groupedOps?: { op: DrawOp; previousOp: DrawOp; index: number }[];
}

export const COLOURS = [
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
export const SIZES = [
  { label: 'S', value: 2 },
  { label: 'M', value: 5 },
  { label: 'L', value: 10 },
];

// Eraser sizes (world-unit pixels)
export const ERASER_SIZES = [
  { label: 'S', value: 10 },
  { label: 'M', value: 30 },
  { label: 'L', value: 60 },
];

// Text font sizes (world-unit pixels)
export const TEXT_SIZES = [
  { label: 'S', value: 24 },
  { label: 'M', value: 36 },
  { label: 'L', value: 56 },
  { label: 'XL', value: 80 },
];

// Virtual canvas size
export const CANVAS_WIDTH = 3600;
export const CANVAS_HEIGHT = 3600;

// Zoom limits
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;

// Image limits
export const MAX_IMAGES = 20;

// Resize handle positions
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
