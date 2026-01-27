import { useNavigate } from 'react-router-dom';
import { nanoid } from 'nanoid';
import { useTheme } from '../lib/useTheme';
import { Button } from '../components/ui/button';
import {
  Code2,
  Users,
  Monitor,
  MessageSquare,
  Terminal,
  Sun,
  Moon,
} from 'lucide-react';
import { GitHubIcon } from '../components/icons/GitHubIcon';

export function LandingPage() {
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();

  const handleCreateSession = () => {
    const sessionId = nanoid(10);
    navigate(`/session/${sessionId}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8 relative overflow-hidden">
      {/* Background decoration - theme aware */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-panel-2 rounded-full blur-3xl opacity-30" />
        <div className="absolute top-[40%] -right-[10%] w-[40%] h-[40%] bg-panel-2 rounded-full blur-3xl opacity-30" />
      </div>

      {/* Theme toggle and GitHub link - top right */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-20">
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>
        <Button variant="outline" size="icon" className="h-9 w-9" asChild>
          <a
            href="https://github.com/alexmc2/code-share"
            target="_blank"
            rel="noopener noreferrer"
            title="View source on GitHub"
          >
            <GitHubIcon className="h-4 w-4" />
          </a>
        </Button>
      </div>

      <div className="text-center max-w-4xl relative z-10">
        <div className="mb-12 flex flex-col items-center">
          <div className="w-20 h-20 bg-panel-2 rounded-2xl flex items-center justify-center mb-6 shadow-panel border border-border">
            <Terminal className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-6xl font-bold text-text flex items-center justify-center gap-2 mb-6 tracking-tight">
            CodeShare
          </h1>
          <p className="text-xl text-text-muted max-w-xl mx-auto leading-relaxed">
            Instant, real-time collaborative coding environment. No signup
            required, just share the link and start coding.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 text-left">
          <div className="bg-panel-2 p-6 rounded-xl border border-border backdrop-blur-sm">
            <Code2 className="w-8 h-8 text-primary mb-4" />
            <h3 className="text-lg font-semibold text-text mb-2">Editor</h3>
            <p className="text-text-muted text-sm">
              Monaco-based code editor with prettier integration.
            </p>
          </div>
          <div className="bg-panel-2 p-6 rounded-xl border border-border backdrop-blur-sm">
            <Monitor className="w-8 h-8 text-blue-500 mb-4" />
            <h3 className="text-lg font-semibold text-text mb-2">Whiteboard</h3>
            <p className="text-text-muted text-sm">
              Interactive whiteboard for diagramming and visual explanations.
            </p>
          </div>
          <div className="bg-panel-2 p-6 rounded-xl border border-border backdrop-blur-sm">
            <MessageSquare className="w-8 h-8 text-green-500 mb-4" />
            <h3 className="text-lg font-semibold text-text mb-2">Chat</h3>
            <p className="text-text-muted text-sm">
              Real-time chat communication with other participants.
            </p>
          </div>
        </div>

        <Button
          size="lg"
          className="text-lg px-8 py-6 rounded-xl shadow-sm shadow-primary/20 hover:shadow-primary/30 transition-all hover:-translate-y-0.5"
          onClick={handleCreateSession}
        >
          Create New Session
        </Button>

        <p className="mt-8 text-text-muted text-sm flex items-center justify-center gap-2">
          <Users className="w-4 h-4" />
          Peer-to-peer • End-to-end encrypted • No data stored
        </p>
      </div>
    </div>
  );
}
