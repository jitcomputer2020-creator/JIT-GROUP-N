/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type GameMode = 'friend' | 'random' | 'open_group' | 'ai';
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
  joinedAtMs?: number;
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

export interface RoomReaction {
  id: string;
  emoji: string;
  senderId: string;
  senderName: string;
  createdAtMs: number;
}

export interface TruthAndDareHistoryItem {
  id: string;
  round: number;
  playerId: string;
  playerName: string;
  choiceType: 'truth' | 'dare';
  promptSource: 'system' | 'custom';
  promptText: string;
  customAuthor?: string;
  status: 'completed' | 'skipped';
  timestamp: string;
}

export interface TruthAndDareState {
  round: number;
  phase: 'spinning' | 'choosing' | 'writing_custom' | 'performing' | 'round_complete';
  activePlayerId: string;
  activePlayerName: string;
  activePlayerAvatar?: string;
  choiceType: 'truth' | 'dare' | null;
  promptSource: 'system' | 'custom' | null;
  promptText: string;
  customAuthorName?: string;
  history: TruthAndDareHistoryItem[];
  updatedAtMs: number;
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
  isPublicMatch?: boolean;
  isOpenGroup?: boolean;
  activeSeatLimit?: number;
  players: RoomPlayer[];
  waitingPlayers?: RoomPlayer[];
  reactions?: RoomReaction[];
  mutedVoiceIds?: string[];
  mutedChatIds?: string[];
  gameState: any;
  currentTurn: string;
  messages: InGameChatMessage[];
  callState: InGameCallState | null;
}
