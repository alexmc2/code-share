import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Types
interface Peer {
  peerId: string;
  socketId: string;
  name: string;
  isHost: boolean;
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

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const staticPath = path.join(__dirname, '../../client/dist');
  app.use(express.static(staticPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(staticPath, 'index.html'));
  });
}

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

// Get participant list for a room (safe to broadcast)
function getParticipantList(room: Room): Peer[] {
  return Array.from(room.peers.values());
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
      const isHost = room.peers.size === 0;

      const peer: Peer = {
        peerId,
        socketId: socket.id,
        name,
        isHost,
      };

      room.peers.set(peerId, peer);
      socket.join(sessionId);

      console.log(
        `[room] ${name} (${peerId}) joined ${sessionId}, total: ${room.peers.size}`,
      );

      // Send current state to the joining peer
      socket.emit('room-state', {
        participants: getParticipantList(room),
        isHost,
      });

      // Notify others about new peer
      socket.to(sessionId).emit('peer-joined', { peer });
    },
  );

  // Leave room helper
  function leaveCurrentRoom() {
    if (!currentRoom || !currentPeerId) return;

    const room = rooms.get(currentRoom);
    if (room) {
      room.peers.delete(currentPeerId);
      socket.to(currentRoom).emit('peer-left', { peerId: currentPeerId });

      // If host left, assign new host
      if (room.peers.size > 0) {
        const firstPeer = room.peers.values().next().value;
        if (
          firstPeer &&
          !Array.from(room.peers.values()).some((p) => p.isHost)
        ) {
          firstPeer.isHost = true;
          io.to(currentRoom).emit('host-changed', { peerId: firstPeer.peerId });
        }
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
