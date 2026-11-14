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
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  testFirestoreConnection,
  lookupCloudProfileByPhone,
  loginCloudProfileByPhone,
  registerOrRecognizeCloudProfile,
  updateCloudProfile,
  ensureCloudProfileSeeded,
} from './src/lib/firebase.ts';
import { INITIAL_USER, INITIAL_FRIENDS } from './src/services/mockData.ts';

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

// 2. Lookup profile by contact phone (checks shared Firestore cloud database first)
app.get('/api/profiles/lookup/:phone', async (req, res) => {
  const phone = req.params.phone || '';
  try {
    const cloudLookup = await lookupCloudProfileByPhone(phone);
    if (cloudLookup.found && cloudLookup.profile) {
      upsertLocalMirror(cloudLookup.profile);
      return res.json({ found: true, profile: cloudLookup.profile });
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
    // Backfill to Firestore so future cross-browser lookups succeed
    ensureCloudProfileSeeded(matched).catch(() => {});
    return res.json({ found: true, profile: matched });
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

  if (idx === -1) {
    return res.status(404).json({
      success: false,
      error: 'Account not found or expired due to 180 consecutive days of inactivity.',
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
  const payload = req.body;
  if (!payload || !payload.contactNumber) {
    return res.status(400).json({ error: 'contactNumber is required' });
  }

  const nowIso = new Date().toISOString();
  try {
    const existing = await lookupCloudProfileByPhone(payload.contactNumber);
    if (existing.found && existing.profile) {
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
        avatarUrl:
          payload.avatarUrl && !payload.avatarUrl.includes('image_e64e54f2.png')
            ? payload.avatarUrl
            : existing.profile.avatarUrl || payload.avatarUrl,
        coverUrl: payload.coverUrl || existing.profile.coverUrl,
      };
      await updateCloudProfile(mergedProfile, mergedProfile);
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
      avatarUrl:
        payload.avatarUrl && !payload.avatarUrl.includes('image_e64e54f2.png')
          ? payload.avatarUrl
          : (existing.avatarUrl || payload.avatarUrl),
      coverUrl: payload.coverUrl || existing.coverUrl,
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
    if (sp && sp.contactNumber && !isProfileExpired(sp)) {
      map.set(normalizeDigits(sp.contactNumber), sp);
    }
  }

  for (const cp of clientProfiles) {
    if (!cp || !cp.contactNumber || isProfileExpired(cp)) continue;
    const digits = normalizeDigits(cp.contactNumber);
    const existing = map.get(digits);
    const mergedOne = !existing
      ? cp
      : {
          ...existing,
          ...cp,
          id: existing.id || cp.id,
          lastLoginAt: cp.lastLoginAt || existing.lastLoginAt || new Date().toISOString(),
          lastLogin: cp.lastLogin || existing.lastLogin || new Date().toISOString(),
          stats: {
            ...(existing.stats || {}),
            ...(cp.stats || {}),
            rewardPoints: Math.max(existing.stats?.rewardPoints ?? 0, cp.stats?.rewardPoints ?? 0),
            gamesPlayed: Math.max(existing.stats?.gamesPlayed ?? 0, cp.stats?.gamesPlayed ?? 0),
            gamesWon: Math.max(existing.stats?.gamesWon ?? 0, cp.stats?.gamesWon ?? 0),
            streakDays: Math.max(existing.stats?.streakDays ?? 1, cp.stats?.streakDays ?? 1),
          },
        };
    map.set(digits, mergedOne);
    ensureCloudProfileSeeded(mergedOne).catch(() => {});
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
