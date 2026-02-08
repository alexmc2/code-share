import { config } from './config';
import { signalling } from './signalling';
import { debugLog, debugLogData } from './debug';

export type DataChannelMessageHandler = (
  peerId: string,
  data: Uint8Array | string,
) => void;

// Connection type: P2P (direct), relay (via TURN), or unknown
export type ConnectionType = 'p2p' | 'relay' | 'unknown';

// --- Chunking constants ---
// Chrome enforces ~256KB SCTP message limit; we chunk above 64KB for safety
const CHUNK_THRESHOLD = 64 * 1024; // 64 KB
// Header: 1 byte flag + 4 bytes messageId + 2 bytes chunkIndex + 2 bytes totalChunks = 9 bytes
const CHUNK_HEADER_SIZE = 9;
const CHUNK_FLAG = 0xff; // First byte marker to distinguish chunked from raw messages
const MAX_CHUNK_PAYLOAD = CHUNK_THRESHOLD - CHUNK_HEADER_SIZE;
const CHUNK_REASSEMBLY_TIMEOUT = 30_000; // 30s cleanup for incomplete sets

let nextChunkMessageId = 1;

interface ChunkAssembly {
  chunks: (Uint8Array | null)[];
  received: number;
  total: number;
  timer: ReturnType<typeof setTimeout>;
}

function encodeChunkedMessage(data: Uint8Array): Uint8Array[] {
  const totalChunks = Math.ceil(data.length / MAX_CHUNK_PAYLOAD);
  const messageId = nextChunkMessageId++;
  const result: Uint8Array[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const offset = i * MAX_CHUNK_PAYLOAD;
    const payload = data.subarray(
      offset,
      Math.min(offset + MAX_CHUNK_PAYLOAD, data.length),
    );
    const chunk = new Uint8Array(CHUNK_HEADER_SIZE + payload.length);
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    chunk[0] = CHUNK_FLAG;
    view.setUint32(1, messageId);
    view.setUint16(5, i);
    view.setUint16(7, totalChunks);
    chunk.set(payload, CHUNK_HEADER_SIZE);
    result.push(chunk);
  }

  return result;
}

interface PeerConnection {
  peerId: string;
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  isConnected: boolean;
  messageQueue: Uint8Array[]; // Queue for messages before channel open
  iceCandidateCount: number; // Track ICE candidates for debugging
  connectionType: ConnectionType; // Track if using relay or direct P2P
  chunkAssemblies: Map<number, ChunkAssembly>; // Reassembly buffers per peer
}

export class WebRTCManager {
  private peers: Map<string, PeerConnection> = new Map();
  private onMessageHandler: DataChannelMessageHandler | null = null;
  private onConnectionChangeHandlers: Array<
    (peerId: string, connected: boolean) => void
  > = [];
  private onConnectionTypeChangeHandler:
    | ((connectionType: ConnectionType) => void)
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

  addConnectionChangeHandler(
    handler: (peerId: string, connected: boolean) => void,
  ) {
    this.onConnectionChangeHandlers.push(handler);
  }

  setConnectionTypeChangeHandler(
    handler: (connectionType: ConnectionType) => void,
  ) {
    this.onConnectionTypeChangeHandler = handler;
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
      connectionType: 'unknown',
      chunkAssemblies: new Map(),
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
      connectionType: 'unknown',
      chunkAssemblies: new Map(),
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
        for (const handler of this.onConnectionChangeHandlers) {
          handler(peerId, isConnected);
        }
      }

      // Detect connection type when connected
      if (isConnected) {
        this.detectConnectionType(peerConn);
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

      // Flush any queued messages (with chunking support)
      if (peerConn.messageQueue.length > 0) {
        debugLog(
          'webrtc',
          `Flushing ${peerConn.messageQueue.length} queued messages to:`,
          peerConn.peerId,
        );
        for (const msg of peerConn.messageQueue) {
          try {
            this.sendBuffer(peerConn, msg);
          } catch (err) {
            debugLog('webrtc', 'Failed to flush queued message:', err);
          }
        }
        peerConn.messageQueue = [];
      }

      for (const handler of this.onConnectionChangeHandlers) {
        handler(peerConn.peerId, true);
      }
    };

    dataChannel.onclose = () => {
      debugLog('webrtc', 'Data channel CLOSED with:', peerConn.peerId);
      peerConn.isConnected = false;
      for (const handler of this.onConnectionChangeHandlers) {
        handler(peerConn.peerId, false);
      }
    };

    dataChannel.onmessage = (event) => {
      // Convert ArrayBuffer to Uint8Array for Yjs compatibility
      const data =
        event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : event.data;

      // Check if this is a chunked message
      if (
        data instanceof Uint8Array &&
        data.length > 0 &&
        data[0] === CHUNK_FLAG &&
        data.length >= CHUNK_HEADER_SIZE
      ) {
        this.handleChunkedMessage(peerConn, data);
        return;
      }

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

  // Send a single Uint8Array buffer over a data channel, chunking if needed
  private sendBuffer(peerConn: PeerConnection, binaryData: Uint8Array): void {
    const channel = peerConn.dataChannel;
    if (!channel || channel.readyState !== 'open') return;

    if (binaryData.length <= CHUNK_THRESHOLD) {
      channel.send(binaryData.buffer as ArrayBuffer);
    } else {
      // Chunk the message
      const chunks = encodeChunkedMessage(binaryData);
      debugLog(
        'webrtc',
        `Chunking ${binaryData.length} bytes into ${chunks.length} chunks for:`,
        peerConn.peerId,
      );
      for (const chunk of chunks) {
        channel.send(chunk.buffer as ArrayBuffer);
      }
    }
  }

  // Reassemble chunked messages received from a peer
  private handleChunkedMessage(
    peerConn: PeerConnection,
    data: Uint8Array,
  ): void {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const messageId = view.getUint32(1);
    const chunkIndex = view.getUint16(5);
    const totalChunks = view.getUint16(7);
    const payload = data.subarray(CHUNK_HEADER_SIZE);

    let assembly = peerConn.chunkAssemblies.get(messageId);
    if (!assembly) {
      assembly = {
        chunks: new Array(totalChunks).fill(null),
        received: 0,
        total: totalChunks,
        timer: setTimeout(() => {
          debugLog(
            'webrtc',
            `Chunk assembly timeout for message ${messageId} from ${peerConn.peerId}`,
          );
          peerConn.chunkAssemblies.delete(messageId);
        }, CHUNK_REASSEMBLY_TIMEOUT),
      };
      peerConn.chunkAssemblies.set(messageId, assembly);
    }

    if (!assembly.chunks[chunkIndex]) {
      assembly.chunks[chunkIndex] = payload;
      assembly.received++;
    }

    if (assembly.received === assembly.total) {
      clearTimeout(assembly.timer);
      peerConn.chunkAssemblies.delete(messageId);

      // Concatenate all chunks
      let totalLength = 0;
      for (const chunk of assembly.chunks) totalLength += chunk!.length;
      const fullMessage = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of assembly.chunks) {
        fullMessage.set(chunk!, offset);
        offset += chunk!.length;
      }

      debugLogData('webrtc', 'received', peerConn.peerId, fullMessage.length);
      this.onMessageHandler?.(peerConn.peerId, fullMessage);
    }
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
      this.sendBuffer(peerConn, binaryData);
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
          this.sendBuffer(peerConn, binaryData);
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
      // Clean up chunk reassembly timers
      for (const assembly of peerConn.chunkAssemblies.values()) {
        clearTimeout(assembly.timer);
      }
      peerConn.chunkAssemblies.clear();
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

  // Detect connection type by checking the selected ICE candidate pair
  private detectConnectionType(peerConn: PeerConnection) {
    const { connection, peerId } = peerConn;

    // Use getStats to find the selected candidate pair
    connection
      .getStats()
      .then((stats) => {
        let connectionType: ConnectionType = 'unknown';

        stats.forEach((report) => {
          if (
            report.type === 'candidate-pair' &&
            report.state === 'succeeded'
          ) {
            // Found the active candidate pair, now check the candidates
            const localCandidateId = report.localCandidateId;
            const remoteCandidateId = report.remoteCandidateId;

            let localType = '';
            let remoteType = '';

            stats.forEach((candidateReport) => {
              if (candidateReport.id === localCandidateId) {
                localType = candidateReport.candidateType || '';
              }
              if (candidateReport.id === remoteCandidateId) {
                remoteType = candidateReport.candidateType || '';
              }
            });

            // If either candidate is 'relay', we're using TURN
            if (localType === 'relay' || remoteType === 'relay') {
              connectionType = 'relay';
            } else if (localType && remoteType) {
              connectionType = 'p2p';
            }

            debugLog(
              'webrtc',
              `Connection type for ${peerId}: ${connectionType}`,
              `(local: ${localType}, remote: ${remoteType})`,
            );
          }
        });

        // Update peer connection type
        const prevType = peerConn.connectionType;
        peerConn.connectionType = connectionType;

        // Notify if type changed and we have a handler
        if (prevType !== connectionType && this.onConnectionTypeChangeHandler) {
          this.onConnectionTypeChangeHandler(this.getConnectionType());
        }
      })
      .catch((err) => {
        debugLog('webrtc', 'Failed to get connection stats:', err);
      });
  }

  // Get aggregate connection type across all connected peers
  // Returns 'relay' if ANY connection uses relay, 'p2p' if all are direct, 'unknown' otherwise
  getConnectionType(): ConnectionType {
    const connectedPeers = Array.from(this.peers.values()).filter(
      (p) => p.isConnected,
    );

    if (connectedPeers.length === 0) {
      return 'unknown';
    }

    // If any peer is using relay, return 'relay'
    if (connectedPeers.some((p) => p.connectionType === 'relay')) {
      return 'relay';
    }

    // If all connected peers are p2p, return 'p2p'
    if (connectedPeers.every((p) => p.connectionType === 'p2p')) {
      return 'p2p';
    }

    // Otherwise unknown (some connections still negotiating)
    return 'unknown';
  }
}

// Singleton instance
export const webrtc = new WebRTCManager();
