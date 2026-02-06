// Drawing operation types
export type Tool = 'pen' | 'line' | 'rect' | 'circle' | 'eraser' | 'fill';

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

// Virtual canvas size
export const CANVAS_WIDTH = 3200;
export const CANVAS_HEIGHT = 3200;

// Zoom limits
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
