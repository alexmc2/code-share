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

// Message types for our protocol
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export class YjsProvider {
  doc: Y.Doc;
  awareness: Awareness;
  persistence: IndexeddbPersistence;
  private syncedPeers: Set<string> = new Set();

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.awareness = new Awareness(doc);
    this.persistence = new IndexeddbPersistence('code-share-data', doc);

    // Listen for local document updates
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Don't rebroadcast updates we received from peers
      if (origin === 'remote') return;
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
      console.log(`[yjs] Initiating sync with ${peerId}`);
      this.initiateSync(peerId);
    } else {
      // Peer disconnected
      this.syncedPeers.delete(peerId);
    }
  }

  private initiateSync(peerId: string) {
    // Send sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    const message = encoding.toUint8Array(encoder);
    webrtc.send(peerId, message);

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
    webrtc.send(peerId, encoding.toUint8Array(awarenessEncoder));
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
        this.handleAwarenessMessage(decoder);
        break;
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

    // If there's a response to send (sync step 2), send it
    if (encoding.length(encoder) > 1) {
      webrtc.send(peerId, encoding.toUint8Array(encoder));
    }

    // If we received sync step 2, mark as synced
    if (syncMessageType === syncProtocol.messageYjsSyncStep2) {
      if (!this.syncedPeers.has(peerId)) {
        this.syncedPeers.add(peerId);
        console.log(`[yjs] Synced with ${peerId}`);
      }
    }
  }

  private handleAwarenessMessage(decoder: decoding.Decoder) {
    const update = decoding.readVarUint8Array(decoder);
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

  destroy() {
    this.awareness.destroy();
    this.persistence.destroy();
  }
}
