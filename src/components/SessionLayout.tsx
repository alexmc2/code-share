import { useRef, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { nanoid } from 'nanoid';
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
import { GitHubIcon } from './icons/GitHubIcon';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

type Tab = 'code' | 'diagram';

// Sidebar resize constraints
const MIN_SIDEBAR_WIDTH = 280;
const MIN_MAIN_WIDTH = 450;
const MAX_SIDEBAR_RATIO = 0.7;
const DEFAULT_SIDEBAR_WIDTH = 320;
const STORAGE_KEY = 'sidebarWidth';
const ACTIVE_TAB_STORAGE_KEY = 'activeTab';

interface SessionLayoutProps {
  status: ConnectionStatus;
  onCopyLink: () => void;
}

export function SessionLayout({ status, onCopyLink }: SessionLayoutProps) {
  const { participants, isHost, connectionType, leaveSession } = useSession();
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();

  // Active tab state with sessionStorage persistence
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'code';
    const stored = sessionStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return stored === 'code' || stored === 'diagram' ? stored : 'code';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [copied, setCopied] = useState(false);
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  const [leaveSessionDialogOpen, setLeaveSessionDialogOpen] = useState(false);

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
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isMobile || sidebarCollapsed) return;
      e.preventDefault();
      isResizing.current = true;
      setIsDragging(true);
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
      setIsDragging(false);
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

  // Persist active tab to sessionStorage
  useEffect(() => {
    sessionStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  const statusConfig = {
    disconnected: { text: 'Disconnected', dotClass: 'bg-danger' },
    connecting: { text: 'Connecting...', dotClass: 'bg-warning animate-pulse' },
    connected: {
      text: 'Connected',
      dotClass: 'bg-success shadow-[0_0_6px_#22c55e]',
    },
  }[status];

  return (
    <>
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
                <span className="text-[10px] sm:text-[12px] font-semibold bg-warning px-1 sm:px-1.5 py-0.5 rounded uppercase text-black hidden md:inline">
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
              {/* New Session button */}
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setNewSessionDialogOpen(true)}
                title="Start new session"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-4 h-4"
                >
                  <path
                    d="M11 8C11 7.44772 11.4477 7 12 7C12.5523 7 13 7.44771 13 8V11H16C16.5523 11 17 11.4477 17 12C17 12.5523 16.5523 13 16 13H13V16C13 16.5523 12.5523 17 12 17C11.4477 17 11 16.5523 11 16V13H8C7.44772 13 7 12.5523 7 12C7 11.4477 7.44771 11 8 11H11V8Z"
                    fill="currentColor"
                  />
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M23 4C23 2.34315 21.6569 1 20 1H4C2.34315 1 1 2.34315 1 4V20C1 21.6569 2.34315 23 4 23H20C21.6569 23 23 21.6569 23 20V4ZM21 4C21 3.44772 20.5523 3 20 3H4C3.44772 3 3 3.44772 3 4V20C3 20.5523 3.44772 21 4 21H20C20.5523 21 21 20.5523 21 20V4Z"
                    fill="currentColor"
                  />
                </svg>
              </Button>
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
              {/* GitHub link */}
              <Button variant="outline" size="icon" className="h-8 w-8" asChild>
                <a
                  href="https://github.com/alexmc2/code-share"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View source on GitHub"
                >
                  <GitHubIcon className="h-4 w-4" />
                </a>
              </Button>
              {/* Leave Session button */}
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setLeaveSessionDialogOpen(true)}
                title="Leave session"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-4 h-4"
                >
                  <path
                    d="M8.46447 8.46447C8.07394 8.85499 8.07394 9.48816 8.46447 9.87868L10.5858 12L8.46447 14.1213C8.07394 14.5118 8.07394 15.145 8.46447 15.5355C8.85499 15.9261 9.48816 15.9261 9.87868 15.5355L12 13.4142L14.1213 15.5355C14.5118 15.9261 15.145 15.9261 15.5355 15.5355C15.9261 15.145 15.9261 14.5118 15.5355 14.1213L13.4142 12L15.5355 9.87868C15.9261 9.48816 15.9261 8.85499 15.5355 8.46447C15.145 8.07394 14.5118 8.07394 14.1213 8.46447L12 10.5858L9.87868 8.46447C9.48816 8.07394 8.85499 8.07394 8.46447 8.46447Z"
                    fill="currentColor"
                  />
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M23 4C23 2.34315 21.6569 1 20 1H4C2.34315 1 1 2.34315 1 4V20C1 21.6569 2.34315 23 4 23H20C21.6569 23 23 21.6569 23 20V4ZM21 4C21 3.44772 20.5523 3 20 3H4C3.44772 3 3 3.44772 3 4V20C3 20.5523 3.44772 21 4 21H20C20.5523 21 21 20.5523 21 20V4Z"
                    fill="currentColor"
                  />
                </svg>
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
            <div className={activeTab === 'code' ? 'flex-1 flex' : 'hidden'}>
              <CodeEditor />
            </div>
            <div className={activeTab === 'diagram' ? 'flex-1 flex' : 'hidden'}>
              <Whiteboard />
            </div>
          </div>

          {/* Desktop/Tablet Sidebar - hidden on mobile */}
          <aside
            className={`hidden md:flex flex-col border-l border-border bg-panel shrink-0 relative transition-[width] ease-in-out ${
              isDragging ? 'duration-0' : 'duration-300'
            }`}
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
                <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
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

      {/* New Session Dialog */}
      <Dialog
        open={newSessionDialogOpen}
        onOpenChange={setNewSessionDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start New Session?</DialogTitle>
            <DialogDescription>
              This will end your current session and start a new one. The room
              will remain open for other participants.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNewSessionDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setNewSessionDialogOpen(false);
                const newSessionId = nanoid(10);
                navigate(`/session/${newSessionId}`);
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave Session Dialog */}
      <Dialog
        open={leaveSessionDialogOpen}
        onOpenChange={setLeaveSessionDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave Session?</DialogTitle>
            <DialogDescription>
              Are you sure you want to leave the session?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLeaveSessionDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setLeaveSessionDialogOpen(false);
                leaveSession();
                navigate('/');
              }}
            >
              Leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
