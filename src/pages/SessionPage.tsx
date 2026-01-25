import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/useSession';
import { SessionLayout } from '../components/SessionLayout';

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { joinSession, status, localName, setLocalName } = useSession();

  const [showNamePrompt, setShowNamePrompt] = useState(true);
  const [nameInput, setNameInput] = useState(localName);

  // Redirect if no session ID
  useEffect(() => {
    if (!sessionId) {
      navigate('/');
    }
  }, [sessionId, navigate]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const name = nameInput.trim() || 'Guest';
    setLocalName(name);
    setShowNamePrompt(false);
    if (sessionId) {
      joinSession(sessionId, name);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      // Could show a toast here
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (!sessionId) {
    return null;
  }

  if (showNamePrompt) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-linear-to-br from-bg via-panel to-panel-2 p-8">
        <div className="panel p-8 w-full max-w-md text-center shadow-lg">
          <h2 className="text-2xl font-semibold text-text mb-2">
            Join Session
          </h2>
          <p className="text-text-muted mb-6">
            Session:{' '}
            <code className="bg-primary/20 px-2 py-1 rounded text-primary font-mono">
              {sessionId}
            </code>
          </p>
          <form onSubmit={handleJoin} className="flex flex-col gap-4">
            <label
              htmlFor="name-input"
              className="text-left text-sm text-text-muted"
            >
              Your display name
            </label>
            <input
              id="name-input"
              type="text"
              className="input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Guest"
              autoFocus
              maxLength={30}
            />
            <button
              type="submit"
              className="bg-linear-to-r from-primary to-primary-hover text-white py-3 px-6 text-base font-semibold rounded-lg
                         hover:shadow-lg hover:shadow-primary/30 hover:-translate-y-0.5 transition-all
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
            >
              Join Session
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-bg text-text">
      <SessionLayout status={status} onCopyLink={handleCopyLink} />
    </div>
  );
}
