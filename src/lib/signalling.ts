import { io, Socket } from 'socket.io-client';
import { config } from './config';
import { debugLog, setDebugState } from './debug';

export interface Peer {
  peerId: string;
  socketId: string;
  name: string;
  isHost: boolean;
  joinedAt?: number;
}

export interface RoomState {
  sessionId: string;
  hostId: string;
  participants: Peer[];
  participantCount: number;
}

export interface SignallingEvents {
  onRoomState: (data: RoomState) => void;
  onPeerJoined: (data: { peer: Peer }) => void;
  onPeerLeft: (data: { peerId: string }) => void;
  onHostChanged: (data: { peerId: string }) => void;
  onOffer: (data: {
    fromPeerId: string;
    offer: RTCSessionDescriptionInit;
  }) => void;
  onAnswer: (data: {
    fromPeerId: string;
    answer: RTCSessionDescriptionInit;
  }) => void;
  onIceCandidate: (data: {
    fromPeerId: string;
    candidate: RTCIceCandidateInit;
  }) => void;
}

export class SignallingClient {
  private socket: Socket;
  private events: Partial<SignallingEvents> = {};

  constructor() {
    this.socket = io(config.signallingUrl, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });

    this.setupListeners();
  }

  private setupListeners() {
    this.socket.on('connect', () => {
      debugLog('signalling', 'Connected, socketId:', this.socket.id);
      setDebugState({ socketId: this.socket.id });
    });

    this.socket.on('room-state', (data: RoomState) => {
      debugLog('signalling', 'room-state received:', {
        sessionId: data.sessionId,
        hostId: data.hostId,
        participantCount: data.participantCount,
        participants: data.participants.map((p) => ({
          peerId: p.peerId,
          name: p.name,
          isHost: p.isHost,
          joinedAt: p.joinedAt,
        })),
      });
      setDebugState({ lastRoomState: data });
      this.events.onRoomState?.(data);
    });

    this.socket.on('peer-joined', (data: { peer: Peer }) => {
      debugLog('signalling', 'peer-joined:', data.peer.peerId, data.peer.name);
      this.events.onPeerJoined?.(data);
    });

    this.socket.on('peer-left', (data: { peerId: string }) => {
      debugLog('signalling', 'peer-left:', data.peerId);
      this.events.onPeerLeft?.(data);
    });

    this.socket.on('host-changed', (data: { peerId: string }) => {
      debugLog('signalling', 'host-changed:', data.peerId);
      this.events.onHostChanged?.(data);
    });

    this.socket.on('offer', (data) => {
      this.events.onOffer?.(data);
    });

    this.socket.on('answer', (data) => {
      this.events.onAnswer?.(data);
    });

    this.socket.on('ice-candidate', (data) => {
      this.events.onIceCandidate?.(data);
    });
  }

  connect() {
    this.socket.connect();
  }

  disconnect() {
    this.socket.disconnect();
  }

  isConnected(): boolean {
    return this.socket.connected;
  }

  onConnect(callback: () => void) {
    this.socket.on('connect', callback);
  }

  onDisconnect(callback: () => void) {
    this.socket.on('disconnect', callback);
  }

  setEventHandlers(events: Partial<SignallingEvents>) {
    this.events = { ...this.events, ...events };
  }

  joinRoom(sessionId: string, name: string, peerId: string) {
    this.socket.emit('join-room', { sessionId, name, peerId });
  }

  leaveRoom() {
    this.socket.emit('leave-room');
  }

  sendOffer(targetPeerId: string, offer: RTCSessionDescriptionInit) {
    this.socket.emit('offer', { targetPeerId, offer });
  }

  sendAnswer(targetPeerId: string, answer: RTCSessionDescriptionInit) {
    this.socket.emit('answer', { targetPeerId, answer });
  }

  sendIceCandidate(targetPeerId: string, candidate: RTCIceCandidateInit) {
    this.socket.emit('ice-candidate', { targetPeerId, candidate });
  }
}

// Singleton instance
export const signalling = new SignallingClient();
