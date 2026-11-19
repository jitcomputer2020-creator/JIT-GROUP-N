/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type GameMode = 'friend' | 'random' | 'open_group' | 'ai';
export type AIDifficulty = 'easy' | 'medium' | 'hard';

export interface RoomPlayer {
  id: string;
  authUid?: string;
  name: string;
  avatar: string;
  isHost: boolean;
  isReady: boolean;
  color?: string;
  score?: number;
  isMuted?: boolean;
  joinedAtMs?: number;
}

export interface CarromSyncedCoin {
  id: string;
  x: number;
  y: number;
  r: number;
  type: 'white' | 'black' | 'queen' | 'striker';
  pocketed: boolean;
}

export interface CarromSyncedState {
  coins: CarromSyncedCoin[];
  striker?: { x: number; angle: number; power: number };
  turn: 'player' | 'opponent';
  scores: { player: number; opponent: number; queenHolder: string };
  statusLog: string[];
  winnerMsg: string | null;
  finished: boolean;
  currentTurn?: string;
  moveId?: string;
  moveSeq?: number;
  byPlayerId?: string;
}

export interface QuizSyncedState {
  questions: Array<{
    q: string;
    options: string[];
    answer: number;
    category: string;
    domain: 'cs' | 'general';
    explanation?: string;
  }>;
  source: 'ai' | 'curated-70-30';
  index: number;
  currentQuestionIndex?: number;
  questionSeed?: number;
  scores: Record<string, number>;
  answersByQ: Record<number, Record<string, number | null>>;
  finished: boolean;
  winnerId?: string | null;
  moveId?: string;
  moveSeq?: number;
  byPlayerId?: string;
}

export interface SpinSyncedState {
  rotation: number;
  spinAngle: number;
  targetAngle?: number;
  isSpinning: boolean;
  spinResult: { label: string; points: number; color?: string } | null;
  lastWinnerId?: string;
  lastWinnerName?: string;
  scores: Record<string, number>;
  spinsUsedByPlayer: Record<string, number>;
  round: number;
  currentTurn?: string;
  moveId?: string;
  moveSeq?: number;
  byPlayerId?: string;
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
  selectedPlayerId?: string;
  activePlayerName: string;
  activePlayerAvatar?: string;
  choiceType: 'truth' | 'dare' | null;
  promptType?: 'truth' | 'dare' | null;
  promptSource: 'system' | 'custom' | null;
  promptText: string;
  currentPromptText?: string;
  customAuthorName?: string;
  mutedVoiceIds?: string[];
  mutedChatIds?: string[];
  currentTurn?: string;
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

export interface RoomLastMove {
  action: string;
  byPlayerId: string;
  byAuthUid?: string | null;
  moveSeq?: number;
  moveId?: string;
  summary?: string;
  timestampMs: number;
}

export interface MultiplayerRoom {
  roomCode: string;
  roomId?: string;
  gameId: string;
  gameType?: string;
  hostId: string;
  player1?: string;
  player1Id?: string;
  player1AuthUid?: string | null;
  player1Name?: string;
  player2?: string | null;
  player2Id?: string | null;
  player2AuthUid?: string | null;
  player2Name?: string;
  createdAt: number;
  lastUpdated?: number;
  status: 'waiting' | 'active' | 'in_game' | 'finished';
  maxPlayers: number;
  isPublicMatch?: boolean;
  isOpenGroup?: boolean;
  activeSeatLimit?: number;
  players: RoomPlayer[];
  waitingPlayers?: RoomPlayer[];
  reactions?: RoomReaction[];
  mutedVoiceIds?: string[];
  mutedChatIds?: string[];
  boardState?: any;
  gameState: any;
  currentTurn: string;
  diceRoll?: number | null;
  lastMove?: RoomLastMove | null;
  messages: InGameChatMessage[];
  callState: InGameCallState | null;
}
