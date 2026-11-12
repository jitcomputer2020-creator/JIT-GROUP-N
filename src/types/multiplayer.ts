/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type GameMode = 'friend' | 'random' | 'ai';
export type AIDifficulty = 'easy' | 'medium' | 'hard';

export interface RoomPlayer {
  id: string;
  name: string;
  avatar: string;
  isHost: boolean;
  isReady: boolean;
  color?: string;
  score?: number;
  isMuted?: boolean;
}

export interface InGameChatMessage {
  id: string;
  roomCode: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  text?: string;
  imageUrl?: string;
  timestamp: string;
}

export interface InGameCallState {
  isActive: boolean;
  callType: 'voice' | 'video';
  hostId: string;
  participants: string[];
  localStream?: MediaStream | null;
  remoteStreams?: Record<string, MediaStream>;
  isMicMuted: boolean;
  isVideoMuted: boolean;
  cameraFacingMode: 'user' | 'environment';
}

export interface MultiplayerRoom {
  roomCode: string;
  gameId: string;
  hostId: string;
  createdAt: number;
  status: 'waiting' | 'in_game' | 'finished';
  maxPlayers: number;
  players: RoomPlayer[];
  gameState: any;
  currentTurn: string;
  messages: InGameChatMessage[];
  callState: InGameCallState | null;
}
