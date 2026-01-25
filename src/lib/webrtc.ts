import { config } from './config';
import { signalling } from './signalling';
import { debugLog, debugLogData } from './debug';

export type DataChannelMessageHandler = (
  peerId: string,
  data: Uint8Array | string,
) => void;

interface PeerConnection {
  peerId: string;
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  isConnected: boolean;
  messageQueue: Uint8Array[]; // Queue for messages before channel open
  iceCandidateCount: number; // Track ICE candidates for debugging
}

export class WebRTCManager {
  private peers: Map<string, PeerConnection> = new Map();
  private onMessageHandler: DataChannelMessageHandler | null = null;
  private onConnectionChangeHandler:
    | ((peerId: string, connected: boolean) => void)
    | null = null;

  constructor() {
    // Set up signalling event handlers for WebRTC
    signalling.setEventHandlers({
      onOffer: this.handleOffer.bind(this),
      onAnswer: this.handleAnswer.bind(this),
      onIceCandidate: this.handleIceCandidate.bind(this),
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setLocalPeerId(_peerId: string) {
    // Reserved for future use (e.g., logging, debugging)
  }

  setMessageHandler(handler: DataChannelMessageHandler) {
    this.onMessageHandler = handler;
  }

  setConnectionChangeHandler(
    handler: (peerId: string, connected: boolean) => void,
  ) {
    this.onConnectionChangeHandler = handler;
  }

  // Create a new peer connection and initiate the offer
  async createConnection(remotePeerId: string): Promise<void> {
    if (this.peers.has(remotePeerId)) {
      debugLog('webrtc', 'Connection already exists:', remotePeerId);
      return;
    }

    debugLog('webrtc', 'Creating connection to:', remotePeerId);

    const connection = new RTCPeerConnection({
      iceServers: config.iceServers,
    });

    const peerConn: PeerConnection = {
      peerId: remotePeerId,
      connection,
      dataChannel: null,
      isConnected: false,
      messageQueue: [],
      iceCandidateCount: 0,
    };

    this.peers.set(remotePeerId, peerConn);
    this.setupConnectionHandlers(peerConn);

    // Create data channel (we are the offerer)
    const dataChannel = connection.createDataChannel('sync', {
      ordered: true,
    });
    peerConn.dataChannel = dataChannel;
    this.setupDataChannelHandlers(peerConn, dataChannel);

    // Create and send offer
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    signalling.sendOffer(remotePeerId, offer);
  }

  // Handle incoming offer
  private async handleOffer(data: {
    fromPeerId: string;
    offer: RTCSessionDescriptionInit;
  }) {
    const { fromPeerId, offer } = data;
    debugLog('webrtc', 'Received offer from:', fromPeerId);

    // Clean up existing connection if any
    this.closeConnection(fromPeerId);

    const connection = new RTCPeerConnection({
      iceServers: config.iceServers,
    });

    const peerConn: PeerConnection = {
      peerId: fromPeerId,
      connection,
      dataChannel: null,
      isConnected: false,
      messageQueue: [],
      iceCandidateCount: 0,
    };

    this.peers.set(fromPeerId, peerConn);
    this.setupConnectionHandlers(peerConn);

    // Wait for data channel from offerer
    connection.ondatachannel = (event) => {
      debugLog('webrtc', 'Data channel received from:', fromPeerId);
      peerConn.dataChannel = event.channel;
      this.setupDataChannelHandlers(peerConn, event.channel);
    };

    await connection.setRemoteDescription(offer);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    signalling.sendAnswer(fromPeerId, answer);
  }

  // Handle incoming answer
  private async handleAnswer(data: {
    fromPeerId: string;
    answer: RTCSessionDescriptionInit;
  }) {
    const { fromPeerId, answer } = data;
    debugLog('webrtc', 'Received answer from:', fromPeerId);

    const peerConn = this.peers.get(fromPeerId);
    if (!peerConn) {
      debugLog('webrtc', 'No connection found for:', fromPeerId);
      return;
    }

    await peerConn.connection.setRemoteDescription(answer);
  }

  // Handle incoming ICE candidate
  private async handleIceCandidate(data: {
    fromPeerId: string;
    candidate: RTCIceCandidateInit;
  }) {
    const { fromPeerId, candidate } = data;

    const peerConn = this.peers.get(fromPeerId);
    if (!peerConn) {
      debugLog('webrtc', 'No connection for ICE candidate from:', fromPeerId);
      return;
    }
    peerConn.iceCandidateCount++;

    try {
      await peerConn.connection.addIceCandidate(candidate);
    } catch (err) {
      debugLog('webrtc', 'Failed to add ICE candidate:', err);
    }
  }

  private setupConnectionHandlers(peerConn: PeerConnection) {
    const { connection, peerId } = peerConn;

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        signalling.sendIceCandidate(peerId, event.candidate.toJSON());
      }
    };

    connection.onconnectionstatechange = () => {
      debugLog(
        'webrtc',
        `Connection state ${peerId}:`,
        connection.connectionState,
      );

      const isConnected = connection.connectionState === 'connected';
      if (peerConn.isConnected !== isConnected) {
        peerConn.isConnected = isConnected;
        this.onConnectionChangeHandler?.(peerId, isConnected);
      }

      if (
        connection.connectionState === 'failed' ||
        connection.connectionState === 'disconnected'
      ) {
        debugLog('webrtc', `Connection to ${peerId} failed/disconnected`);
      }
    };

    connection.oniceconnectionstatechange = () => {
      debugLog(
        'webrtc',
        `ICE state ${peerId}:`,
        connection.iceConnectionState,
        `(${peerConn.iceCandidateCount} candidates)`,
      );
    };
  }

  private setupDataChannelHandlers(
    peerConn: PeerConnection,
    dataChannel: RTCDataChannel,
  ) {
    dataChannel.binaryType = 'arraybuffer';

    dataChannel.onopen = () => {
      debugLog('webrtc', 'Data channel OPEN with:', peerConn.peerId);
      peerConn.isConnected = true;

      // Flush any queued messages
      if (peerConn.messageQueue.length > 0) {
        debugLog(
          'webrtc',
          `Flushing ${peerConn.messageQueue.length} queued messages to:`,
          peerConn.peerId,
        );
        for (const msg of peerConn.messageQueue) {
          try {
            dataChannel.send(msg.buffer as ArrayBuffer);
          } catch (err) {
            debugLog('webrtc', 'Failed to flush queued message:', err);
          }
        }
        peerConn.messageQueue = [];
      }

      this.onConnectionChangeHandler?.(peerConn.peerId, true);
    };

    dataChannel.onclose = () => {
      debugLog('webrtc', 'Data channel CLOSED with:', peerConn.peerId);
      peerConn.isConnected = false;
      this.onConnectionChangeHandler?.(peerConn.peerId, false);
    };

    dataChannel.onmessage = (event) => {
      // Convert ArrayBuffer to Uint8Array for Yjs compatibility
      const data =
        event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : event.data;
      debugLogData(
        'webrtc',
        'received',
        peerConn.peerId,
        data.byteLength || data.length,
      );
      this.onMessageHandler?.(peerConn.peerId, data);
    };

    dataChannel.onerror = (error) => {
      debugLog('webrtc', `Data channel error with ${peerConn.peerId}:`, error);
    };
  }

  // Send data to a specific peer (queues if channel not open)
  send(peerId: string, data: Uint8Array | string): boolean {
    const peerConn = this.peers.get(peerId);
    if (!peerConn) {
      debugLog('webrtc', 'Cannot send, no connection to:', peerId);
      return false;
    }

    // Convert string to Uint8Array for consistent handling
    const binaryData =
      typeof data === 'string' ? new TextEncoder().encode(data) : data;

    // Queue if channel not ready
    if (!peerConn.dataChannel || peerConn.dataChannel.readyState !== 'open') {
      debugLog(
        'webrtc',
        `Queuing message for ${peerId}, channel state:`,
        peerConn.dataChannel?.readyState || 'no channel',
      );
      peerConn.messageQueue.push(binaryData);
      return true; // Queued successfully
    }

    try {
      peerConn.dataChannel.send(binaryData.buffer as ArrayBuffer);
      debugLogData('webrtc', 'sent', peerId, binaryData.length);
      return true;
    } catch (err) {
      debugLog('webrtc', `Failed to send to ${peerId}:`, err);
      return false;
    }
  }

  // Broadcast data to all connected peers
  broadcast(data: Uint8Array | string): void {
    const binaryData =
      typeof data === 'string' ? new TextEncoder().encode(data) : data;

    for (const [peerId, peerConn] of this.peers) {
      if (peerConn.dataChannel?.readyState === 'open') {
        try {
          peerConn.dataChannel.send(binaryData.buffer as ArrayBuffer);
        } catch (err) {
          debugLog('webrtc', `Failed to broadcast to ${peerId}:`, err);
        }
      } else {
        // Queue for peers whose channel isn't ready yet
        peerConn.messageQueue.push(binaryData);
      }
    }
  }

  // Close connection to a specific peer
  closeConnection(peerId: string) {
    const peerConn = this.peers.get(peerId);
    if (peerConn) {
      peerConn.dataChannel?.close();
      peerConn.connection.close();
      peerConn.messageQueue = []; // Clear queue
      this.peers.delete(peerId);
      debugLog('webrtc', 'Closed connection to:', peerId);
    }
  }

  // Close all connections
  closeAll() {
    for (const peerId of this.peers.keys()) {
      this.closeConnection(peerId);
    }
  }

  // Get connected peer IDs
  getConnectedPeers(): string[] {
    return Array.from(this.peers.entries())
      .filter(([, peer]) => peer.isConnected)
      .map(([peerId]) => peerId);
  }

  // Check if connected to a peer
  isConnectedTo(peerId: string): boolean {
    return this.peers.get(peerId)?.isConnected ?? false;
  }
}

// Singleton instance
export const webrtc = new WebRTCManager();
