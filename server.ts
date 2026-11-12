/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * JIT GROUP - Full-Stack Express & Real-Time Multiplayer WebSocket Server
 * Handles 4-digit room code matchmaking, turn synchronization for all 6 games,
 * live in-game chat with image sharing, and WebRTC voice/video calling signaling.
 */

import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json({ limit: '25mb' }));

// ----------------------------------------------------------------------------
// Room & Multiplayer State Management
// ----------------------------------------------------------------------------

export interface PlayerInfo {
  id: string;
  name: string;
  avatar: string;
  isHost: boolean;
  isReady: boolean;
  color?: string;
  score?: number;
}

export interface InGameMessage {
  id: string;
  roomCode: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  text?: string;
  imageUrl?: string;
  timestamp: string;
}

export interface RoomState {
  roomCode: string;
  gameId: string;
  hostId: string;
  createdAt: number;
  status: 'waiting' | 'in_game' | 'finished';
  maxPlayers: number;
  players: PlayerInfo[];
  gameState: any;
  currentTurn: string;
  messages: InGameMessage[];
  callState: {
    isActive: boolean;
    callType: 'voice' | 'video';
    hostId: string;
    participants: string[];
  } | null;
}

// In-memory rooms repository
const rooms = new Map<string, RoomState>();
const socketToPlayer = new Map<WebSocket, { roomCode: string; playerId: string }>();

// Generates a collision-free 4-digit room code (1000 - 9999)
function generate4DigitCode(): string {
  let code = '';
  let attempts = 0;
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString();
    attempts++;
  } while (rooms.has(code) && attempts < 100);
  return code;
}

// Broadcasts a message to all sockets in a specific room
function broadcastToRoom(roomCode: string, payload: any, excludeSocket?: WebSocket) {
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client !== excludeSocket) {
      const info = socketToPlayer.get(client);
      if (info && info.roomCode === roomCode) {
        client.send(data);
      }
    }
  });
}

// ----------------------------------------------------------------------------
// WebSocket Connection & Protocol
// ----------------------------------------------------------------------------

wss.on('connection', (ws: WebSocket) => {
  ws.send(JSON.stringify({ type: 'CONNECTED', serverTime: Date.now() }));

  ws.on('message', (raw: string) => {
    try {
      const message = JSON.parse(raw.toString());
      const { type, payload } = message;

      switch (type) {
        // 1. Create a 4-Digit Game Room
        case 'CREATE_ROOM': {
          const { gameId, maxPlayers = 2, player } = payload;
          const roomCode = generate4DigitCode();

          const newRoom: RoomState = {
            roomCode,
            gameId,
            hostId: player.id,
            createdAt: Date.now(),
            status: 'waiting',
            maxPlayers,
            players: [
              {
                id: player.id,
                name: player.name,
                avatar: player.avatar,
                isHost: true,
                isReady: true,
                color: 'blue',
              },
            ],
            gameState: null,
            currentTurn: player.id,
            messages: [],
            callState: null,
          };

          rooms.set(roomCode, newRoom);
          socketToPlayer.set(ws, { roomCode, playerId: player.id });

          ws.send(
            JSON.stringify({
              type: 'ROOM_CREATED',
              payload: { room: newRoom },
            })
          );
          break;
        }

        // 2. Join Game Room with 4-Digit Code
        case 'JOIN_ROOM': {
          const { roomCode, gameId, player } = payload;
          const cleanCode = (roomCode || '').trim().replace(/\D/g, '');

          const room = rooms.get(cleanCode);
          if (!room) {
            ws.send(
              JSON.stringify({
                type: 'ERROR',
                payload: {
                  code: 'ROOM_NOT_FOUND',
                  message: `Room #${cleanCode} not found. Please verify the 4-digit code.`,
                },
              })
            );
            return;
          }

          if (room.gameId !== gameId) {
            ws.send(
              JSON.stringify({
                type: 'ERROR',
                payload: {
                  code: 'GAME_MISMATCH',
                  message: `This room was created for a different game (${room.gameId.toUpperCase()}).`,
                },
              })
            );
            return;
          }

          const existingIndex = room.players.findIndex((p) => p.id === player.id);
          if (existingIndex === -1 && room.players.length >= room.maxPlayers) {
            ws.send(
              JSON.stringify({
                type: 'ERROR',
                payload: {
                  code: 'ROOM_FULL',
                  message: `Room #${cleanCode} is full (max ${room.maxPlayers} players).`,
                },
              })
            );
            return;
          }

          if (existingIndex === -1) {
            const colors = ['red', 'green', 'amber', 'purple'];
            const assignedColor = colors[room.players.length % colors.length];
            room.players.push({
              id: player.id,
              name: player.name,
              avatar: player.avatar,
              isHost: false,
              isReady: true,
              color: assignedColor,
            });
          }

          socketToPlayer.set(ws, { roomCode: cleanCode, playerId: player.id });

          broadcastToRoom(cleanCode, {
            type: 'ROOM_UPDATED',
            payload: { room },
          });
          break;
        }

        // 3. Quick Matchmaking (Play with Random Player)
        case 'QUICK_MATCH': {
          const { gameId, maxPlayers = 2, player } = payload;

          // Find an existing open room for this game
          let matchedRoom: RoomState | null = null;
          for (const room of rooms.values()) {
            if (
              room.gameId === gameId &&
              room.status === 'waiting' &&
              room.players.length < room.maxPlayers &&
              !room.players.some((p) => p.id === player.id)
            ) {
              matchedRoom = room;
              break;
            }
          }

          if (matchedRoom) {
            matchedRoom.players.push({
              id: player.id,
              name: player.name,
              avatar: player.avatar,
              isHost: false,
              isReady: true,
            });

            // If capacity met, auto-start
            if (matchedRoom.players.length >= matchedRoom.maxPlayers) {
              matchedRoom.status = 'in_game';
            }

            socketToPlayer.set(ws, { roomCode: matchedRoom.roomCode, playerId: player.id });

            broadcastToRoom(matchedRoom.roomCode, {
              type: 'ROOM_UPDATED',
              payload: { room: matchedRoom },
            });
          } else {
            // Create new public room and wait for opponent
            const roomCode = generate4DigitCode();
            const newRoom: RoomState = {
              roomCode,
              gameId,
              hostId: player.id,
              createdAt: Date.now(),
              status: 'waiting',
              maxPlayers,
              players: [
                {
                  id: player.id,
                  name: player.name,
                  avatar: player.avatar,
                  isHost: true,
                  isReady: true,
                },
              ],
              gameState: null,
              currentTurn: player.id,
              messages: [],
              callState: null,
            };

            rooms.set(roomCode, newRoom);
            socketToPlayer.set(ws, { roomCode, playerId: player.id });

            ws.send(
              JSON.stringify({
                type: 'ROOM_CREATED',
                payload: { room: newRoom, isQuickMatch: true },
              })
            );
          }
          break;
        }

        // 4. Host Starts Game
        case 'START_GAME': {
          const { roomCode, initialGameState } = payload;
          const room = rooms.get(roomCode);
          if (room) {
            room.status = 'in_game';
            if (initialGameState) {
              room.gameState = initialGameState;
            }
            broadcastToRoom(roomCode, {
              type: 'GAME_STARTED',
              payload: { room },
            });
          }
          break;
        }

        // 5. Real-Time Game Turn / Move
        case 'GAME_MOVE': {
          const { roomCode, moveAction, newGameState, nextTurn } = payload;
          const room = rooms.get(roomCode);
          if (room) {
            room.gameState = newGameState;
            if (nextTurn !== undefined) {
              room.currentTurn = nextTurn;
            }
            broadcastToRoom(roomCode, {
              type: 'GAME_STATE_UPDATED',
              payload: {
                roomCode,
                moveAction,
                gameState: newGameState,
                currentTurn: room.currentTurn,
              },
            });
          }
          break;
        }

        // 6. Rematch Request / Reset
        case 'REMATCH_GAME': {
          const { roomCode, resetState } = payload;
          const room = rooms.get(roomCode);
          if (room) {
            room.status = 'in_game';
            room.gameState = resetState;
            room.currentTurn = room.players[0]?.id || room.hostId;
            broadcastToRoom(roomCode, {
              type: 'GAME_RESET',
              payload: { room },
            });
          }
          break;
        }

        // 7. Live In-Game Chat Message (Text / Image)
        case 'SEND_CHAT_MESSAGE': {
          const { roomCode, message: chatMsg } = payload;
          const room = rooms.get(roomCode);
          if (room) {
            const formatted: InGameMessage = {
              id: `gmsg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              roomCode,
              senderId: chatMsg.senderId,
              senderName: chatMsg.senderName,
              senderAvatar: chatMsg.senderAvatar,
              text: chatMsg.text,
              imageUrl: chatMsg.imageUrl,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            };
            room.messages.push(formatted);
            broadcastToRoom(roomCode, {
              type: 'CHAT_MESSAGE_RECEIVED',
              payload: { message: formatted },
            });
          }
          break;
        }

        // 8. In-Game WebRTC Voice / Video Signaling
        case 'CALL_SIGNAL': {
          const { roomCode, signalData, targetPlayerId, senderId, callType } = payload;
          const room = rooms.get(roomCode);
          if (room) {
            if (signalData?.type === 'CALL_START') {
              room.callState = {
                isActive: true,
                callType: callType || 'video',
                hostId: senderId,
                participants: [senderId],
              };
            } else if (signalData?.type === 'CALL_END') {
              room.callState = null;
            } else if (signalData?.type === 'CALL_JOIN' && room.callState) {
              if (!room.callState.participants.includes(senderId)) {
                room.callState.participants.push(senderId);
              }
            }

            broadcastToRoom(
              roomCode,
              {
                type: 'CALL_SIGNAL_RECEIVED',
                payload: {
                  roomCode,
                  signalData,
                  targetPlayerId,
                  senderId,
                  callType,
                  callState: room.callState,
                },
              },
              ws // don't echo back to sender
            );
          }
          break;
        }

        // 9. Host Kicks Player
        case 'KICK_PLAYER': {
          const { roomCode, targetPlayerId } = payload;
          const room = rooms.get(roomCode);
          if (room) {
            room.players = room.players.filter((p) => p.id !== targetPlayerId);
            broadcastToRoom(roomCode, {
              type: 'PLAYER_KICKED',
              payload: { targetPlayerId, room },
            });
          }
          break;
        }

        // 10. Leave Room
        case 'LEAVE_ROOM': {
          const { roomCode, playerId } = payload;
          const room = rooms.get(roomCode);
          if (room) {
            room.players = room.players.filter((p) => p.id !== playerId);
            if (room.players.length === 0) {
              rooms.delete(roomCode);
            } else {
              // Reassign host if host left
              if (room.hostId === playerId) {
                room.hostId = room.players[0].id;
                room.players[0].isHost = true;
              }
              broadcastToRoom(roomCode, {
                type: 'ROOM_UPDATED',
                payload: { room },
              });
            }
          }
          socketToPlayer.delete(ws);
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    const info = socketToPlayer.get(ws);
    if (info) {
      const { roomCode, playerId } = info;
      const room = rooms.get(roomCode);
      if (room) {
        room.players = room.players.filter((p) => p.id !== playerId);
        if (room.players.length === 0) {
          rooms.delete(roomCode);
        } else {
          if (room.hostId === playerId) {
            room.hostId = room.players[0].id;
            room.players[0].isHost = true;
          }
          broadcastToRoom(roomCode, {
            type: 'ROOM_UPDATED',
            payload: { room },
          });
        }
      }
      socketToPlayer.delete(ws);
    }
  });
});

// ----------------------------------------------------------------------------
// API Endpoints & Health Check
// ----------------------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    activeRooms: rooms.size,
    connectedSockets: wss.clients.size,
    timestamp: Date.now(),
  });
});

app.get('/api/rooms/:code', (req, res) => {
  const code = (req.params.code || '').replace(/\D/g, '');
  const room = rooms.get(code);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json({ room });
});

// ----------------------------------------------------------------------------
// Vite Integration in Development / Static Serving in Production
// ----------------------------------------------------------------------------

async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';
  const PORT = Number(process.env.PORT) || 3000;

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[JIT GROUP] Server running with WebSocket on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
