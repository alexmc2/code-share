import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as Y from 'yjs';
import { nanoid } from 'nanoid';
import { signalling } from './signalling';
import { webrtc } from './webrtc';
import { YjsProvider } from './yjs-provider';
import {
  SessionContext,
  type Participant,
  type ConnectionStatus,
  type SessionContextValue,
} from './SessionContext';

// Re-export types and context for convenience
export { SessionContext };
export type { Participant, ConnectionStatus, SessionContextValue };

// Generate or retrieve local peer ID
function getLocalPeerId(): string {
  let peerId = localStorage.getItem('code-share-peer-id');
  if (!peerId) {
    peerId = nanoid(12);
    localStorage.setItem('code-share-peer-id', peerId);
  }
  return peerId;
}

// Get/set display name
function getStoredName(): string {
  return localStorage.getItem('code-share-name') || 'Guest';
}

function setStoredName(name: string) {
  localStorage.setItem('code-share-name', name);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [localPeerId] = useState(() => getLocalPeerId());
  const [localName, setLocalNameState] = useState(() => getStoredName());
  const [isHost, setIsHost] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');

  // Yjs document - stable reference
  const doc = useMemo(() => new Y.Doc(), []);

  // Yjs provider - also stable reference
  const provider = useMemo(() => new YjsProvider(doc), [doc]);

  // Cleanup provider on unmount
  useEffect(() => {
    return () => {
      provider.destroy();
    };
  }, [provider]);

  // Update participant connection status when WebRTC connections change
  const updateParticipantConnection = useCallback(
    (peerId: string, connected: boolean) => {
      setParticipants((prev) =>
        prev.map((p) =>
          p.peerId === peerId ? { ...p, isConnected: connected } : p,
        ),
      );
    },
    [],
  );

  // Set local name
  const setLocalName = useCallback((name: string) => {
    setLocalNameState(name);
    setStoredName(name);
  }, []);

  // Join a session
  const joinSession = useCallback(
    (sid: string, name: string) => {
      if (sessionId) {
        // Already in a session
        return;
      }

      setSessionId(sid);
      setLocalName(name);
      setStatus('connecting');

      // Set up WebRTC manager
      webrtc.setLocalPeerId(localPeerId);
      webrtc.setConnectionChangeHandler((peerId, connected) => {
        updateParticipantConnection(peerId, connected);
      });

      // Set up signalling event handlers
      signalling.setEventHandlers({
        onRoomState: ({ participants: peers, isHost: host }) => {
          setIsHost(host);
          setParticipants(
            peers.map((p) => ({
              ...p,
              isConnected: p.peerId === localPeerId,
            })),
          );
          setStatus('connected');

          // Initiate WebRTC connections to existing peers
          for (const peer of peers) {
            if (peer.peerId !== localPeerId) {
              webrtc.createConnection(peer.peerId);
            }
          }
        },
        onPeerJoined: ({ peer }) => {
          setParticipants((prev) => {
            if (prev.some((p) => p.peerId === peer.peerId)) {
              return prev;
            }
            return [...prev, { ...peer, isConnected: false }];
          });
          // The new peer will initiate connection
        },
        onPeerLeft: ({ peerId }) => {
          setParticipants((prev) => prev.filter((p) => p.peerId !== peerId));
          webrtc.closeConnection(peerId);
        },
        onHostChanged: ({ peerId }) => {
          setIsHost(peerId === localPeerId);
          setParticipants((prev) =>
            prev.map((p) => ({ ...p, isHost: p.peerId === peerId })),
          );
        },
      });

      // Connect and join room
      signalling.onConnect(() => {
        signalling.joinRoom(sid, name, localPeerId);
        provider.connect(sid);
      });

      signalling.onDisconnect(() => {
        setStatus('disconnected');
        provider.disconnect();
      });

      signalling.connect();
    },
    [
      sessionId,
      localPeerId,
      setLocalName,
      updateParticipantConnection,
      provider,
    ],
  );

  // Leave session
  const leaveSession = useCallback(() => {
    signalling.leaveRoom();
    signalling.disconnect();
    webrtc.closeAll();
    provider.disconnect();
    setSessionId(null);
    setParticipants([]);
    setStatus('disconnected');
    setIsHost(false);
  }, [provider]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionId) {
        signalling.leaveRoom();
        signalling.disconnect();
        webrtc.closeAll();
      }
    };
  }, [sessionId]);

  const value: SessionContextValue = {
    sessionId,
    localPeerId,
    localName,
    isHost,
    participants,
    status,
    doc,
    provider,
    joinSession,
    leaveSession,
    setLocalName,
  };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
