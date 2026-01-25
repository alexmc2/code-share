import * as Y from 'yjs';
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { webrtc } from './webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import { debugLog, debugLogData } from './debug';

// Message types for our protocol
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export class YjsProvider {
  doc: Y.Doc;
  awareness: Awareness;
  persistence: IndexeddbPersistence | null = null;
  private syncedPeers: Set<string> = new Set();
  private syncInitiatedTo: Set<string> = new Set(); // Track who we've sent SyncStep1 to

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.awareness = new Awareness(doc);

    // Listen for local document updates
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Don't rebroadcast updates we received from peers
      if (origin === 'remote') return;
      debugLog('yjs', 'Local doc update, broadcasting', update.length, 'bytes');
      this.broadcastUpdate(update);
    });

    // Listen for awareness updates
    this.awareness.on(
      'update',
      ({
        added,
        updated,
        removed,
      }: {
        added: number[];
        updated: number[];
        removed: number[];
      }) => {
        const changedClients = [...added, ...updated, ...removed];
        if (changedClients.length > 0) {
          debugLog('yjs', 'Local awareness update', {
            added,
            updated,
            removed,
          });
          this.broadcastAwareness(changedClients);
        }
      },
    );

    // Set up WebRTC message handler
    webrtc.setMessageHandler(this.handleMessage.bind(this));
    webrtc.setConnectionChangeHandler(this.handleConnectionChange.bind(this));
  }

  private handleConnectionChange(peerId: string, connected: boolean) {
    if (connected) {
      // New peer connected - initiate sync
      debugLog('yjs', 'Peer connected, initiating sync with:', peerId);
      this.initiateSync(peerId);
    } else {
      // Peer disconnected - reset sync state
      debugLog('yjs', 'Peer disconnected:', peerId);
      this.syncedPeers.delete(peerId);
      this.syncInitiatedTo.delete(peerId);
    }
  }

  private initiateSync(peerId: string) {
    // Send sync step 1 (state vector)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    const message = encoding.toUint8Array(encoder);
    debugLogData('yjs', 'sent', peerId, message.length, 'SyncStep1');
    webrtc.send(peerId, message);
    this.syncInitiatedTo.add(peerId);

    // Also send awareness state
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      encodeAwarenessUpdate(
        this.awareness,
        Array.from(this.awareness.getStates().keys()),
      ),
    );
    const awarenessMessage = encoding.toUint8Array(awarenessEncoder);
    debugLogData('yjs', 'sent', peerId, awarenessMessage.length, 'awareness');
    webrtc.send(peerId, awarenessMessage);
  }

  private handleMessage(peerId: string, data: Uint8Array | string) {
    if (typeof data === 'string') return; // We only handle binary

    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC:
        this.handleSyncMessage(peerId, decoder);
        break;
      case MESSAGE_AWARENESS:
        this.handleAwarenessMessage(peerId, decoder);
        break;
      default:
        debugLog('yjs', 'Unknown message type:', messageType, 'from:', peerId);
    }
  }

  private handleSyncMessage(peerId: string, decoder: decoding.Decoder) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);

    const syncMessageType = syncProtocol.readSyncMessage(
      decoder,
      encoder,
      this.doc,
      'remote',
    );

    // Log what we received
    const msgNames = ['SyncStep1', 'SyncStep2', 'Update'];
    debugLogData(
      'yjs',
      'received',
      peerId,
      0,
      msgNames[syncMessageType] || `type-${syncMessageType}`,
    );

    // If there's a response to send (sync step 2), send it
    if (encoding.length(encoder) > 1) {
      const response = encoding.toUint8Array(encoder);
      debugLogData(
        'yjs',
        'sent',
        peerId,
        response.length,
        'SyncStep2 response',
      );
      webrtc.send(peerId, response);
    }

    // If we received sync step 1 but haven't initiated sync to this peer yet, do so
    // This ensures bidirectional sync when both peers connect
    if (
      syncMessageType === syncProtocol.messageYjsSyncStep1 &&
      !this.syncInitiatedTo.has(peerId)
    ) {
      debugLog(
        'yjs',
        'Received SyncStep1, initiating our own sync to:',
        peerId,
      );
      this.initiateSync(peerId);
    }

    // If we received sync step 2, mark as synced
    if (syncMessageType === syncProtocol.messageYjsSyncStep2) {
      if (!this.syncedPeers.has(peerId)) {
        this.syncedPeers.add(peerId);
        debugLog('yjs', '✓ Fully synced with:', peerId);
      }
    }
  }

  private handleAwarenessMessage(peerId: string, decoder: decoding.Decoder) {
    const update = decoding.readVarUint8Array(decoder);
    debugLogData('yjs', 'received', peerId, update.length, 'awareness');
    applyAwarenessUpdate(this.awareness, update, 'remote');
  }

  private broadcastUpdate(update: Uint8Array) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    webrtc.broadcast(message);
  }

  private broadcastAwareness(changedClients: number[]) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate(this.awareness, changedClients),
    );
    webrtc.broadcast(encoding.toUint8Array(encoder));
  }

  // Set local awareness state (e.g., cursor position, user info)
  setAwarenessField(field: string, value: unknown) {
    this.awareness.setLocalStateField(field, value);
  }

  // Set the full local awareness state
  setAwarenessState(state: Record<string, unknown>) {
    this.awareness.setLocalState(state);
  }

  connect(sessionId: string) {
    if (this.persistence) return;
    this.persistence = new IndexeddbPersistence(
      `code-share-data-${sessionId}`,
      this.doc,
    );
  }

  disconnect() {
    if (this.persistence) {
      this.persistence.destroy();
      this.persistence = null;
    }
  }

  destroy() {
    this.awareness.destroy();
    this.disconnect();
  }
}
