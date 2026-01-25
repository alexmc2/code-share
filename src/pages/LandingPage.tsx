import { useNavigate } from 'react-router-dom';
import { nanoid } from 'nanoid';

export function LandingPage() {
  const navigate = useNavigate();

  const handleCreateSession = () => {
    const sessionId = nanoid(10);
    navigate(`/session/${sessionId}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-bg via-panel to-panel-2 p-8">
      <div className="text-center max-w-2xl">
        <div className="mb-12">
          <h1 className="text-5xl font-bold text-text flex items-center justify-center gap-2 mb-4">
            <span className="text-primary font-mono">{'</>'}</span>
            CodeShare
          </h1>
          <p className="text-xl text-text-muted">
            Real-time collaborative coding, no account needed
          </p>
        </div>

        <button
          className="bg-linear-to-r from-primary to-primary-hover text-white py-4 px-12 text-xl font-semibold rounded-xl
                     shadow-lg shadow-primary/30
                     hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-1 transition-all
                     active:translate-y-0
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-bg"
          onClick={handleCreateSession}
        >
          Create Session
        </button>

        <p className="mt-8 text-text-muted text-sm">
          🔒 Peer-to-peer • No data stored on server • End-to-end encrypted
        </p>
      </div>
    </div>
  );
}
