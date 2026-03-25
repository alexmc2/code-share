import { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '../ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import {
  Bold,
  Circle,
  Eraser,
  ImagePlus,
  Info,
  Italic,
  Layers,
  Layers2,
  MousePointer2,
  PaintBucket,
  Pencil,
  Redo2,
  Slash,
  Square,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import type { Tool } from './types';
import {
  COLOURS,
  SIZES,
  ERASER_SIZES,
  TEXT_SIZES,
  FONT_FAMILIES,
} from './types';

interface ToolbarProps {
  tool: Tool;
  colour: string;
  size: number;
  zoomPercent: number;
  canUndo: boolean;
  canRedo: boolean;
  isMobile: boolean;
  imagesOnTop: boolean;
  textBold: boolean;
  textItalic: boolean;
  fontFamily: string;
  setTool: (tool: Tool) => void;
  setColour: (colour: string) => void;
  setSize: (size: number) => void;
  setTextBold: (bold: boolean) => void;
  setTextItalic: (italic: boolean) => void;
  setFontFamily: (family: string) => void;
  onZoomChange: (zoomPercent: number) => void;
  handleUndo: () => void;
  handleRedo: () => void;
  handleClear: () => void;
  onImageUpload?: (file: File) => void;
  onToggleImagesOnTop?: () => void;
  preserveTextEditorFocus?: boolean;
}

const toolButtonClass = (isActive: boolean) =>
  `h-9 w-9 rounded-xl border border-transparent flex items-center justify-center
   text-base transition-all duration-150
   ${
     isActive
       ? 'bg-panel border-border text-text shadow-sm'
       : 'text-text-muted hover:bg-panel hover:text-text'
   }
   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`;

const toolbarSectionClass =
  'flex items-center gap-1 rounded-2xl border border-border bg-panel-2 px-1.5 py-1';

const sizeButtonClass = (isActive: boolean) =>
  `h-8 rounded-lg px-2.5 text-xs font-semibold transition-all border
   ${
     isActive
       ? 'bg-panel border-border text-text shadow-sm'
       : 'border-transparent text-text-muted hover:bg-panel hover:text-text'
   }
   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`;

const actionButtonClass = (danger = false) =>
  `h-9 w-9 rounded-xl border border-transparent flex items-center justify-center
   transition-all duration-150 focus-visible:outline-none focus-visible:ring-2
   focus-visible:ring-primary disabled:opacity-40 disabled:cursor-not-allowed
   ${
     danger
       ? 'text-danger hover:bg-danger/10'
       : 'text-text-muted hover:bg-panel hover:text-text'
   }
   disabled:hover:bg-transparent`;

interface ToolbarTooltipProps {
  label: string;
  children: React.ReactNode;
  align?: 'center' | 'start' | 'end';
  side?: 'top' | 'bottom';
}

function ToolbarTooltip({
  label,
  children,
  align = 'center',
  side = 'bottom',
}: ToolbarTooltipProps) {
  const alignClass =
    align === 'start'
      ? 'left-0'
      : align === 'end'
        ? 'right-0'
        : 'left-1/2 -translate-x-1/2';
  const sideClass =
    side === 'top'
      ? 'bottom-[calc(100%+10px)] -translate-y-1 group-hover/toolbar-hint:translate-y-0 group-focus-within/toolbar-hint:translate-y-0'
      : 'top-[calc(100%+10px)] translate-y-1 group-hover/toolbar-hint:translate-y-0 group-focus-within/toolbar-hint:translate-y-0';
  const arrowClass =
    side === 'top'
      ? 'absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r border-slate-200 bg-white dark:border-slate-700/80 dark:bg-slate-900'
      : 'absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-l border-t border-slate-200 bg-white dark:border-slate-700/80 dark:bg-slate-900';

  return (
    <div className="group/toolbar-hint relative flex items-center">
      {children}
      <span
        role="tooltip"
        aria-hidden="true"
        className={`pointer-events-none absolute z-70 hidden w-max max-w-64 whitespace-normal rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-sm font-medium leading-snug text-slate-700 opacity-0 shadow-[0_4px_16px_rgba(15,23,42,0.08)] transition-all duration-150 dark:border-slate-700/80 dark:bg-slate-900 dark:text-slate-100 dark:shadow-[0_12px_22px_rgba(2,6,23,0.45)] md:block group-hover/toolbar-hint:opacity-100 group-focus-within/toolbar-hint:opacity-100 ${alignClass} ${sideClass}`}
      >
        {label}
        <span className={arrowClass} />
      </span>
    </div>
  );
}

const infoPopoverClass = 'w-60 max-w-[85vw] px-3 py-2 text-sm';

export function Toolbar({
  tool,
  colour,
  size,
  zoomPercent,
  canUndo,
  canRedo,
  isMobile,
  imagesOnTop,
  textBold,
  textItalic,
  fontFamily,
  setTool,
  setColour,
  setSize,
  setTextBold,
  setTextItalic,
  setFontFamily,
  onZoomChange,
  handleUndo,
  handleRedo,
  handleClear,
  onImageUpload,
  onToggleImagesOnTop,
  preserveTextEditorFocus = false,
}: ToolbarProps) {
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const [zoomInput, setZoomInput] = useState(`${zoomPercent}`);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onClear = () => {
    handleClear();
    setIsClearDialogOpen(false);
  };

  useEffect(() => {
    setZoomInput(`${zoomPercent}`);
  }, [zoomPercent]);

  const commitZoomInput = () => {
    const parsed = Number(zoomInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setZoomInput(`${zoomPercent}`);
      return;
    }
    onZoomChange(parsed);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onImageUpload) {
      onImageUpload(file);
    }
    // Reset so the same file can be uploaded again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleTextEditorSafeMouseDownCapture = (
    e: React.MouseEvent<HTMLElement>,
  ) => {
    if (!preserveTextEditorFocus) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('select,option,input,textarea')) return;
    // Keep textarea focus while clicking style controls so selection/caret
    // remains visually stable (no temporary blur background state).
    e.preventDefault();
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-panel border-b border-border flex-wrap">
      {/* Tools */}
      <div className={toolbarSectionClass}>
        <ToolbarTooltip label="Select (V) - move/resize objects" align="start">
          <button
            className={toolButtonClass(tool === 'select')}
            onClick={() => setTool('select')}
            aria-label="Select tool"
          >
            <MousePointer2 className="h-4 w-4" />
          </button>
        </ToolbarTooltip>
        <ToolbarTooltip label="Pen (B)">
          <button
            className={toolButtonClass(tool === 'pen')}
            onClick={() => setTool('pen')}
            aria-label="Pen tool"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </ToolbarTooltip>
        <ToolbarTooltip label="Line (S cycles shapes)">
          <button
            className={toolButtonClass(tool === 'line')}
            onClick={() => setTool('line')}
            aria-label="Line tool"
          >
            <Slash className="h-4 w-4" />
          </button>
        </ToolbarTooltip>
        <ToolbarTooltip label="Rectangle (S cycles shapes)">
          <button
            className={toolButtonClass(tool === 'rect')}
            onClick={() => setTool('rect')}
            aria-label="Rectangle tool"
          >
            <Square className="h-4 w-4" />
          </button>
        </ToolbarTooltip>
        <ToolbarTooltip label="Circle (S cycles shapes)">
          <button
            className={toolButtonClass(tool === 'circle')}
            onClick={() => setTool('circle')}
            aria-label="Circle tool"
          >
            <Circle className="h-4 w-4" />
          </button>
        </ToolbarTooltip>
        <ToolbarTooltip label="Eraser (E)">
          <button
            className={toolButtonClass(tool === 'eraser')}
            onClick={() => setTool('eraser')}
            aria-label="Eraser tool"
          >
            <Eraser className="h-4 w-4" />
          </button>
        </ToolbarTooltip>
        <ToolbarTooltip label="Fill Bucket (G)">
          <button
            className={toolButtonClass(tool === 'fill')}
            onClick={() => setTool('fill')}
            aria-label="Fill tool"
          >
            <PaintBucket className="h-4 w-4" />
          </button>
        </ToolbarTooltip>
        <ToolbarTooltip label="Text (T)">
          <button
            className={toolButtonClass(tool === 'text')}
            onClick={() => setTool('text')}
            aria-label="Text tool"
          >
            <Type className="h-4 w-4" />
          </button>
        </ToolbarTooltip>
      </div>

      {/* Image upload & layer ordering */}
      <div className={toolbarSectionClass}>
        <ToolbarTooltip label="Upload Image">
          <button
            className={`${toolButtonClass(false)}`}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload image"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
        </ToolbarTooltip>
        <ToolbarTooltip
          label={
            imagesOnTop
              ? 'Images on top (click to respect draw order)'
              : 'Respecting draw order (click for images on top)'
          }
        >
          <button
            className={toolButtonClass(imagesOnTop)}
            onClick={onToggleImagesOnTop}
            aria-label="Toggle image layering mode"
          >
            {imagesOnTop ? (
              <Layers className="h-4 w-4" />
            ) : (
              <Layers2 className="h-4 w-4" />
            )}
          </button>
        </ToolbarTooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        <ToolbarTooltip label="Current zoom">
          <div className="flex items-center gap-1 rounded-xl bg-panel px-2 py-1">
            <input
              value={zoomInput}
              onChange={(e) => setZoomInput(e.target.value)}
              onBlur={commitZoomInput}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              inputMode="numeric"
              className="w-14 px-2 py-1 rounded-md border border-transparent bg-transparent text-text text-xs font-semibold text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Zoom percent"
            />
            <span className="text-text-muted text-xs font-semibold">%</span>
          </div>
        </ToolbarTooltip>
      </div>

      {/* Mobile pan hint - justified to far right on first row */}
      {isMobile && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={`${toolButtonClass(false)} ml-auto`}
              aria-label="Pan hint"
            >
              <Info className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            align="end"
            className={infoPopoverClass}
          >
            <p className="leading-relaxed text-slate-600 dark:text-slate-200">
              Use{' '}
              <span className="font-semibold text-slate-900 dark:text-white">
                two fingers
              </span>{' '}
              to pan around the whiteboard.{' '}
              <span className="font-semibold text-slate-900 dark:text-white">
                Pinch
              </span>{' '}
              to zoom in or out.
            </p>
          </PopoverContent>
        </Popover>
      )}

      {/* Colours - hidden when select tool is active */}
      {tool !== 'select' && (
        <div
          className={toolbarSectionClass}
          data-text-editor-focus-safe="true"
          onMouseDownCapture={handleTextEditorSafeMouseDownCapture}
        >
          {COLOURS.map((c) => (
            <button
              key={c}
              className={`w-6 h-6 rounded-full border-2 transition-transform
              ${
                colour === c
                  ? 'border-panel scale-105 shadow-[0_0_0_1.5px_var(--primary)]'
                  : 'border-transparent hover:scale-110'
              }
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
              style={{ backgroundColor: c }}
              onClick={() => setColour(c)}
              aria-label={`Set color ${c}`}
            />
          ))}
        </div>
      )}

      {/* Sizes - hidden when select tool is active */}
      {tool !== 'select' && (
        <div
          className={toolbarSectionClass}
          data-text-editor-focus-safe="true"
          onMouseDownCapture={handleTextEditorSafeMouseDownCapture}
        >
          {(tool === 'eraser'
            ? ERASER_SIZES
            : tool === 'text'
              ? TEXT_SIZES
              : SIZES
          ).map((s) => (
            <button
              key={s.label}
              className={sizeButtonClass(size === s.value)}
              onClick={() => setSize(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Text formatting - bold/italic toggles + font family */}
      {tool === 'text' && (
        <div
          className={toolbarSectionClass}
          data-text-editor-focus-safe="true"
          onMouseDownCapture={handleTextEditorSafeMouseDownCapture}
        >
          <ToolbarTooltip label="Bold">
            <button
              className={toolButtonClass(textBold)}
              onClick={() => setTextBold(!textBold)}
              aria-label="Toggle bold"
              aria-pressed={textBold}
            >
              <Bold className="h-4 w-4" />
            </button>
          </ToolbarTooltip>
          <ToolbarTooltip label="Italic">
            <button
              className={toolButtonClass(textItalic)}
              onClick={() => setTextItalic(!textItalic)}
              aria-label="Toggle italic"
              aria-pressed={textItalic}
            >
              <Italic className="h-4 w-4" />
            </button>
          </ToolbarTooltip>
          <ToolbarTooltip label="Font family">
            <select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              className="h-8 rounded-lg px-2 text-xs font-semibold bg-panel border border-border text-text cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Font family"
            >
              {FONT_FAMILIES.map((f) => (
                <option
                  key={f.value}
                  value={f.value}
                  style={{ fontFamily: f.value }}
                >
                  {f.label}
                </option>
              ))}
            </select>
          </ToolbarTooltip>
        </div>
      )}

      {/* Actions */}
      <div className={toolbarSectionClass}>
        <ToolbarTooltip label="Undo (Ctrl/Cmd+Z)">
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            className={actionButtonClass()}
            aria-label="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </button>
        </ToolbarTooltip>
        <ToolbarTooltip label="Redo (Ctrl/Cmd+Shift+Z)">
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            className={actionButtonClass()}
            aria-label="Redo"
          >
            <Redo2 className="h-4 w-4" />
          </button>
        </ToolbarTooltip>

        <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
          <ToolbarTooltip label="Clear All">
            <DialogTrigger asChild>
              <button
                className={actionButtonClass(true)}
                aria-label="Clear whiteboard"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </DialogTrigger>
          </ToolbarTooltip>
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
              <Button variant="destructive" onClick={onClear}>
                Clear All
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
