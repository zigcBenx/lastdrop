import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { GameRoom } from './GameRoom';
import { JoinPayload, InputState } from '../shared/types';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

const PORT = process.env.PORT || 3000;

// Serve static files from public/
app.use(express.static(path.join(__dirname, '../../public')));

// Single global room for Phase 1
const globalRoom = new GameRoom(io, 'global');

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('join', (payload: JoinPayload) => {
    console.log(`Player ${payload.nickname} (${payload.carType}) joining as ${socket.id}`);
    globalRoom.addPlayer(socket, payload);
  });

  socket.on('input', (input: InputState) => {
    globalRoom.handleInput(socket.id, input);
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    globalRoom.removePlayer(socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`The Last Drop server running on http://localhost:${PORT}`);
});
