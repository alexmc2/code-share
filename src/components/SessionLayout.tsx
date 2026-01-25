import { useState } from 'react';
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
  // Default to collapsed on small screens? No, user wants it collapsible.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const statusConfig = {
    disconnected: { text: 'Disconnected', dotClass: 'bg-danger' },
    connecting: { text: 'Connecting...', dotClass: 'bg-warning animate-pulse' },
    connected: {
      text: 'Connected',
      dotClass: 'bg-success shadow-[0_0_6px_#22c55e]',
    },
  }[status];

  return (
    <div className="flex flex-col h-full">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-panel border-b border-border gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-text flex items-center gap-1">
            <span className="text-primary font-mono">{'</>'}</span>
            CodeShare
          </h1>
          <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-panel-2">
            <span
              className={`w-1.5 h-1.5 rounded-full ${statusConfig.dotClass}`}
            />
            <span className="text-text-muted">{statusConfig.text}</span>
          </div>
          {isHost && (
            <span className="text-[12px] font-semibold bg-warning px-1.5 py-0.5 rounded uppercase text-black">
              {' '}
              Host
            </span>
          )}
        </div>

        <div className="flex-1 flex justify-center">
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

        <div className="flex items-center gap-3">
          <span className="text-sm text-text-muted">
            👥 {participants.length}
          </span>
          <button
            className="bg-panel-2 border border-border text-text px-3 py-1.5 text-xs rounded-lg
                       hover:bg-border/50 transition-colors
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={onCopyLink}
            title="Copy session link"
          >
            🔗 Copy Link
          </button>
          <button
            className="bg-panel-2 border border-border text-text w-8 h-8 rounded-lg flex items-center justify-center
                       hover:bg-border/50 transition-colors
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            className="bg-panel-2 border border-border text-text w-8 h-8 rounded-lg flex items-center justify-center
                       hover:bg-border/50 transition-colors
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            {sidebarCollapsed ? '▶' : '◀'}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Workspace - added min-w-0 to prevent flex item from overflowing */}
        <div className="flex-1 overflow-hidden flex min-w-0">
          {activeTab === 'code' ? <CodeEditor /> : <Whiteboard />}
        </div>

        {/* Sidebar */}
        <aside
          className={`flex flex-col border-l border-border bg-panel transition-all duration-200 ease-in-out shrink-0
            ${sidebarCollapsed ? 'w-12' : 'w-72'}`}
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
    </div>
  );
}
