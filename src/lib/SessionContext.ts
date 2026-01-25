import { createContext } from 'react';
import * as Y from 'yjs';
import { YjsProvider } from './yjs-provider';

// Types for session state
export interface Participant {
  peerId: string;
  name: string;
  isHost: boolean;
  isConnected: boolean; // WebRTC connection status
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface SessionContextValue {
  // Session info
  sessionId: string | null;
  localPeerId: string;
  localName: string;
  isHost: boolean;

  // Participants
  participants: Participant[];

  // Connection status
  status: ConnectionStatus;

  // Yjs document and provider
  doc: Y.Doc;
  provider: YjsProvider;

  // Actions
  joinSession: (sessionId: string, name: string) => void;
  leaveSession: () => void;
  setLocalName: (name: string) => void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);
