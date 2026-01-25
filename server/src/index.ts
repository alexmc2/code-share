import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';

// Types
interface Peer {
  peerId: string;
  socketId: string;
  name: string;
  joinedAt: number; // Server-assigned timestamp
}

interface Room {
  peers: Map<string, Peer>;
  createdAt: number;
}

// In-memory room state (no content storage!)
const rooms = new Map<string, Room>();

// Cleanup empty rooms every 5 minutes
const ROOM_CLEANUP_INTERVAL = 5 * 60 * 1000;
const ROOM_EMPTY_TIMEOUT = 60 * 1000; // Remove empty rooms after 1 minute

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, room] of rooms) {
    if (room.peers.size === 0 && now - room.createdAt > ROOM_EMPTY_TIMEOUT) {
      rooms.delete(sessionId);
      console.log(`[cleanup] Removed empty room: ${sessionId}`);
    }
  }
}, ROOM_CLEANUP_INTERVAL);

// Express app
const app = express();
const httpServer = createServer(app);

// CORS config - locked down in production
const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || [
  'http://localhost:5173',
  'http://localhost:4173',
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

// Socket.IO server
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
  // Rate limiting
  connectionStateRecovery: {},
});

// Get room, create if not exists
function getOrCreateRoom(sessionId: string): Room {
  let room = rooms.get(sessionId);
  if (!room) {
    room = { peers: new Map(), createdAt: Date.now() };
    rooms.set(sessionId, room);
    console.log(`[room] Created: ${sessionId}`);
  }
  return room;
}

// Get host ID - earliest joinedAt among connected peers
function getHostId(room: Room): string | null {
  if (room.peers.size === 0) return null;

  let earliestPeer: Peer | null = null;
  for (const peer of room.peers.values()) {
    if (!earliestPeer || peer.joinedAt < earliestPeer.joinedAt) {
      earliestPeer = peer;
    }
  }
  return earliestPeer?.peerId ?? null;
}

// Get room state payload for broadcasting
function getRoomState(sessionId: string, room: Room) {
  const hostId = getHostId(room);
  const participants = Array.from(room.peers.values()).map((p) => ({
    peerId: p.peerId,
    socketId: p.socketId,
    name: p.name,
    joinedAt: p.joinedAt,
    isHost: p.peerId === hostId,
  }));

  return {
    sessionId,
    hostId,
    participants,
    participantCount: participants.length,
  };
}

// Socket connection handler
io.on('connection', (socket: Socket) => {
  console.log(`[socket] Connected: ${socket.id}`);

  let currentRoom: string | null = null;
  let currentPeerId: string | null = null;

  // Join room
  socket.on(
    'join-room',
    (data: { sessionId: string; name: string; peerId: string }) => {
      const { sessionId, name, peerId } = data;

      // Leave previous room if any
      if (currentRoom) {
        leaveCurrentRoom();
      }

      currentRoom = sessionId;
      currentPeerId = peerId;

      const room = getOrCreateRoom(sessionId);

      // Handle duplicate peerId - kick old socket if exists
      const existingPeer = room.peers.get(peerId);
      if (existingPeer && existingPeer.socketId !== socket.id) {
        console.log(
          `[room] Duplicate peerId ${peerId}, kicking old socket ${existingPeer.socketId}`,
        );
        const oldSocket = io.sockets.sockets.get(existingPeer.socketId);
        if (oldSocket) {
          oldSocket.emit('kicked', { reason: 'duplicate-peer-id' });
          oldSocket.disconnect(true);
        }
      }

      // Create peer with server-assigned timestamp
      const peer: Peer = {
        peerId,
        socketId: socket.id,
        name,
        joinedAt: Date.now(),
      };

      room.peers.set(peerId, peer);
      socket.join(sessionId);

      console.log(
        `[room] ${name} (${peerId}) joined ${sessionId}, total: ${room.peers.size}`,
      );

      // Send current room state to the joining peer
      socket.emit('room-state', getRoomState(sessionId, room));

      // Notify others about new peer and send updated room state
      const roomState = getRoomState(sessionId, room);
      socket.to(sessionId).emit('peer-joined', {
        peer: {
          ...peer,
          isHost: peer.peerId === roomState.hostId,
        },
      });
    },
  );

  // Leave room helper
  function leaveCurrentRoom() {
    if (!currentRoom || !currentPeerId) return;

    const room = rooms.get(currentRoom);
    if (room) {
      room.peers.delete(currentPeerId);
      socket.to(currentRoom).emit('peer-left', { peerId: currentPeerId });

      // Broadcast updated room state with new host if needed
      if (room.peers.size > 0) {
        const newRoomState = getRoomState(currentRoom, room);
        io.to(currentRoom).emit('room-state', newRoomState);
        console.log(`[room] New host after departure: ${newRoomState.hostId}`);
      }

      console.log(
        `[room] ${currentPeerId} left ${currentRoom}, remaining: ${room.peers.size}`,
      );
    }

    socket.leave(currentRoom);
    currentRoom = null;
    currentPeerId = null;
  }

  // Leave room
  socket.on('leave-room', () => {
    leaveCurrentRoom();
  });

  // WebRTC signalling: offer
  socket.on(
    'offer',
    (data: { targetPeerId: string; offer: Record<string, unknown> }) => {
      if (!currentRoom || !currentPeerId) return;

      const room = rooms.get(currentRoom);
      const targetPeer = room?.peers.get(data.targetPeerId);

      if (targetPeer) {
        io.to(targetPeer.socketId).emit('offer', {
          fromPeerId: currentPeerId,
          offer: data.offer,
        });
      }
    },
  );

  // WebRTC signalling: answer
  socket.on(
    'answer',
    (data: { targetPeerId: string; answer: Record<string, unknown> }) => {
      if (!currentRoom || !currentPeerId) return;

      const room = rooms.get(currentRoom);
      const targetPeer = room?.peers.get(data.targetPeerId);

      if (targetPeer) {
        io.to(targetPeer.socketId).emit('answer', {
          fromPeerId: currentPeerId,
          answer: data.answer,
        });
      }
    },
  );

  // WebRTC signalling: ICE candidate
  socket.on(
    'ice-candidate',
    (data: { targetPeerId: string; candidate: Record<string, unknown> }) => {
      if (!currentRoom || !currentPeerId) return;

      const room = rooms.get(currentRoom);
      const targetPeer = room?.peers.get(data.targetPeerId);

      if (targetPeer) {
        io.to(targetPeer.socketId).emit('ice-candidate', {
          fromPeerId: currentPeerId,
          candidate: data.candidate,
        });
      }
    },
  );

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`[socket] Disconnected: ${socket.id}`);
    leaveCurrentRoom();
  });
});

// Start server
const PORT = parseInt(process.env.PORT || '3001', 10);
httpServer.listen(PORT, () => {
  console.log(`[server] Signalling server running on port ${PORT}`);
});
