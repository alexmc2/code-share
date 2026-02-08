import { useState, useRef } from 'react';
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
import { ImagePlus, MousePointer2 } from 'lucide-react';
import type { Tool } from './types';
import { COLOURS, SIZES, ERASER_SIZES } from './types';

interface ToolbarProps {
  tool: Tool;
  colour: string;
  size: number;
  canUndo: boolean;
  canRedo: boolean;
  isMobile: boolean;
  setTool: (tool: Tool) => void;
  setColour: (colour: string) => void;
  setSize: (size: number) => void;
  handleUndo: () => void;
  handleRedo: () => void;
  handleClear: () => void;
  onImageUpload?: (file: File) => void;
}

const toolButtonClass = (isActive: boolean) =>
  `w-9 h-9 rounded-md flex items-center justify-center text-base transition-all
   ${
     isActive
       ? 'bg-primary border-primary text-white'
       : 'bg-panel-2 border border-border text-text hover:bg-border/50'
   }
   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`;

export function Toolbar({
  tool,
  colour,
  size,
  canUndo,
  canRedo,
  isMobile,
  setTool,
  setColour,
  setSize,
  handleUndo,
  handleRedo,
  handleClear,
  onImageUpload,
}: ToolbarProps) {
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onClear = () => {
    handleClear();
    setIsClearDialogOpen(false);
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

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-panel border-b border-border flex-wrap">
      {/* Tools */}
      <div className="flex gap-1 items-center pr-3 border-r border-border">
        <button
          className={toolButtonClass(tool === 'select')}
          onClick={() => setTool('select')}
          title="Select (move/resize images)"
        >
          <MousePointer2 className="w-4 h-4" />
        </button>
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

      {/* Image upload */}
      <div className="flex gap-1 items-center pr-3 border-r border-border">
        <button
          className={`${toolButtonClass(false)}`}
          onClick={() => fileInputRef.current?.click()}
          title="Upload Image"
        >
          <ImagePlus className="w-4 h-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
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

      {/* Colours - hidden when select tool is active */}
      {tool !== 'select' && (
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
      )}

      {/* Sizes - hidden when select tool is active */}
      {tool !== 'select' && (
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
      )}

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
