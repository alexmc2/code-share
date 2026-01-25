import { useSession } from '../lib/useSession';

export function Participants() {
  const { participants, localPeerId } = useSession();

  return (
    <div className="px-4 py-3 border-b border-border">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-3">
        Participants
      </h3>
      <ul className="flex flex-col gap-2">
        {participants.length === 0 ? (
          <li className="text-sm text-text-muted text-center py-2">
            No participants yet
          </li>
        ) : (
          participants.map((p) => (
            <li
              key={p.peerId}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-panel-2"
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  p.isConnected
                    ? 'bg-success shadow-[0_0_6px_rgba(34,197,94,0.5)]'
                    : 'bg-text-muted'
                }`}
              />
              <span className="flex-1 text-sm text-text truncate">
                {p.name}
                {p.peerId === localPeerId && (
                  <span className="text-text-muted"> (you)</span>
                )}
              </span>
              {p.isHost && (
                <span className="text-[12px] font-semibold bg-warning px-1.5 py-0.5 rounded uppercase text-black">
                  Host
                </span>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
