import { useRef, useState, useCallback, useEffect } from 'react';
import { useSession } from '../lib/useSession';
import { useTheme } from '../lib/useTheme';
import { type ConnectionStatus } from '../lib/session';
import { CodeEditor } from './CodeEditor';
import { Whiteboard } from './Whiteboard';
import { Participants } from './Participants';
import { Chat } from './Chat';
import {
  Moon,
  Sun,
  Copy,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
} from 'lucide-react';
import { Button } from './ui/button';

type Tab = 'code' | 'diagram';

// Sidebar resize constraints
const MIN_SIDEBAR_WIDTH = 280;
const MIN_MAIN_WIDTH = 450;
const MAX_SIDEBAR_RATIO = 0.7;
const DEFAULT_SIDEBAR_WIDTH = 320;
const STORAGE_KEY = 'sidebarWidth';

interface SessionLayoutProps {
  status: ConnectionStatus;
  onCopyLink: () => void;
}

export function SessionLayout({ status, onCopyLink }: SessionLayoutProps) {
  const { participants, isHost, connectionType } = useSession();
  const { theme, toggle: toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>('code');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    onCopyLink();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [onCopyLink]);

  // Sidebar width state with localStorage persistence
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored
      ? Math.max(MIN_SIDEBAR_WIDTH, parseInt(stored, 10))
      : DEFAULT_SIDEBAR_WIDTH;
  });

  // Refs for resize handling
  const isResizing = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mainPanelRef = useRef<HTMLDivElement>(null);

  // Clamp sidebar width to valid range
  const clampWidth = useCallback((width: number) => {
    const maxWidth = Math.min(
      window.innerWidth * MAX_SIDEBAR_RATIO,
      window.innerWidth - MIN_MAIN_WIDTH,
    );
    return Math.max(MIN_SIDEBAR_WIDTH, Math.min(width, maxWidth));
  }, []);

  // Handle resize drag
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isMobile || sidebarCollapsed) return;
      e.preventDefault();
      isResizing.current = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [isMobile, sidebarCollapsed],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isResizing.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = containerRect.right - e.clientX;
      const clamped = clampWidth(newWidth);
      setSidebarWidth(clamped);
    },
    [clampWidth],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      // Persist to localStorage
      localStorage.setItem(STORAGE_KEY, String(sidebarWidth));
    },
    [sidebarWidth],
  );

  // ResizeObserver for Monaco/canvas layout updates
  useEffect(() => {
    if (!mainPanelRef.current) return;
    const observer = new ResizeObserver(() => {
      // Dispatch custom event for Monaco and Whiteboard to listen to
      window.dispatchEvent(new CustomEvent('workspace-resize'));
    });
    observer.observe(mainPanelRef.current);
    return () => observer.disconnect();
  }, []);

  // Track viewport size for responsive behavior
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      // Close mobile drawer when resizing to desktop
      if (!mobile) {
        setMobileDrawerOpen(false);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const statusConfig = {
    disconnected: { text: 'Disconnected', dotClass: 'bg-danger' },
    connecting: { text: 'Connecting...', dotClass: 'bg-warning animate-pulse' },
    connected: {
      text: 'Connected',
      dotClass: 'bg-success shadow-[0_0_6px_#22c55e]',
    },
  }[status];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top Bar */}
      <header className="bg-panel border-b border-border shrink-0">
        {/* Main header row */}
        <div className="flex items-center justify-between px-2 sm:px-4 py-2 gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <h1 className="text-base sm:text-lg font-semibold text-text flex items-center gap-1 shrink-0">
              <span className="text-primary font-mono">
                <img
                  src="/vite.svg"
                  className="w-4 h-4 sm:w-5 sm:h-5"
                  alt="Vite logo"
                />
              </span>
              <span className="hidden sm:inline">CodeShare</span>
              <span className="sm:hidden">CodeShare</span>
            </h1>
            <div className="flex items-center gap-1 sm:gap-1.5 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 rounded bg-panel-2">
              <span
                className={`w-1.5 h-1.5 rounded-full ${statusConfig.dotClass}`}
              />
              <span className="text-text-muted hidden sm:inline">
                {statusConfig.text}
              </span>
              {/* Connection type indicator */}
              {status === 'connected' && connectionType !== 'unknown' && (
                <span
                  className={`ml-1 px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-semibold uppercase ${
                    connectionType === 'p2p'
                      ? 'bg-success/20 text-success'
                      : 'bg-warning/20 text-warning'
                  }`}
                  title={
                    connectionType === 'p2p'
                      ? 'Direct peer-to-peer connection'
                      : 'Relayed via TURN server'
                  }
                >
                  {connectionType === 'p2p' ? 'P2P' : 'RELAY'}
                </span>
              )}
            </div>
            {isHost && (
              <span className="text-[10px] sm:text-[12px] font-semibold bg-warning px-1 sm:px-1.5 py-0.5 rounded uppercase text-black">
                Host
              </span>
            )}
          </div>

          {/* Desktop: Center tabs in header */}
          <div className="hidden md:flex flex-1 justify-center min-w-0">
            <div className="flex bg-panel-2 rounded-lg p-1">
              <button
                className={`px-6 py-2 text-sm font-medium rounded-md transition-all
                  ${
                    activeTab === 'code'
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-text-muted hover:text-text'
                  }
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-panel-2`}
                onClick={() => setActiveTab('code')}
              >
                Code
              </button>
              <button
                className={`px-6 py-2 text-sm font-medium rounded-md transition-all
                  ${
                    activeTab === 'diagram'
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-text-muted hover:text-text'
                  }
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-panel-2`}
                onClick={() => setActiveTab('diagram')}
              >
                Diagram
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <span className="text-xs sm:text-sm text-text-muted hidden sm:inline mr-2">
              👥 {participants.length}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 sm:w-auto sm:px-3 sm:gap-2"
              onClick={handleCopy}
              title="Copy session link"
            >
              {copied ? (
                <Check className="h-4 w-4 text-success" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              <span className="hidden lg:inline">
                {copied ? 'Copied!' : 'Copy Link'}
              </span>
            </Button>

            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={toggleTheme}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>

            {/* Mobile messages toggle */}
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 md:hidden"
              onClick={() => setMobileDrawerOpen(true)}
              title="Open messages"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>

            {/* Desktop sidebar toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hidden md:flex lg:hidden"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            >
              {sidebarCollapsed ? (
                <ChevronLeft className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Mobile: Tabs row */}
        <div className="flex md:hidden justify-center px-2 pb-2">
          <div className="flex bg-panel-2 rounded-lg p-0.5">
            <button
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all
                ${
                  activeTab === 'code'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-text-muted hover:text-text'
                }
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
              onClick={() => setActiveTab('code')}
            >
              Code
            </button>
            <button
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all
                ${
                  activeTab === 'diagram'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-text-muted hover:text-text'
                }
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
              onClick={() => setActiveTab('diagram')}
            >
              Diagram
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden min-h-0">
        {/* Main workspace panel */}
        <div
          ref={mainPanelRef}
          className="flex-1 overflow-hidden flex min-w-0"
          style={{ minWidth: isMobile ? 0 : MIN_MAIN_WIDTH }}
        >
          {activeTab === 'code' ? <CodeEditor /> : <Whiteboard />}
        </div>

        {/* Desktop/Tablet Sidebar - hidden on mobile */}
        <aside
          className="hidden md:flex flex-col border-l border-border bg-panel shrink-0 relative"
          style={{ width: sidebarCollapsed ? 48 : sidebarWidth }}
        >
          {/* Resize Handle - on left edge of sidebar */}
          {!sidebarCollapsed && (
            <div
              className="resize-handle absolute left-0 top-0 bottom-0 hidden md:block"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              style={{ transform: 'translateX(-50%)' }}
            />
          )}

          {sidebarCollapsed ? (
            <div className="flex flex-col items-center py-4">
              <button
                className="w-8 h-8 rounded-lg text-text-muted hover:text-text hover:bg-border/50 transition-colors
                           flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => setSidebarCollapsed(false)}
                title="Expand sidebar"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-text-muted mt-4 [writing-mode:vertical-lr] rotate-180">
                Messages
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-text">Messages</h2>
                <button
                  className="w-6 h-6 rounded flex items-center justify-center text-text-muted
                             hover:text-text hover:bg-panel-2 transition-colors
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => setSidebarCollapsed(true)}
                  title="Collapse sidebar"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <Participants />
              <Chat />
            </>
          )}
        </aside>
      </div>

      {/* Mobile Drawer Overlay */}
      {isMobile && mobileDrawerOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 z-40 animate-fade-in"
            onClick={() => setMobileDrawerOpen(false)}
          />
          {/* Drawer Panel */}
          <div className="fixed inset-y-0 right-0 w-[85%] max-w-sm bg-panel border-l border-border z-50 flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <h2 className="text-sm font-semibold text-text">Messages</h2>
              <button
                className="w-8 h-8 rounded-lg bg-panel-2 border border-border flex items-center justify-center
                           text-text-muted hover:text-text hover:bg-border/50 transition-colors
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => setMobileDrawerOpen(false)}
                title="Close messages"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <Participants />
              <Chat />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
