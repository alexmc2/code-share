import { useState, useEffect } from 'react';
import { useSession } from '../lib/useSession';
import { useTheme } from '../lib/useTheme';
import { type ConnectionStatus } from '../lib/session';
import { CodeEditor } from './CodeEditor';
import { Whiteboard } from './Whiteboard';
import { Participants } from './Participants';
import { Chat } from './Chat';

type Tab = 'code' | 'diagram';

interface SessionLayoutProps {
  status: ConnectionStatus;
  onCopyLink: () => void;
}

export function SessionLayout({ status, onCopyLink }: SessionLayoutProps) {
  const { participants, isHost } = useSession();
  const { theme, toggle: toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>('code');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

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

          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <span className="text-xs sm:text-sm text-text-muted hidden sm:inline">
              👥 {participants.length}
            </span>
            <button
              className="bg-panel-2 border border-border text-text px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs rounded-lg
                         hover:bg-border/50 transition-colors
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hidden sm:flex items-center gap-1"
              onClick={onCopyLink}
              title="Copy session link"
            >
              🔗 <span className="hidden lg:inline">Copy Link</span>
            </button>
            <button
              className="bg-panel-2 border border-border text-text w-7 h-7 rounded-lg flex items-center justify-center sm:hidden
                         hover:bg-border/50 transition-colors
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={onCopyLink}
              title="Copy session link"
            >
              🔗
            </button>
            <button
              className="bg-panel-2 border border-border text-text w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center
                         hover:bg-border/50 transition-colors
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={toggleTheme}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            {/* Mobile messages toggle */}
            <button
              className="bg-panel-2 border border-border text-text w-7 h-7 rounded-lg flex items-center justify-center
                         hover:bg-border/50 transition-colors
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:hidden"
              onClick={() => setMobileDrawerOpen(true)}
              title="Open messages"
            >
              💬
            </button>
            {/* Desktop sidebar toggle */}
            <button
              className="bg-panel-2 border border-border text-text w-8 h-8 rounded-lg items-center justify-center
                         hover:bg-border/50 transition-colors
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hidden md:flex lg:hidden"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            >
              {sidebarCollapsed ? '◀' : '▶'}
            </button>
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
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 overflow-hidden flex min-w-0">
          {activeTab === 'code' ? <CodeEditor /> : <Whiteboard />}
        </div>

        {/* Desktop/Tablet Sidebar - hidden on mobile */}
        <aside
          className={`hidden md:flex flex-col border-l border-border bg-panel transition-all duration-200 ease-in-out shrink-0
            ${sidebarCollapsed ? 'w-12' : 'w-64 lg:w-72'}`}
        >
          {sidebarCollapsed ? (
            <div className="flex flex-col items-center py-4">
              <button
                className="w-8 h-8 rounded-lg bg-panel-2 border border-border flex items-center justify-center
                           text-text-muted hover:text-text hover:bg-border/50 transition-colors
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => setSidebarCollapsed(false)}
                title="Expand sidebar"
              >
                ◀
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
                  ▶
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
                ✕
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
