import { io, Socket } from 'socket.io-client';
import { config } from './config';

export interface Peer {
  peerId: string;
  socketId: string;
  name: string;
  isHost: boolean;
}

export interface SignallingEvents {
  onRoomState: (data: { participants: Peer[]; isHost: boolean }) => void;
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
    this.socket.on('room-state', (data) => {
      this.events.onRoomState?.(data);
    });

    this.socket.on('peer-joined', (data) => {
      this.events.onPeerJoined?.(data);
    });

    this.socket.on('peer-left', (data) => {
      this.events.onPeerLeft?.(data);
    });

    this.socket.on('host-changed', (data) => {
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
