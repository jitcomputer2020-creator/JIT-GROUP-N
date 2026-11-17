/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * JIT GROUP - Full-Stack Express & Real-Time Multiplayer WebSocket Server
 * Handles 4-digit room code matchmaking, turn synchronization for all 6 games,
 * live in-game chat with image sharing, and WebRTC voice/video calling signaling.
 */

import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  runJitAiChat,
  generateSmartCaptions,
  generateAiQuizRound,
  moderatePublicText,
  runFastHeuristicModeration,
} from './src/server/geminiService.ts';
import {
  testFirestoreConnection,
  lookupCloudProfileByPhone,
  loginCloudProfileByPhone,
  registerOrRecognizeCloudProfile,
  updateCloudProfile,
  ensureCloudProfileSeeded,
  fetchNodeLeaderboard,
  fetchNodeMatchHistory,
  fetchAllCloudProfilesForAdmin,
  adminOverrideCloudProfile,
  adminModerateCloudProfile,
  fetchNodeUserActivity,
  fetchNodePlatformCounts,
  deleteNodePost,
  deleteNodeReel,
  deleteNodeMatchRecord,
  publishNodeAnnouncement,
  fetchNodeAnnouncements,
  deleteNodeAnnouncement,
} from './src/lib/firebaseNode.ts';
import { INITIAL_USER, INITIAL_FRIENDS, INITIAL_POSTS } from './src/services/mockData.ts';

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
  lastActivityAt?: number;
  isPublicMatch?: boolean;
  status: 'waiting' | 'in_game' | 'finished';
  maxPlayers: number;
  isOpenGroup?: boolean;
  activeSeatLimit?: number;
  players: PlayerInfo[];
  waitingPlayers: PlayerInfo[];
  mutedVoiceIds: string[];
  mutedChatIds: string[];
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

function cleanupStaleServerRooms() {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    const lastActive = room.lastActivityAt || room.createdAt || now;
    const isDeadPublicQueue =
      room.isPublicMatch &&
      room.status === 'waiting' &&
      room.players.length <= 1 &&
      now - lastActive > 4 * 60 * 1000;
    const isExpiredRoom = now - lastActive > 30 * 60 * 1000;
    if (isDeadPublicQueue || isExpiredRoom || room.players.length === 0) {
      rooms.delete(code);
    }
  }
}

setInterval(cleanupStaleServerRooms, 2 * 60 * 1000);

function releaseSoloHostedServerRooms(playerId: string) {
  if (!playerId) return;
  for (const [code, room] of rooms.entries()) {
    if (room.hostId === playerId && room.players.length <= 1 && (room.waitingPlayers?.length || 0) === 0) {
      rooms.delete(code);
    }
  }
}

// Generates a collision-free 4-digit room code (1000 - 9999)
function generate4DigitCode(): string {
  cleanupStaleServerRooms();
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
          releaseSoloHostedServerRooms(player.id);
          const roomCode = generate4DigitCode();

          const newRoom: RoomState = {
            roomCode,
            gameId,
            hostId: player.id,
            createdAt: Date.now(),
            lastActivityAt: Date.now(),
            isPublicMatch: false,
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
            waitingPlayers: [],
            mutedVoiceIds: [],
            mutedChatIds: [],
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

          if (gameId && room.gameId !== gameId) {
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

          room.lastActivityAt = Date.now();
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
          cleanupStaleServerRooms();
          releaseSoloHostedServerRooms(player.id);

          // Find an existing open public waiting room for this game (oldest first)
          let matchedRoom: RoomState | null = null;
          for (const room of rooms.values()) {
            if (
              room.isPublicMatch &&
              !room.isOpenGroup &&
              room.gameId === gameId &&
              room.status === 'waiting' &&
              room.players.length < room.maxPlayers &&
              !room.players.some((p) => p.id === player.id)
            ) {
              if (!matchedRoom || room.createdAt < matchedRoom.createdAt) {
                matchedRoom = room;
              }
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
            matchedRoom.lastActivityAt = Date.now();

            // If capacity met, auto-start immediately
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
              lastActivityAt: Date.now(),
              isPublicMatch: true,
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
              waitingPlayers: [],
              mutedVoiceIds: [],
              mutedChatIds: [],
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

        // 7. Live In-Game Chat Message (Text / Image) with Host Moderation Check
        case 'SEND_CHAT_MESSAGE': {
          const { roomCode, message: chatMsg } = payload;
          const room = rooms.get(roomCode);
          if (room) {
            if (room.mutedChatIds?.includes(chatMsg.senderId)) {
              ws.send(
                JSON.stringify({
                  type: 'ERROR',
                  payload: {
                    code: 'CHAT_MUTED',
                    message: 'Your chat access was restricted by the Room Host.',
                  },
                })
              );
              return;
            }
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

        // 7b. Live Floating Emoji Reactions
        case 'SEND_REACTION': {
          const { roomCode, reaction } = payload;
          const room = rooms.get(roomCode);
          if (room && reaction) {
            broadcastToRoom(
              roomCode,
              {
                type: 'REACTION_RECEIVED',
                payload: { roomCode, reaction },
              },
              ws
            );
          }
          break;
        }

        // 7c. Host Voice & Chat Moderation Controls
        case 'HOST_SET_MODERATION': {
          const { roomCode, mutedVoiceIds, mutedChatIds } = payload;
          const room = rooms.get(roomCode);
          const caller = socketToPlayer.get(ws);
          if (room && (!caller || caller.playerId === room.hostId)) {
            room.mutedVoiceIds = Array.isArray(mutedVoiceIds) ? mutedVoiceIds : room.mutedVoiceIds;
            room.mutedChatIds = Array.isArray(mutedChatIds) ? mutedChatIds : room.mutedChatIds;
            broadcastToRoom(roomCode, {
              type: 'MODERATION_UPDATED',
              payload: {
                roomCode,
                mutedVoiceIds: room.mutedVoiceIds,
                mutedChatIds: room.mutedChatIds,
              },
            });
          }
          break;
        }

        // 7d. Host Rotates Active Seats & Waiting Queue Players
        case 'HOST_ROTATE_PLAYERS': {
          const { roomCode, nextActiveIds, resetState } = payload;
          const room = rooms.get(roomCode);
          const caller = socketToPlayer.get(ws);
          if (room && Array.isArray(nextActiveIds) && (!caller || caller.playerId === room.hostId)) {
            const allPool = [...room.players, ...(room.waitingPlayers || [])];
            const byId = new Map<string, PlayerInfo>();
            allPool.forEach((p) => {
              if (!byId.has(p.id)) byId.set(p.id, p);
            });
            const chosen = new Set<string>(nextActiveIds.filter((id: string) => byId.has(id)));
            room.players = Array.from(chosen).map((id) => {
              const p = byId.get(id)!;
              return { ...p, isHost: p.id === room.hostId };
            });
            room.waitingPlayers = allPool
              .filter((p) => !chosen.has(p.id))
              .map((p) => ({ ...p, isHost: p.id === room.hostId }));
            room.status = 'in_game';
            room.gameState = resetState || null;
            room.currentTurn = room.players[0]?.id || room.hostId;
            broadcastToRoom(roomCode, {
              type: 'GAME_RESET',
              payload: { room },
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
// Persistent User Profiles Database (data/profiles.json)
// ----------------------------------------------------------------------------

const DATA_DIR = path.resolve(__dirname, 'data');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error('Failed to create data dir:', e);
  }
}

function normalizeDigits(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

function isPhoneMatch(p1: string, p2: string): boolean {
  const d1 = normalizeDigits(p1);
  const d2 = normalizeDigits(p2);
  if (!d1 || !d2) return false;
  if (d1 === d2) return true;
  // Match on last 10 digits if country code or 0 prefix differs
  if (d1.length >= 10 && d2.length >= 10 && d1.slice(-10) === d2.slice(-10)) return true;
  // Match local numbers of length 7+
  if (d1.length >= 7 && d2.length >= 7 && (d1.endsWith(d2) || d2.endsWith(d1))) return true;
  return false;
}

const INACTIVITY_EXPIRY_MS = 180 * 24 * 60 * 60 * 1000; // 180 consecutive days (6 months)

function isProfileExpired(profile: any): boolean {
  if (!profile) return false;
  // System / demo accounts are maintained for instant exploration
  if (profile.id === 'usr_jit_primary_001' || profile.isSystemAccount) {
    return false;
  }
  const lastActiveStr = profile.lastLoginAt || profile.lastLogin || profile.joinedAt;
  if (!lastActiveStr) return false;
  const lastActiveTime = new Date(lastActiveStr).getTime();
  if (isNaN(lastActiveTime)) return false;
  return Date.now() - lastActiveTime > INACTIVITY_EXPIRY_MS;
}

function readProfiles(): any[] {
  try {
    if (!fs.existsSync(PROFILES_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(PROFILES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const profiles = Array.isArray(parsed) ? parsed : [];

    // Automatic expiration mechanism: clear/delete any inactive profile data (>180 days)
    const activeProfiles = profiles.filter((p) => {
      const expired = isProfileExpired(p);
      if (expired) {
        console.log(
          `[180-Day Auto Cleanup] Purged inactive profile: ${p.fullName} (${p.contactNumber}), last active: ${
            p.lastLoginAt || p.lastLogin || p.joinedAt
          }`
        );
      }
      return !expired;
    });

    if (activeProfiles.length !== profiles.length) {
      writeProfiles(activeProfiles);
    }
    return activeProfiles;
  } catch (err) {
    console.error('Error reading profiles.json:', err);
    return [];
  }
}

function writeProfiles(profiles: any[]) {
  try {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing profiles.json:', err);
  }
}

// Background periodic sweep: runs auto-cleanup every 30 minutes
setInterval(() => {
  try {
    readProfiles();
  } catch (err) {
    console.error('Error in periodic 180-day cleanup sweep:', err);
  }
}, 30 * 60 * 1000);

// Seed initial demo users into Firestore and test connection on boot
testFirestoreConnection().catch(() => {});
Promise.all([INITIAL_USER, ...INITIAL_FRIENDS].map((u) => ensureCloudProfileSeeded(u))).catch((err) =>
  console.warn('Initial Firestore seed notice:', err)
);

function upsertLocalMirror(profile: any) {
  if (!profile || !profile.contactNumber) return;
  const profiles = readProfiles();
  const idx = profiles.findIndex(
    (p: any) => isPhoneMatch(p.contactNumber, profile.contactNumber) || (profile.id && p.id === profile.id)
  );
  if (idx >= 0) {
    profiles[idx] = profile;
  } else {
    profiles.unshift(profile);
  }
  writeProfiles(profiles);
}

function removeLocalMirror(contactNumber: string, profileId?: string) {
  const profiles = readProfiles();
  const filtered = profiles.filter(
    (p: any) => !isPhoneMatch(p.contactNumber, contactNumber) && (!profileId || p.id !== profileId)
  );
  if (filtered.length !== profiles.length) {
    writeProfiles(filtered);
  }
}

// 1. Get all registered profiles (merges local cache with active demo seeds)
app.get('/api/profiles', (req, res) => {
  const profiles = readProfiles();
  res.json({ profiles });
});

// 1b. Case-insensitive app-wide user search across Firebase & local mirror (name, username, or phone)
app.get('/api/users/search', async (req, res) => {
  const raw = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const qLower = raw.toLowerCase().replace(/^@+/, '');
  const qDigits = normalizeDigits(raw);

  try {
    const cloudResult = await fetchAllCloudProfilesForAdmin().catch(() => ({
      profiles: [] as any[],
      firebaseCount: 0,
    }));
    const cloudProfiles = Array.isArray(cloudResult?.profiles) ? cloudResult.profiles : [];
    const localProfiles = readProfiles();
    const merged = [...cloudProfiles, ...localProfiles, INITIAL_USER, ...INITIAL_FRIENDS];
    const seen = new Set<string>();
    const results: any[] = [];

    for (const p of merged) {
      if (!p || !p.id || p.status === 'deleted' || seen.has(p.id)) continue;
      seen.add(p.id);

      const name = String(p.fullName || '');
      const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const pDigits = normalizeDigits(p.contactNumber || '');
      const derivedUsername = String(
        p.username || `${slugBase || 'jit_member'}${pDigits.length >= 4 ? `_${pDigits.slice(-2)}` : ''}`
      );

      const matches =
        !qLower ||
        name.toLowerCase().includes(qLower) ||
        derivedUsername.toLowerCase().includes(qLower) ||
        (p.bio || '').toLowerCase().includes(qLower) ||
        (p.address || '').toLowerCase().includes(qLower) ||
        (qDigits.length >= 4 && pDigits.includes(qDigits));

      if (matches) {
        results.push({
          id: p.id,
          fullName: p.fullName,
          username: derivedUsername,
          avatarUrl: p.avatarUrl || '/assets/aistudio/image_e64e54f2.png',
          bio: p.bio || '',
          address: p.address || 'JIT Campus',
          contactNumber: p.isContactNumberPublic ? p.contactNumber : (pDigits.length >= 4 ? `******${pDigits.slice(-4)}` : 'Private'),
          joinedAt: p.joinedAt,
          lastLoginAt: p.lastLoginAt || p.joinedAt,
          isContactNumberPublic: Boolean(p.isContactNumberPublic),
          isAddressPublic: Boolean(p.isAddressPublic),
          stats: p.stats || {
            friendsCount: 0,
            followersCount: 0,
            followingCount: 0,
            postsCount: 0,
            reelsCount: 0,
            gamesPlayed: 0,
            gamesWon: 0,
            rewardPoints: 100,
            streakDays: 1,
          },
        });
      }
    }

    res.json({ users: results.slice(0, 30) });
  } catch (err) {
    console.error('Error in /api/users/search:', err);
    res.status(500).json({ users: [] });
  }
});

// ----------------------------------------------------------------------------
// Persistent Chats, Posts & Global Announcements Stores (data/*.json)
// ----------------------------------------------------------------------------

const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const ANNOUNCEMENTS_FILE = path.join(DATA_DIR, 'announcements.json');

interface PersistedChatsData {
  conversations: any[];
  messages: any[];
}

function getDefaultChatsData(): PersistedChatsData {
  const defaultConversations = [
    {
      id: 'conv_001',
      type: 'direct',
      name: 'Priya Mukherjee',
      avatarUrl: INITIAL_FRIENDS[0]?.avatarUrl || '/assets/aistudio/image_e64e54f2.png',
      participantIds: ['usr_jit_primary_001', 'usr_jit_002'],
      lastMessage: {
        text: 'Are we still on for the Ludo tournament practice at 7 PM?',
        senderId: 'usr_jit_002',
        createdAt: '10:45 AM',
        isRead: false,
      },
      unreadCount: 1,
      updatedAt: '10:45 AM',
    },
    {
      id: 'conv_002',
      type: 'direct',
      name: 'Arjun Verma',
      avatarUrl: INITIAL_FRIENDS[1]?.avatarUrl || '/assets/aistudio/image_e64e54f2.png',
      participantIds: ['usr_jit_primary_001', 'usr_jit_003'],
      lastMessage: {
        text: 'Sent you the room code for Carrom: JIT-4491',
        senderId: 'usr_jit_003',
        createdAt: 'Yesterday',
        isRead: true,
      },
      unreadCount: 0,
      updatedAt: 'Yesterday',
    },
    {
      id: 'conv_003',
      type: 'group',
      name: 'JIT Tech Club & Gamers',
      avatarUrl: '/assets/aistudio/image_e64e54f2.png',
      participantIds: ['usr_jit_primary_001', 'usr_jit_002', 'usr_jit_003', 'usr_jit_004'],
      lastMessage: {
        text: 'Ananya: Chess blitz registration closes tonight!',
        senderId: 'usr_jit_004',
        createdAt: '2 days ago',
        isRead: true,
      },
      unreadCount: 0,
      updatedAt: '2 days ago',
    },
  ];

  const defaultMessages = [
    {
      id: 'msg_1',
      conversationId: 'conv_001',
      senderId: 'usr_jit_002',
      senderName: 'Priya Mukherjee',
      content: 'Hi! Have you checked out the new JIT GROUP gaming and calling features?',
      createdAt: '10:30 AM',
      status: 'read',
    },
    {
      id: 'msg_2',
      conversationId: 'conv_001',
      senderId: 'usr_jit_primary_001',
      senderName: 'Prof. Ramesh Sharma',
      content: 'Yes! The WebRTC low-latency calling and real-time state synchronization work seamlessly.',
      createdAt: '10:35 AM',
      status: 'read',
    },
    {
      id: 'msg_3',
      conversationId: 'conv_001',
      senderId: 'usr_jit_002',
      senderName: 'Priya Mukherjee',
      content: 'Are we still on for the Ludo tournament practice at 7 PM?',
      createdAt: '10:45 AM',
      status: 'delivered',
    },
    {
      id: 'msg_4',
      conversationId: 'conv_002',
      senderId: 'usr_jit_003',
      senderName: 'Arjun Verma',
      content: 'Sent you the room code for Carrom: JIT-4491',
      createdAt: 'Yesterday',
      status: 'read',
    },
    {
      id: 'msg_5',
      conversationId: 'conv_003',
      senderId: 'usr_jit_004',
      senderName: 'Ananya Sen',
      content: 'Chess blitz registration closes tonight! Join the tournament bracket before 9 PM.',
      createdAt: '2 days ago',
      status: 'read',
    },
  ];

  return { conversations: defaultConversations, messages: defaultMessages };
}

function readChatsData(): PersistedChatsData {
  try {
    if (fs.existsSync(CHATS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CHATS_FILE, 'utf-8'));
      if (parsed && Array.isArray(parsed.conversations) && Array.isArray(parsed.messages)) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Error reading chats.json:', err);
  }
  const seeded = getDefaultChatsData();
  writeChatsData(seeded);
  return seeded;
}

function writeChatsData(data: PersistedChatsData) {
  try {
    fs.writeFileSync(CHATS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Error writing chats.json:', err);
  }
}

function readPostsData(): any[] {
  try {
    if (fs.existsSync(POSTS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('Error reading posts.json:', err);
  }
  const seeded = INITIAL_POSTS.map((p) => ({
    ...p,
    likedBy: p.isLiked ? ['usr_jit_primary_001', 'usr_jit_002', 'usr_jit_003'] : ['usr_jit_002', 'usr_jit_004'],
    comments: [],
  }));
  writePostsData(seeded);
  return seeded;
}

function writePostsData(posts: any[]) {
  try {
    fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Error writing posts.json:', err);
  }
}

function readAnnouncementsData(): any[] {
  try {
    if (fs.existsSync(ANNOUNCEMENTS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ANNOUNCEMENTS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('Error reading announcements.json:', err);
  }
  return [];
}

function writeAnnouncementsData(list: any[]) {
  try {
    fs.writeFileSync(ANNOUNCEMENTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Error writing announcements.json:', err);
  }
}

// Public Chats & Messages Endpoints
app.get('/api/messages', (req, res) => {
  const chats = readChatsData();
  const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  if (!userId) {
    return res.json(chats);
  }
  const conversations = chats.conversations.filter(
    (c: any) => Array.isArray(c.participantIds) && c.participantIds.includes(userId)
  );
  const convIds = new Set(conversations.map((c: any) => c.id));
  const messages = chats.messages.filter(
    (m: any) => convIds.has(m.conversationId) || m.senderId === userId
  );
  return res.json({ conversations, messages });
});

app.post('/api/messages', (req, res) => {
  const msg = req.body?.message;
  if (!msg || !msg.conversationId || !msg.senderId) {
    return res.status(400).json({ error: 'Invalid message payload' });
  }
  const chats = readChatsData();
  const savedMsg = {
    ...msg,
    id: msg.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: msg.createdAt || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    timestampIso: msg.timestampIso || new Date().toISOString(),
  };

  if (!chats.messages.some((m: any) => m.id === savedMsg.id)) {
    chats.messages.push(savedMsg);
  }

  const convIdx = chats.conversations.findIndex((c: any) => c.id === savedMsg.conversationId);
  if (convIdx >= 0) {
    const conv = chats.conversations[convIdx];
    const participants = Array.isArray(conv.participantIds) ? [...conv.participantIds] : [];
    if (!participants.includes(savedMsg.senderId)) {
      participants.push(savedMsg.senderId);
    }
    chats.conversations[convIdx] = {
      ...conv,
      participantIds: participants,
      lastMessage: {
        text: savedMsg.content || (savedMsg.mediaUrl ? '[Image Attachment]' : ''),
        senderId: savedMsg.senderId,
        createdAt: savedMsg.createdAt,
        isRead: true,
      },
      updatedAt: savedMsg.createdAt,
    };
  }

  writeChatsData(chats);
  return res.json({ success: true, message: savedMsg });
});

app.post('/api/conversations', (req, res) => {
  const conv = req.body?.conversation;
  if (!conv || !conv.id) {
    return res.status(400).json({ error: 'Invalid conversation payload' });
  }
  const chats = readChatsData();
  const idx = chats.conversations.findIndex((c: any) => c.id === conv.id);
  if (idx >= 0) {
    chats.conversations[idx] = { ...chats.conversations[idx], ...conv };
  } else {
    chats.conversations.unshift(conv);
  }
  writeChatsData(chats);
  return res.json({ success: true, conversation: conv });
});

// Persistent Media Uploads (Reels / Feed Videos with 40-Day Expiry)
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const VIDEO_EXPIRY_MS = 40 * 24 * 60 * 60 * 1000;

if (!fs.existsSync(MEDIA_DIR)) {
  try {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
  } catch (e) {
    console.warn('Could not create media dir:', e);
  }
}

function isServerVideoExpired(item: {
  createdAtMs?: unknown;
  expiresAt?: unknown;
  mediaType?: unknown;
}): boolean {
  if (item.mediaType === 'image' || item.mediaType === 'none') return false;
  const now = Date.now();
  const created = Number(item.createdAtMs);
  const rawExp = Number(item.expiresAt);
  const createdMs =
    Number.isFinite(created) && created > 0
      ? created < 1_000_000_000_000 && created > 1_000_000_000
        ? created * 1000
        : created
      : undefined;
  const expMs =
    Number.isFinite(rawExp) && rawExp > 0
      ? rawExp < 1_000_000_000_000 && rawExp > 1_000_000_000
        ? rawExp * 1000
        : rawExp
      : undefined;

  if (createdMs && createdMs > 1_000_000_000_000) {
    const minFullExpiry = createdMs + VIDEO_EXPIRY_MS;
    const effectiveExpiry = expMs && expMs > minFullExpiry ? expMs : minFullExpiry;
    return now >= effectiveExpiry;
  }
  if (expMs && expMs > 1_000_000_000_000) {
    return now >= expMs;
  }
  return false;
}

function purgeExpiredServerMedia() {
  try {
    if (!fs.existsSync(MEDIA_DIR)) return;
    const files = fs.readdirSync(MEDIA_DIR);
    for (const f of files) {
      if (!f.endsWith('.meta.json')) continue;
      const metaPath = path.join(MEDIA_DIR, f);
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (isServerVideoExpired(meta)) {
          const mediaPath = path.join(MEDIA_DIR, String(meta.filename || ''));
          if (meta.filename && fs.existsSync(mediaPath)) fs.unlinkSync(mediaPath);
          fs.unlinkSync(metaPath);
        }
      } catch {
        // Ignore malformed meta file
      }
    }
  } catch {
    // Non-fatal
  }
}

setInterval(purgeExpiredServerMedia, 30 * 60 * 1000);
purgeExpiredServerMedia();

app.post(
  '/api/media/upload',
  express.raw({ type: ['video/*', 'image/*', 'application/octet-stream'], limit: '55mb' }),
  (req, res) => {
    try {
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!buf.length) {
        return res.status(400).json({ error: 'Empty media payload' });
      }
      const mime = String(req.headers['x-media-mime'] || req.headers['content-type'] || 'video/mp4').split(';')[0];
      const extMap: Record<string, string> = {
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/quicktime': 'mov',
        'video/ogg': 'ogv',
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
      };
      const ext = extMap[mime] || (mime.startsWith('video/') ? 'mp4' : 'bin');
      const mediaId = `med_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const filename = `${mediaId}.${ext}`;
      const nowMs = Date.now();
      const parsedHeaderExpiry = Number(req.headers['x-expires-at']);
      const minFullExpiry = nowMs + VIDEO_EXPIRY_MS;
      const expiresAt =
        Number.isFinite(parsedHeaderExpiry) && parsedHeaderExpiry >= minFullExpiry
          ? parsedHeaderExpiry
          : minFullExpiry;

      fs.writeFileSync(path.join(MEDIA_DIR, filename), buf);
      fs.writeFileSync(
        path.join(MEDIA_DIR, `${filename}.meta.json`),
        JSON.stringify({ id: mediaId, filename, mime, size: buf.length, createdAtMs: nowMs, expiresAt })
      );

      return res.json({
        success: true,
        id: mediaId,
        url: `/api/media/${filename}`,
        expiresAt,
      });
    } catch (err) {
      console.error('Server media upload error:', err);
      return res.status(500).json({ error: 'Failed to store uploaded media' });
    }
  }
);

app.get('/api/media/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename || '');
  if (!safeName || !/^[a-zA-Z0-9_.\-]+$/.test(safeName)) {
    return res.status(400).send('Invalid filename');
  }
  const filePath = path.join(MEDIA_DIR, safeName);
  const metaPath = path.join(MEDIA_DIR, `${safeName}.meta.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Media not found or expired');
  }
  let mime = safeName.endsWith('.webm')
    ? 'video/webm'
    : safeName.endsWith('.mov')
    ? 'video/quicktime'
    : safeName.endsWith('.mp4')
    ? 'video/mp4'
    : 'application/octet-stream';
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (isServerVideoExpired(meta)) {
        fs.unlinkSync(filePath);
        fs.unlinkSync(metaPath);
        return res.status(404).send('Media expired');
      }
      if (meta.mime) mime = meta.mime;
    } catch {
      // ignore
    }
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=86400');

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10) || 0;
    const end = parts[1] ? Math.min(fileSize - 1, parseInt(parts[1], 10)) : fileSize - 1;
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunkSize,
      'Content-Type': mime,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mime,
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// Public Posts & Announcements Endpoints
app.get('/api/posts', (req, res) => {
  const activePosts = readPostsData().filter(
    (p: any) => !(p.mediaType === 'video' && isServerVideoExpired(p))
  );
  return res.json({ posts: activePosts });
});

app.post('/api/posts/sync', (req, res) => {
  const clientPosts = Array.isArray(req.body?.posts) ? req.body.posts : null;
  if (!clientPosts) {
    return res.status(400).json({ error: 'posts array required' });
  }
  const serverPosts = readPostsData();
  const adminBroadcastPosts = serverPosts.filter((p: any) => p.authorId === 'usr_jit_admin_system');
  const clientIds = new Set(clientPosts.map((p: any) => p.id));
  const merged = [
    ...adminBroadcastPosts.filter((ap: any) => !clientIds.has(ap.id)),
    ...clientPosts,
  ].filter((p: any) => !(p.mediaType === 'video' && isServerVideoExpired(p)));
  writePostsData(merged);
  return res.json({ success: true, posts: merged });
});

app.get('/api/announcements', async (req, res) => {
  const local = readAnnouncementsData();
  const cloud = await fetchNodeAnnouncements().catch(() => []);
  const byId = new Map<string, any>();
  for (const a of [...cloud, ...local]) {
    if (!a || !a.id) continue;
    if (a.mediaType === 'video' && isServerVideoExpired(a)) continue;
    if (!byId.has(a.id)) byId.set(a.id, a);
  }
  const merged = Array.from(byId.values()).sort(
    (a, b) => (b.createdAtMs || Date.parse(b.createdAt || '') || 0) - (a.createdAtMs || Date.parse(a.createdAt || '') || 0)
  );
  return res.json({ announcements: merged });
});

// 2. Lookup profile by contact phone (checks shared Firestore cloud database first)
app.get('/api/profiles/lookup/:phone', async (req, res) => {
  const phone = req.params.phone || '';
  try {
    const cloudLookup = await lookupCloudProfileByPhone(phone);
    if (cloudLookup.found && cloudLookup.profile) {
      if (cloudLookup.profile.status === 'deleted') {
        removeLocalMirror(phone, cloudLookup.profile.id);
        return res.json({ found: false });
      }
      upsertLocalMirror(cloudLookup.profile);
      return res.json({
        found: true,
        profile: cloudLookup.profile,
        suspended: cloudLookup.profile.status === 'suspended',
      });
    }
    if (cloudLookup.expired) {
      removeLocalMirror(phone);
      return res.json({ found: false, expired: true });
    }
  } catch (err) {
    console.warn('Firestore lookup fallback notice:', err);
  }

  const profiles = readProfiles();
  const matched = profiles.find((p: any) => isPhoneMatch(p.contactNumber, phone));
  if (matched) {
    if (matched.status === 'deleted') {
      return res.json({ found: false });
    }
    ensureCloudProfileSeeded(matched).catch(() => {});
    return res.json({
      found: true,
      profile: matched,
      suspended: matched.status === 'suspended',
    });
  }
  return res.json({ found: false });
});

// 3. User Login route: validates against Firestore cloud database & refreshes lastLogin timestamp
app.post('/api/profiles/login', async (req, res) => {
  const { contactNumber } = req.body;
  if (!contactNumber) {
    return res.status(400).json({ error: 'contactNumber is required' });
  }

  try {
    const cloudLogin = await loginCloudProfileByPhone(contactNumber);
    if (cloudLogin.suspended) {
      return res.status(403).json({
        success: false,
        suspended: true,
        error: `Account suspended: ${cloudLogin.suspendedReason || 'Please contact an administrator.'}`,
      });
    }
    if (cloudLogin.success && cloudLogin.profile) {
      upsertLocalMirror(cloudLogin.profile);
      return res.json({
        success: true,
        profile: cloudLogin.profile,
        message: 'Login successful. 180-day inactivity timer refreshed.',
      });
    }
    if (cloudLogin.expired) {
      removeLocalMirror(contactNumber);
      return res.status(404).json({
        success: false,
        error: 'Account expired due to 180 consecutive days of inactivity.',
      });
    }
  } catch (err) {
    console.warn('Firestore login fallback notice:', err);
  }

  const profiles = readProfiles();
  const idx = profiles.findIndex((p: any) => isPhoneMatch(p.contactNumber, contactNumber));

  if (idx === -1 || profiles[idx].status === 'deleted') {
    return res.status(404).json({
      success: false,
      error: 'Account not found or expired due to 180 consecutive days of inactivity.',
    });
  }

  if (profiles[idx].status === 'suspended') {
    return res.status(403).json({
      success: false,
      suspended: true,
      error: `Account suspended: ${profiles[idx].suspendedReason || 'Please contact an administrator.'}`,
    });
  }

  const nowIso = new Date().toISOString();
  profiles[idx].lastLoginAt = nowIso;
  profiles[idx].lastLogin = nowIso;
  writeProfiles(profiles);

  // Sync backfilled local profile to Firestore
  ensureCloudProfileSeeded(profiles[idx]).catch(() => {});

  return res.json({
    success: true,
    profile: profiles[idx],
    message: 'Login successful. 180-day inactivity timer refreshed.',
  });
});

// 4. Register or update profile (persists atomically to Firestore + local mirror)
app.post('/api/profiles', async (req, res) => {
  const rawPayload = req.body;
  if (!rawPayload || !rawPayload.contactNumber) {
    return res.status(400).json({ error: 'contactNumber is required' });
  }

  const explicitAvatarUpdate = Boolean(rawPayload.explicitAvatarUpdate);
  const explicitCoverRemoval = Boolean(rawPayload.explicitCoverRemoval) || rawPayload.coverUrl === '';
  const payload = { ...rawPayload };
  delete payload.explicitAvatarUpdate;
  delete payload.explicitCoverRemoval;

  const nowIso = new Date().toISOString();
  try {
    const existing = await lookupCloudProfileByPhone(payload.contactNumber);
    if (existing.found && existing.profile) {
      if (existing.profile.status === 'deleted') {
        return res.status(404).json({ success: false, error: 'Account has been deleted.' });
      }
      if (existing.profile.status === 'suspended') {
        return res.status(403).json({
          success: false,
          suspended: true,
          error: `Account suspended: ${existing.profile.suspendedReason || 'Contact administrator.'}`,
        });
      }
      const nextAvatarUrl = explicitAvatarUpdate
        ? payload.avatarUrl || '/assets/aistudio/image_e64e54f2.png'
        : payload.avatarUrl && !payload.avatarUrl.includes('image_e64e54f2.png')
        ? payload.avatarUrl
        : existing.profile.avatarUrl || payload.avatarUrl;

      const nextCoverUrl = explicitCoverRemoval
        ? undefined
        : payload.coverUrl !== undefined
        ? payload.coverUrl
        : existing.profile.coverUrl;

      const mergedProfile = {
        ...existing.profile,
        ...payload,
        id: existing.profile.id,
        joinedAt: existing.profile.joinedAt || payload.joinedAt || nowIso,
        lastLoginAt: nowIso,
        lastLogin: nowIso,
        stats: {
          friendsCount: existing.profile.stats?.friendsCount ?? payload.stats?.friendsCount ?? 0,
          followersCount: existing.profile.stats?.followersCount ?? payload.stats?.followersCount ?? 0,
          followingCount: existing.profile.stats?.followingCount ?? payload.stats?.followingCount ?? 0,
          postsCount: existing.profile.stats?.postsCount ?? payload.stats?.postsCount ?? 0,
          reelsCount: existing.profile.stats?.reelsCount ?? payload.stats?.reelsCount ?? 0,
          gamesPlayed: Math.max(existing.profile.stats?.gamesPlayed ?? 0, payload.stats?.gamesPlayed ?? 0),
          gamesWon: Math.max(existing.profile.stats?.gamesWon ?? 0, payload.stats?.gamesWon ?? 0),
          rewardPoints: Math.max(existing.profile.stats?.rewardPoints ?? 0, payload.stats?.rewardPoints ?? 0),
          streakDays: Math.max(existing.profile.stats?.streakDays ?? 1, payload.stats?.streakDays ?? 1),
        },
        avatarUrl: nextAvatarUrl,
        coverUrl: nextCoverUrl,
      };
      const cloudUpdates = {
        ...mergedProfile,
        ...(explicitCoverRemoval ? { coverUrl: '' } : {}),
      };
      await updateCloudProfile(mergedProfile, cloudUpdates);
      upsertLocalMirror(mergedProfile);
      return res.json({ success: true, profile: mergedProfile, isExisting: true });
    }

    const reg = await registerOrRecognizeCloudProfile(
      payload.contactNumber,
      payload.fullName || 'JIT Member',
      payload.address || 'JIT Campus',
      payload
    );
    upsertLocalMirror(reg.profile);
    return res.json({ success: true, profile: reg.profile, isExisting: reg.isExisting });
  } catch (err) {
    console.warn('Firestore register/update fallback notice:', err);
  }

  const profiles = readProfiles();
  const existingIdx = profiles.findIndex((p: any) =>
    isPhoneMatch(p.contactNumber, payload.contactNumber) || (payload.id && p.id === payload.id)
  );

  let resultProfile: any;
  let isExisting = false;

  if (existingIdx >= 0) {
    const existing = profiles[existingIdx];
    const nextAvatarUrl = explicitAvatarUpdate
      ? payload.avatarUrl || '/assets/aistudio/image_e64e54f2.png'
      : payload.avatarUrl && !payload.avatarUrl.includes('image_e64e54f2.png')
      ? payload.avatarUrl
      : existing.avatarUrl || payload.avatarUrl;
    const nextCoverUrl = explicitCoverRemoval
      ? undefined
      : payload.coverUrl !== undefined
      ? payload.coverUrl
      : existing.coverUrl;

    resultProfile = {
      ...existing,
      ...payload,
      id: existing.id || payload.id,
      joinedAt: existing.joinedAt || payload.joinedAt || nowIso,
      lastLoginAt: nowIso,
      lastLogin: nowIso,
      stats: {
        friendsCount: existing.stats?.friendsCount ?? payload.stats?.friendsCount ?? 0,
        followersCount: existing.stats?.followersCount ?? payload.stats?.followersCount ?? 0,
        followingCount: existing.stats?.followingCount ?? payload.stats?.followingCount ?? 0,
        postsCount: existing.stats?.postsCount ?? payload.stats?.postsCount ?? 0,
        reelsCount: existing.stats?.reelsCount ?? payload.stats?.reelsCount ?? 0,
        gamesPlayed: Math.max(existing.stats?.gamesPlayed ?? 0, payload.stats?.gamesPlayed ?? 0),
        gamesWon: Math.max(existing.stats?.gamesWon ?? 0, payload.stats?.gamesWon ?? 0),
        rewardPoints: Math.max(existing.stats?.rewardPoints ?? 0, payload.stats?.rewardPoints ?? 0),
        streakDays: Math.max(existing.stats?.streakDays ?? 1, payload.stats?.streakDays ?? 1),
      },
      avatarUrl: nextAvatarUrl,
      coverUrl: nextCoverUrl,
    };
    profiles[existingIdx] = resultProfile;
    isExisting = true;
  } else {
    resultProfile = {
      ...payload,
      id: payload.id || `usr_jit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      joinedAt: payload.joinedAt || nowIso,
      lastLoginAt: nowIso,
      lastLogin: nowIso,
      stats: {
        friendsCount: 0,
        followersCount: 0,
        followingCount: 0,
        postsCount: 0,
        reelsCount: 0,
        gamesPlayed: 0,
        gamesWon: 0,
        rewardPoints: 100,
        streakDays: 1,
        ...(payload.stats || {}),
      },
    };
    profiles.unshift(resultProfile);
    isExisting = false;
  }

  writeProfiles(profiles);
  return res.json({ success: true, profile: resultProfile, isExisting });
});

// 5. Bulk sync client profiles with server & Firestore cloud storage
app.post('/api/profiles/sync', async (req, res) => {
  const clientProfiles = Array.isArray(req.body.profiles) ? req.body.profiles : [];
  const serverProfiles = readProfiles();
  const map = new Map<string, any>();

  for (const sp of serverProfiles) {
    if (sp && sp.contactNumber && !isProfileExpired(sp) && sp.status !== 'deleted') {
      map.set(normalizeDigits(sp.contactNumber), sp);
    }
  }

  for (const cp of clientProfiles) {
    if (!cp || !cp.contactNumber || isProfileExpired(cp)) continue;
    const digits = normalizeDigits(cp.contactNumber);
    const existing = map.get(digits);
    if (existing?.status === 'deleted') continue;

    const adminOverrideNewer =
      existing?.adminPointsUpdatedAt &&
      new Date(existing.adminPointsUpdatedAt).getTime() >= new Date(cp.lastLoginAt || 0).getTime();

    const mergedOne = !existing
      ? cp
      : {
          ...existing,
          ...cp,
          id: existing.id || cp.id,
          status: existing.status || cp.status || 'active',
          suspendedReason: existing.suspendedReason || cp.suspendedReason,
          suspendedAt: existing.suspendedAt || cp.suspendedAt,
          adminPointsUpdatedAt: existing.adminPointsUpdatedAt,
          lastLoginAt: cp.lastLoginAt || existing.lastLoginAt || new Date().toISOString(),
          lastLogin: cp.lastLogin || existing.lastLogin || new Date().toISOString(),
          stats: {
            ...(existing.stats || {}),
            ...(cp.stats || {}),
            rewardPoints: adminOverrideNewer
              ? existing.stats?.rewardPoints ?? cp.stats?.rewardPoints ?? 100
              : Math.max(existing.stats?.rewardPoints ?? 0, cp.stats?.rewardPoints ?? 0),
            gamesPlayed: Math.max(existing.stats?.gamesPlayed ?? 0, cp.stats?.gamesPlayed ?? 0),
            gamesWon: Math.max(existing.stats?.gamesWon ?? 0, cp.stats?.gamesWon ?? 0),
            streakDays: Math.max(existing.stats?.streakDays ?? 1, cp.stats?.streakDays ?? 1),
          },
        };
    map.set(digits, mergedOne);
    const cloudSeed = { ...mergedOne };
    delete cloudSeed.adminPointsUpdatedAt;
    delete cloudSeed.source;
    ensureCloudProfileSeeded(cloudSeed).catch(() => {});
  }

  const merged = Array.from(map.values());
  writeProfiles(merged);
  return res.json({ success: true, profiles: merged });
});

// 6. Manual or test trigger for 180-day inactivity cleanup
app.post('/api/profiles/cleanup', (req, res) => {
  const beforeCount = readProfiles().length;
  const activeProfiles = readProfiles();
  res.json({
    success: true,
    activeCount: activeProfiles.length,
    purgedCount: Math.max(0, beforeCount - activeProfiles.length),
    inactivityThresholdDays: 180,
  });
});

// 7. Public Campus Gaming Leaderboard & Match History endpoints
app.get('/api/games/leaderboard', async (req, res) => {
  try {
    const cloudEntries = await fetchNodeLeaderboard(25);
    if (cloudEntries.length > 0) {
      return res.json({ leaderboard: cloudEntries });
    }
  } catch (err) {
    console.warn('Leaderboard route fallback notice:', err);
  }
  const fallbackProfiles = readProfiles()
    .map((p: any) => ({
      profileId: p.id,
      fullName: p.fullName,
      avatarUrl: p.avatarUrl,
      rewardPoints: p.stats?.rewardPoints ?? 100,
      gamesPlayed: p.stats?.gamesPlayed ?? 0,
      gamesWon: p.stats?.gamesWon ?? 0,
      streakDays: p.stats?.streakDays ?? 1,
    }))
    .sort((a: any, b: any) => b.rewardPoints - a.rewardPoints);
  return res.json({ leaderboard: fallbackProfiles });
});

app.get('/api/games/history', async (req, res) => {
  const profileId = typeof req.query.profileId === 'string' ? req.query.profileId : undefined;
  try {
    const history = await fetchNodeMatchHistory(profileId, 25);
    return res.json({ history });
  } catch {
    return res.json({ history: [] });
  }
});

// ----------------------------------------------------------------------------
// Hidden Admin Panel Authentication & Firebase Directory APIs
// ----------------------------------------------------------------------------

const ADMIN_CONFIG_FILE = path.join(DATA_DIR, 'admin-config.json');
const MASTER_ADMIN_PHONE = '8017462677';
const ADMIN_PHONE_AUTH_VERSION = 3;
const ADMIN_SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface AdminConfig {
  pinHash: string;
  salt: string;
  sessionSecret: string;
  phoneAuthVersion?: number;
  updatedAt: string;
}

function hashPin(pin: string, salt: string): string {
  return crypto.scryptSync(pin, salt, 64).toString('hex');
}

function readAdminConfig(): AdminConfig {
  try {
    if (fs.existsSync(ADMIN_CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(ADMIN_CONFIG_FILE, 'utf-8'));
      if (
        parsed?.pinHash &&
        parsed?.salt &&
        parsed?.sessionSecret &&
        parsed?.phoneAuthVersion === ADMIN_PHONE_AUTH_VERSION
      ) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Admin config read fallback:', err);
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const sessionSecret = crypto.randomBytes(32).toString('hex');
  const initialConfig: AdminConfig = {
    pinHash: hashPin(MASTER_ADMIN_PHONE, salt),
    salt,
    sessionSecret,
    phoneAuthVersion: ADMIN_PHONE_AUTH_VERSION,
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(ADMIN_CONFIG_FILE, JSON.stringify(initialConfig, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Admin config write notice:', err);
  }
  return initialConfig;
}

function verifyMasterAdminPhone(candidate: string): boolean {
  const inputBuf = Buffer.from(candidate, 'utf-8');
  const expectedBuf = Buffer.from(MASTER_ADMIN_PHONE, 'utf-8');
  if (inputBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(inputBuf, expectedBuf);
}

function signAdminToken(config: AdminConfig): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
  const payloadB64 = Buffer.from(
    JSON.stringify({ role: 'admin', exp: expiresAt, nonce: crypto.randomBytes(8).toString('hex') })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(payloadB64)
    .digest('base64url');
  return { token: `${payloadB64}.${sig}`, expiresAt };
}

function verifyAdminToken(token: string | undefined, config: AdminConfig): { valid: boolean; expiresAt?: number } {
  if (!token || !token.includes('.')) return { valid: false };
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return { valid: false };
  const expectedSig = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(payloadB64)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false };
  }
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (payload?.role !== 'admin' || typeof payload.exp !== 'number' || payload.exp <= Date.now()) {
      return { valid: false };
    }
    return { valid: true, expiresAt: payload.exp };
  } catch {
    return { valid: false };
  }
}

function extractBearerToken(req: express.Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return undefined;
}

const adminRateLimiter = new Map<string, { failures: number; lockedUntil: number }>();

app.post('/api/admin/auth', (req, res) => {
  const ip = req.ip || 'local';
  const now = Date.now();
  const limitEntry = adminRateLimiter.get(ip);
  if (limitEntry && limitEntry.lockedUntil > now) {
    const waitSec = Math.ceil((limitEntry.lockedUntil - now) / 1000);
    return res.status(429).json({
      success: false,
      error: `Too many incorrect attempts. Please wait ${waitSec}s before trying again.`,
    });
  }

  const rawCode =
    typeof req.body?.phone === 'string'
      ? req.body.phone
      : typeof req.body?.pin === 'string'
      ? req.body.pin
      : '';
  const accessCode = rawCode.trim();

  if (!accessCode || !verifyMasterAdminPhone(accessCode)) {
    const nextFailures = (limitEntry?.failures || 0) + 1;
    adminRateLimiter.set(ip, {
      failures: nextFailures >= 5 ? 0 : nextFailures,
      lockedUntil: nextFailures >= 5 ? now + 30 * 1000 : 0,
    });
    return res.status(401).json({
      success: false,
      error: 'Invalid Admin Access Code',
    });
  }

  adminRateLimiter.delete(ip);
  const config = readAdminConfig();
  const { token, expiresAt } = signAdminToken(config);
  return res.json({
    success: true,
    token,
    expiresAt,
  });
});

app.get('/api/admin/session', (req, res) => {
  const config = readAdminConfig();
  const check = verifyAdminToken(extractBearerToken(req), config);
  if (!check.valid) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({
    authenticated: true,
    expiresAt: check.expiresAt,
  });
});

app.post('/api/admin/change-pin', (req, res) => {
  return res.status(403).json({
    success: false,
    error: 'Administrator access is permanently locked to the authorized owner phone number.',
  });
});

function requireAdminSession(req: express.Request, res: express.Response): boolean {
  const config = readAdminConfig();
  const check = verifyAdminToken(extractBearerToken(req), config);
  if (!check.valid) {
    res.status(401).json({
      success: false,
      error: 'Invalid Admin Access Code',
    });
    return false;
  }
  return true;
}

app.get('/api/admin/users', async (req, res) => {
  if (!requireAdminSession(req, res)) return;

  try {
    const localMirror = readProfiles();
    const [{ profiles, firebaseCount }, cloudCounts] = await Promise.all([
      fetchAllCloudProfilesForAdmin(localMirror),
      fetchNodePlatformCounts().catch(() => ({ postsCount: 0, conversationsCount: 0, announcementsCount: 0 })),
    ]);

    const nowMs = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const dailyActiveUsers = profiles.filter((u: any) => {
      if (u.status === 'suspended' || u.status === 'deleted') return false;
      const ts = Date.parse(u.lastLoginAt || u.lastLogin || u.joinedAt || '');
      return !isNaN(ts) && nowMs - ts <= DAY_MS;
    }).length;

    const chats = readChatsData();
    const posts = readPostsData();
    const announcements = readAnnouncementsData();

    return res.json({
      success: true,
      users: profiles,
      totalCount: profiles.length,
      firebaseCount,
      analytics: {
        totalUsers: profiles.length,
        dailyActiveUsers,
        totalPosts: Math.max(posts.length, cloudCounts.postsCount),
        activeChatThreads: Math.max(chats.conversations.length, cloudCounts.conversationsCount) + rooms.size,
        totalMessages: chats.messages.length,
        activeAnnouncements: Math.max(announcements.length, cloudCounts.announcementsCount),
      },
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Admin users fetch error:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to load user records from Firebase.',
    });
  }
});

// Admin: Inspect full user profile, DMs, chat history, live game chats, posts, reels & match history
app.get('/api/admin/users/:userId/activity', async (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const userId = req.params.userId;

  try {
    const localMirror = readProfiles();
    const [{ profiles }, cloudActivity] = await Promise.all([
      fetchAllCloudProfilesForAdmin(localMirror),
      fetchNodeUserActivity(userId).catch(() => ({
        conversations: [] as any[],
        messages: [] as any[],
        posts: [] as any[],
        reels: [] as any[],
        matchHistory: [] as any[],
      })),
    ]);
    const targetUser = profiles.find((u) => u.id === userId) || localMirror.find((u) => u.id === userId);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'User account not found.' });
    }

    const chats = readChatsData();
    const lowerName = (targetUser.fullName || '').trim().toLowerCase();

    const localConversations = chats.conversations.filter((c: any) => {
      if (Array.isArray(c.participantIds) && c.participantIds.includes(userId)) return true;
      if (chats.messages.some((m: any) => m.conversationId === c.id && (m.senderId === userId || m.receiverId === userId))) return true;
      if (lowerName && typeof c.name === 'string' && c.name.toLowerCase().includes(lowerName)) return true;
      return false;
    });

    const convMap = new Map<string, any>();
    for (const c of [...cloudActivity.conversations, ...localConversations]) {
      if (c && c.id && !convMap.has(c.id)) {
        convMap.set(c.id, c);
      }
    }
    const mergedConversations = Array.from(convMap.values()).sort(
      (a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0)
    );

    const convIdSet = new Set(mergedConversations.map((c: any) => c.id));
    const localMessages = chats.messages.filter(
      (m: any) =>
        convIdSet.has(m.conversationId) ||
        m.senderId === userId ||
        m.receiverId === userId
    );

    const msgMap = new Map<string, any>();
    for (const m of [...cloudActivity.messages, ...localMessages]) {
      if (m && m.id && !msgMap.has(m.id)) {
        msgMap.set(m.id, m);
      }
    }
    const mergedMessages = Array.from(msgMap.values()).sort(
      (a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0)
    );

    const inGameMessages: Array<InGameMessage & { gameId: string }> = [];
    for (const room of rooms.values()) {
      const inRoom = room.players.some((p) => p.id === userId);
      for (const gm of room.messages) {
        if (inRoom || gm.senderId === userId) {
          inGameMessages.push({ ...gm, gameId: room.gameId });
        }
      }
    }

    const allPosts = readPostsData();
    const localPosts = allPosts.filter(
      (p: any) =>
        p.authorId === userId ||
        (Array.isArray(p.comments) &&
          p.comments.some(
            (c: any) =>
              c.authorId === userId ||
              (Array.isArray(c.replies) && c.replies.some((r: any) => r.authorId === userId))
          ))
    );

    const postMap = new Map<string, any>();
    for (const p of [...cloudActivity.posts, ...localPosts]) {
      if (p && p.id && !postMap.has(p.id)) {
        postMap.set(p.id, p);
      }
    }

    const matchHistory =
      cloudActivity.matchHistory.length > 0
        ? cloudActivity.matchHistory
        : await fetchNodeMatchHistory(userId, 25).catch(() => []);

    return res.json({
      success: true,
      user: targetUser,
      conversations: mergedConversations,
      messages: mergedMessages,
      inGameMessages,
      posts: Array.from(postMap.values()),
      reels: cloudActivity.reels || [],
      matchHistory,
    });
  } catch (err) {
    console.error('Admin user activity inspect error:', err);
    return res.status(500).json({ success: false, error: 'Failed to inspect user activity.' });
  }
});

// Admin: Edit or override user's display name, username, status, profile picture, cover photo, bio, and JIT Points
app.patch('/api/admin/users/:userId', async (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const userId = req.params.userId;

  try {
    const localMirror = readProfiles();
    const { profiles } = await fetchAllCloudProfilesForAdmin(localMirror);
    const baseProfile = profiles.find((u) => u.id === userId) || localMirror.find((u) => u.id === userId);
    if (!baseProfile) {
      return res.status(404).json({ success: false, error: 'User account not found.' });
    }

    const edits: {
      fullName?: string;
      username?: string;
      bio?: string;
      avatarUrl?: string;
      coverUrl?: string;
      status?: 'active' | 'suspended';
      rewardPoints?: number;
    } = {};

    if (typeof req.body?.fullName === 'string' && req.body.fullName.trim()) {
      edits.fullName = req.body.fullName.trim();
    }
    if (typeof req.body?.username === 'string' && req.body.username.trim()) {
      edits.username = req.body.username.trim();
    }
    if (typeof req.body?.bio === 'string') {
      edits.bio = req.body.bio;
    }
    if (typeof req.body?.avatarUrl === 'string' && req.body.avatarUrl.trim()) {
      edits.avatarUrl = req.body.avatarUrl.trim();
    }
    if (typeof req.body?.coverUrl === 'string') {
      edits.coverUrl = req.body.coverUrl;
    }
    if (req.body?.status === 'active' || req.body?.status === 'suspended') {
      edits.status = req.body.status;
    }
    if (req.body?.rewardPoints !== undefined && !isNaN(Number(req.body.rewardPoints))) {
      edits.rewardPoints = Math.min(1000000, Math.max(0, Math.floor(Number(req.body.rewardPoints))));
    }

    const updatedProfile = await adminOverrideCloudProfile(baseProfile, edits);
    const nowIso = new Date().toISOString();
    const mirrorRecord: any = {
      ...updatedProfile,
      ...(edits.rewardPoints !== undefined ? { adminPointsUpdatedAt: nowIso } : {}),
    };
    delete mirrorRecord.source;
    upsertLocalMirror(mirrorRecord);

    // Sync updated display name/avatar to persisted posts
    if (edits.fullName || edits.avatarUrl) {
      const posts = readPostsData();
      let postsChanged = false;
      const nextPosts = posts.map((p: any) => {
        if (p.authorId === userId) {
          postsChanged = true;
          return {
            ...p,
            authorName: updatedProfile.fullName,
            authorAvatar: updatedProfile.avatarUrl,
          };
        }
        return p;
      });
      if (postsChanged) writePostsData(nextPosts);
    }

    return res.json({
      success: true,
      user: updatedProfile,
    });
  } catch (err: any) {
    console.error('Admin user edit error:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to update user profile in Firestore.',
    });
  }
});

// Admin: User moderation (suspend / unblock / delete)
app.post('/api/admin/users/:userId/moderate', async (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const userId = req.params.userId;
  const action = req.body?.action;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;

  if (!['suspend', 'unblock', 'delete'].includes(action)) {
    return res.status(400).json({ success: false, error: 'Invalid moderation action.' });
  }

  try {
    const localMirror = readProfiles();
    const { profiles } = await fetchAllCloudProfilesForAdmin(localMirror);
    const baseProfile = profiles.find((u) => u.id === userId) || localMirror.find((u) => u.id === userId);
    if (!baseProfile) {
      return res.status(404).json({ success: false, error: 'User account not found.' });
    }

    const moderated = await adminModerateCloudProfile(baseProfile, action, reason);

    if (action === 'delete') {
      removeLocalMirror(baseProfile.contactNumber || '', baseProfile.id);
      const posts = readPostsData();
      writePostsData(posts.filter((p: any) => p.authorId !== baseProfile.id));
      const chats = readChatsData();
      chats.conversations = chats.conversations.map((c: any) => ({
        ...c,
        participantIds: Array.isArray(c.participantIds)
          ? c.participantIds.filter((pid: string) => pid !== baseProfile.id)
          : [],
      }));
      writeChatsData(chats);
    } else {
      const cleanMirror: any = { ...moderated };
      delete cleanMirror.source;
      upsertLocalMirror(cleanMirror);
    }

    return res.json({
      success: true,
      action,
      user: moderated,
    });
  } catch (err) {
    console.error('Admin moderation error:', err);
    return res.status(500).json({ success: false, error: 'Failed to apply moderation action.' });
  }
});

// Admin: Delete user post, reel, or game match log
app.delete('/api/admin/posts/:postId', async (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const postId = req.params.postId;
  try {
    await deleteNodePost(postId).catch(() => {});
    const posts = readPostsData();
    writePostsData(posts.filter((p: any) => p.id !== postId));
    return res.json({ success: true, id: postId });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to delete post.' });
  }
});

app.delete('/api/admin/reels/:reelId', async (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const reelId = req.params.reelId;
  try {
    await deleteNodeReel(reelId);
    return res.json({ success: true, id: reelId });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to delete reel.' });
  }
});

app.delete('/api/admin/matches/:matchId', async (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const matchId = req.params.matchId;
  try {
    await deleteNodeMatchRecord(matchId);
    return res.json({ success: true, id: matchId });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to delete game log.' });
  }
});

// Admin: Global Announcement Broadcast System (with Photo & Video Attachments + Firestore Sync)
app.get('/api/admin/announcements', async (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const local = readAnnouncementsData();
  const cloud = await fetchNodeAnnouncements().catch(() => []);
  const byId = new Map<string, any>();
  for (const a of [...cloud, ...local]) {
    if (!a || !a.id) continue;
    if (a.mediaType === 'video' && isServerVideoExpired(a)) continue;
    if (!byId.has(a.id)) byId.set(a.id, a);
  }
  const merged = Array.from(byId.values()).sort(
    (a, b) => (b.createdAtMs || Date.parse(b.createdAt || '') || 0) - (a.createdAtMs || Date.parse(a.createdAt || '') || 0)
  );
  return res.json({ success: true, announcements: merged });
});

app.post('/api/admin/announcements', async (req, res) => {
  if (!requireAdminSession(req, res)) return;

  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const priority = ['info', 'important', 'event'].includes(req.body?.priority)
    ? req.body.priority
    : 'important';
  const alsoPostToFeed = req.body?.alsoPostToFeed !== false;
  const mediaUrl = typeof req.body?.mediaUrl === 'string' && req.body.mediaUrl.trim() ? req.body.mediaUrl.trim() : undefined;
  const mediaType: 'image' | 'video' | 'none' =
    req.body?.mediaType === 'image' || req.body?.mediaType === 'video' ? req.body.mediaType : 'none';
  const thumbnailUrl =
    typeof req.body?.thumbnailUrl === 'string' && req.body.thumbnailUrl.trim()
      ? req.body.thumbnailUrl.trim()
      : undefined;

  if (!title || !message) {
    return res.status(400).json({
      success: false,
      error: 'Announcement title and message are required.',
    });
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const clientId =
    typeof req.body?.id === 'string' && /^ann_[a-zA-Z0-9_\-]{6,50}$/.test(req.body.id)
      ? req.body.id
      : null;
  const expiresAt =
    mediaType === 'video'
      ? Number(req.body?.expiresAt) || nowMs + VIDEO_EXPIRY_MS
      : undefined;

  const announcement: any = {
    id: clientId || `ann_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
    title: title.slice(0, 140),
    message: message.slice(0, 1000),
    priority,
    authorName: 'JIT GROUP Admin',
    createdAt: nowIso,
    createdAtMs: nowMs,
    ...(mediaUrl ? { mediaUrl, mediaType } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(typeof expiresAt === 'number' ? { expiresAt } : {}),
  };

  let feedPost: any = undefined;
  if (alsoPostToFeed) {
    feedPost = {
      id: `post_ann_${announcement.id}`,
      authorId: 'usr_jit_admin_system',
      authorName: 'JIT GROUP Official Notice',
      authorAvatar: '/assets/aistudio/image_e64e54f2.png',
      authorHandle: '@jit_announcement',
      content: `${announcement.title}\n\n${announcement.message}`,
      mediaUrls: mediaUrl ? [mediaUrl] : [],
      mediaType: mediaUrl ? mediaType : 'none',
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      createdAt: 'Just now',
      createdAtMs: nowMs,
      ...(typeof expiresAt === 'number' ? { expiresAt } : {}),
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      isLiked: false,
      isSaved: false,
      likedBy: [],
      comments: [],
      category: 'all',
    };
  }

  await publishNodeAnnouncement(announcement, feedPost).catch((err) => {
    console.warn('publishNodeAnnouncement notice:', err);
  });

  const list = readAnnouncementsData();
  list.unshift(announcement);
  writeAnnouncementsData(list.slice(0, 50));

  if (feedPost) {
    const posts = readPostsData();
    posts.unshift(feedPost);
    writePostsData(posts);
  }

  return res.json({
    success: true,
    announcement,
    announcements: list.slice(0, 50),
  });
});

app.delete('/api/admin/announcements/:id', async (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const id = req.params.id;

  await deleteNodeAnnouncement(id).catch(() => {});

  const list = readAnnouncementsData();
  const next = list.filter((a: any) => a.id !== id);
  writeAnnouncementsData(next);

  const posts = readPostsData();
  const nextPosts = posts.filter((p: any) => p.id !== `post_ann_${id}`);
  if (nextPosts.length !== posts.length) {
    writePostsData(nextPosts);
  }

  return res.json({ success: true, announcements: next });
});

// ----------------------------------------------------------------------------
// Server-Side Gemini AI API Endpoints (/api/ai/*)
// ----------------------------------------------------------------------------

// 1. JIT AI Chat Companion
app.post('/api/ai/chat', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const userName = typeof req.body?.userName === 'string' ? req.body.userName : undefined;
  const mode =
    req.body?.mode === 'studies' || req.body?.mode === 'tech' ? req.body.mode : 'general';

  if (!message) {
    return res.status(400).json({ error: 'Message text is required.' });
  }

  try {
    const result = await runJitAiChat({ message, history, userName, mode });
    return res.json({
      reply: result.reply,
      model: result.model,
      createdAtMs: Date.now(),
    });
  } catch (err: any) {
    const msg = err?.message || 'AI chat generation failed.';
    const status = msg.includes('not configured') ? 503 : 502;
    console.warn('[/api/ai/chat] error:', msg);
    return res.status(status).json({ error: msg, code: status === 503 ? 'GEMINI_UNAVAILABLE' : 'AI_ERROR' });
  }
});

// 2. AI Smart Content & Caption Generator (Feed Posts & Short Reels)
app.post('/api/ai/captions', async (req, res) => {
  const topic = typeof req.body?.topic === 'string' ? req.body.topic : '';
  const existingText = typeof req.body?.existingText === 'string' ? req.body.existingText : '';
  const contentType = req.body?.contentType === 'reel' ? 'reel' : 'post';
  const tone = typeof req.body?.tone === 'string' ? req.body.tone : 'engaging';

  try {
    const result = await generateSmartCaptions({ topic, existingText, contentType, tone });
    return res.json(result);
  } catch (err: any) {
    const msg = err?.message || 'Smart caption generation failed.';
    const status = msg.includes('not configured') ? 503 : 502;
    console.warn('[/api/ai/captions] error:', msg);
    return res.status(status).json({ error: msg, code: status === 503 ? 'GEMINI_UNAVAILABLE' : 'AI_ERROR' });
  }
});

// 3. AI Quiz & Trivia Bot Generator (Strict 70% CS / 30% General Trivia)
app.post('/api/ai/quiz', async (req, res) => {
  const count = Number(req.body?.count) || 10;
  const difficulty =
    req.body?.difficulty === 'easy' || req.body?.difficulty === 'hard'
      ? req.body.difficulty
      : 'medium';
  const excludeQuestions = Array.isArray(req.body?.excludeQuestions) ? req.body.excludeQuestions : [];
  const topicHint = typeof req.body?.topicHint === 'string' ? req.body.topicHint : undefined;

  try {
    const result = await generateAiQuizRound({
      count,
      difficulty,
      excludeQuestions,
      topicHint,
    });
    return res.json(result);
  } catch (err: any) {
    const msg = err?.message || 'AI quiz generation failed.';
    const status = msg.includes('not configured') ? 503 : 502;
    console.warn('[/api/ai/quiz] error:', msg);
    return res.status(status).json({ error: msg, code: status === 503 ? 'GEMINI_UNAVAILABLE' : 'AI_ERROR' });
  }
});

// 4. Advanced Content Moderation Filter (Comments & Public/Game Room Chats Only)
app.post('/api/ai/moderate', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  const context =
    req.body?.context === 'room_chat' || req.body?.context === 'post' ? req.body.context : 'comment';

  if (!text.trim()) {
    return res.json({
      allowed: true,
      flagged: false,
      severity: 'none',
      category: 'clean',
      reason: '',
      source: 'heuristic',
    });
  }

  try {
    const verdict = await moderatePublicText({ text, context });
    return res.json(verdict);
  } catch (err: any) {
    console.warn('[/api/ai/moderate] fallback to heuristic due to Gemini error:', err?.message);
    return res.json(runFastHeuristicModeration(text));
  }
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
