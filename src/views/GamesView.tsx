/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JIT GROUP - Upgraded Multiplayer & Solo Gaming Arena
 * 7 Interactive Games: Ludo, Tic Tac Toe, Quiz Battle, Chess, Snake & Ladder, Carrom, and Lucky Spin Wheel.
 * Features: Real rule validation, AI difficulty modes, 4-digit room multiplayer, live chat,
 * voice/video calls, Web Audio FX, and live Firebase JIT Points + Global Leaderboard.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { GameId, NavTab } from '../types';
import {
  GameMode,
  AIDifficulty,
  MultiplayerRoom,
  InGameChatMessage,
  TruthAndDareState,
} from '../types/multiplayer';
import { APP_CONFIG } from '../constants/branding';
import { multiplayerSocket } from '../services/multiplayerSocket';
import {
  createFirestoreGameRoom,
  joinFirestoreGameRoom,
  quickMatchFirestoreRoom,
  findOtherWaitingQuickMatchRoom,
  startFirestoreGameRoom,
  pushFirestoreGameMove,
  rematchFirestoreGameRoom,
  sendFirestoreRoomChat,
  sendFirestoreRoomReaction,
  hostUpdateRoomModeration,
  hostRotateRoomPlayers,
  kickOrLeaveFirestoreRoom,
  subscribeToGameRoom,
} from '../lib/firebase';
import {
  checkTicTacToeWinner,
  getTicTacToeAIMove,
  getPieceColor,
  getLegalMovesForSquare,
  applyChessMoveToBoard,
  getChessGameStatus,
  getChessAIMove,
  ChessMove,
  pickShuffledQuizQuestions,
  getQuizAIMove,
  QuizQuestion,
  ludoLocalToGlobal,
  LUDO_SAFE_GLOBAL_INDICES,
  getLegalLudoTokenIndices,
  chooseLudoAIToken,
} from '../services/gameAIEngine';
import { fetchAiQuizRound } from '../services/aiClient';
import { soundFx } from '../utils/soundFx';

import { GameModeSelectModal } from '../components/games/GameModeSelectModal';
import { RoomLobbyModal } from '../components/games/RoomLobbyModal';
import { InGameChatDrawer } from '../components/games/InGameChatDrawer';
import { InGameCallOverlay } from '../components/games/InGameCallOverlay';
import { GameActionBar } from '../components/games/GameActionBar';
import { InGameVoiceHud } from '../components/games/InGameVoiceHud';
import {
  FloatingReactionsOverlay,
  FloatingReactionItem,
  QuickReactionBar,
} from '../components/games/FloatingReactionsOverlay';
import { MatchmakingQueueModal } from '../components/games/MatchmakingQueueModal';
import { HostRoomControlPanel } from '../components/games/HostRoomControlPanel';
import { TruthAndDareGame } from '../components/games/TruthAndDareGame';
import { GameLogo } from '../components/games/GameLogo';
import { LudoBoard, LUDO_COLORS } from '../components/games/LudoBoard';
import { CarromBoard } from '../components/games/CarromBoard';
import { SpinWheelGame } from '../components/games/SpinWheelGame';
import { LeaderboardPanel } from '../components/games/LeaderboardPanel';
import { useRoomVoiceChat } from '../hooks/useRoomVoiceChat';

import {
  Gamepad2,
  Trophy,
  RotateCcw,
  Sparkles,
  Info,
  X,
  Bot,
  Timer,
  ChevronRight,
  Wifi,
  WifiOff,
  Volume2,
  VolumeX,
  Crown,
  Loader2,
} from 'lucide-react';

interface GamesViewProps {
  onNavigate: (tab: NavTab) => void;
}

const INITIAL_CHESS_BOARD: (string | null)[][] = [
  ['♜', '♞', '♝', '♛', '♚', '♝', '♞', '♜'],
  ['♟', '♟', '♟', '♟', '♟', '♟', '♟', '♟'],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  ['♙', '♙', '♙', '♙', '♙', '♙', '♙', '♙'],
  ['♖', '♘', '♗', '♕', '♔', '♗', '♘', '♖'],
];

const SL_SNAKES: Record<number, number> = { 98: 28, 62: 19, 47: 26, 29: 9 };
const SL_LADDERS: Record<number, number> = { 4: 14, 21: 42, 51: 67, 72: 91 };

function getSlCenterPct(squareNum: number): { x: number; y: number } {
  const zeroBased = squareNum - 1;
  const rowFromBottom = Math.floor(zeroBased / 10);
  const colInRow = zeroBased % 10;
  const visualCol = rowFromBottom % 2 === 0 ? colInRow : 9 - colInRow;
  const visualRow = 9 - rowFromBottom;
  return {
    x: visualCol * 10 + 5,
    y: visualRow * 10 + 5,
  };
}

export const GamesView: React.FC<GamesViewProps> = ({ onNavigate }) => {
  const { currentUser, awardGameResult } = useAuth();

  // Top-level navigation inside Games Hub
  const [subView, setSubView] = useState<'play' | 'leaderboard'>('play');
  const [soundMuted, setSoundMuted] = useState(false);
  const [rewardBanner, setRewardBanner] = useState<string | null>(null);

  // Selected Game & Multiplayer Mode State
  const [selectedGame, setSelectedGame] = useState<GameId>('tictactoe');
  const [gameMode, setGameMode] = useState<GameMode>('ai');
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('medium');
  const [isModeSelectOpen, setIsModeSelectOpen] = useState(false);
  const [isLobbyOpen, setIsLobbyOpen] = useState(false);
  const [isMatchmakingOpen, setIsMatchmakingOpen] = useState(false);
  const [isHostPanelOpen, setIsHostPanelOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [instructionsGame, setInstructionsGame] = useState<GameId | null>(null);

  // Room state
  const [currentRoom, setCurrentRoom] = useState<MultiplayerRoom | null>(null);
  const currentRoomRef = useRef<MultiplayerRoom | null>(null);
  const roomUnsubRef = useRef<(() => void) | null>(null);
  const roomMoveCounterRef = useRef<number>(0);
  const appliedMoveIdsRef = useRef<Set<string>>(new Set());
  const seenReactionIdsRef = useRef<Set<string>>(new Set());
  const lastStartIdRef = useRef<string | null>(null);
  const prevRoomStatusRef = useRef<string | null>(null);
  const isChatOpenRef = useRef<boolean>(false);
  const [waitingSecondsLeft, setWaitingSecondsLeft] = useState<number>(30);
  const roomWaitStartRef = useRef<number>(Date.now());
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isRoomSubmitting, setIsRoomSubmitting] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);

  // Floating Emoji Reactions & Truth & Dare state
  const [floatingReactions, setFloatingReactions] = useState<FloatingReactionItem[]>([]);
  const [truthDareState, setTruthDareState] = useState<TruthAndDareState | null>(null);

  useEffect(() => {
    isChatOpenRef.current = isChatOpen;
  }, [isChatOpen]);

  useEffect(() => {
    if (!currentRoom || currentRoom.status !== 'waiting' || currentRoom.players.length >= 2) {
      setWaitingSecondsLeft(30);
      return;
    }
    roomWaitStartRef.current = currentRoom.createdAt || Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - roomWaitStartRef.current) / 1000);
      setWaitingSecondsLeft(Math.max(0, 30 - elapsed));
    }, 500);
    return () => window.clearInterval(timer);
  }, [currentRoom?.roomCode, currentRoom?.status, currentRoom?.players.length, currentRoom?.createdAt]);

  const guestPlayerId = useMemo(() => {
    if (typeof window === 'undefined') return 'usr_jit_guest_001';
    const existing = window.sessionStorage.getItem('jit_guest_player_id');
    if (existing && existing.length >= 8) return existing;
    const generated = `usr_guest_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    window.sessionStorage.setItem('jit_guest_player_id', generated);
    return generated;
  }, []);

  const activePlayer = useMemo(
    () => ({
      id: currentUser?.id || guestPlayerId,
      name: currentUser?.fullName || 'Campus Guest',
      avatar: currentUser?.avatarUrl || APP_CONFIG.logoUrl,
    }),
    [currentUser?.id, currentUser?.fullName, currentUser?.avatarUrl, guestPlayerId]
  );

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  const isRoomHost = Boolean(currentRoom && currentRoom.hostId === activePlayer.id);
  const isWaitingSpectator = Boolean(
    currentRoom && (currentRoom.waitingPlayers || []).some((p) => p.id === activePlayer.id)
  );
  const isSeatedActivePlayer = Boolean(
    !currentRoom || currentRoom.players.some((p) => p.id === activePlayer.id)
  );
  const isHostMutedMyVoice = Boolean(
    currentRoom && (currentRoom.mutedVoiceIds || []).includes(activePlayer.id)
  );
  const isHostMutedMyChat = Boolean(
    currentRoom && (currentRoom.mutedChatIds || []).includes(activePlayer.id)
  );
  const allRoomParticipants = useMemo(
    () =>
      currentRoom
        ? [...currentRoom.players, ...(currentRoom.waitingPlayers || [])]
        : [],
    [currentRoom]
  );

  // In-Game Chat & Call state
  const [chatMessages, setChatMessages] = useState<InGameChatMessage[]>([]);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [mutedPlayerIds, setMutedPlayerIds] = useState<string[]>([]);
  const [activeCallType, setActiveCallType] = useState<'voice' | 'video' | null>(null);

  // Real-time WebRTC Live Voice Chat HUD (available to both active players & waiting seat spectators!)
  const voiceChat = useRoomVoiceChat({
    roomCode: currentRoom?.roomCode,
    localPlayer: activePlayer,
    enabled: subView === 'play',
    isHostMutedMic: isHostMutedMyVoice,
    hostMutedVoiceIds: currentRoom?.mutedVoiceIds || [],
  });

  // Match award duplicate guard
  const awardedMatchRef = useRef<Record<string, boolean>>({});
  const aiTimersRef = useRef<number[]>([]);

  const registerAiTimer = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    aiTimersRef.current.push(id);
    return id;
  }, []);

  const clearAiTimers = useCallback(() => {
    aiTimersRef.current.forEach((id) => window.clearTimeout(id));
    aiTimersRef.current = [];
  }, []);

  useEffect(() => {
    return () => clearAiTimers();
  }, [clearAiTimers]);

  const spawnFloatingReaction = useCallback((id: string, emoji: string, senderName: string) => {
    if (seenReactionIdsRef.current.has(id)) return;
    seenReactionIdsRef.current.add(id);
    if (seenReactionIdsRef.current.size > 120) {
      const oldest = seenReactionIdsRef.current.values().next().value;
      if (oldest) seenReactionIdsRef.current.delete(oldest);
    }
    const leftPct = 14 + Math.floor(Math.random() * 70);
    setFloatingReactions((prev) => [...prev.slice(-16), { id, emoji, senderName, leftPct }]);
    window.setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((item) => item.id !== id));
    }, 2500);
  }, []);

  const showRewardToast = useCallback((msg: string) => {
    setRewardBanner(msg);
    window.setTimeout(() => {
      setRewardBanner((prev) => (prev === msg ? null : prev));
    }, 4500);
  }, []);

  const triggerGameAward = useCallback(
    async (
      matchKey: string,
      params: {
        gameId: GameId;
        gameName: string;
        mode: GameMode | 'solo';
        outcome: 'win' | 'loss' | 'draw' | 'spin';
        pointsEarned: number;
        scoreSummary: string;
      }
    ) => {
      if (params.outcome !== 'spin') {
        if (awardedMatchRef.current[matchKey]) return;
        awardedMatchRef.current[matchKey] = true;
      }
      const firestoreSafeMode: 'ai' | 'friend' | 'random' | 'solo' =
        params.mode === 'open_group' ? 'friend' : params.mode;
      const res = await awardGameResult({
        ...params,
        mode: firestoreSafeMode,
      });
      if (res.success && res.pointsAdded > 0) {
        showRewardToast(
          `+${res.pointsAdded} JIT Points earned in ${params.gameName}! Balance: ${res.newTotal} Pts`
        );
      }
    },
    [awardGameResult, showRewardToast]
  );

  // --------------------------------------------------------------------------
  // GAME 1: TIC TAC TOE STATE
  // --------------------------------------------------------------------------
  const [tttBoard, setTttBoard] = useState<(string | null)[]>(Array(9).fill(null));
  const [isXNext, setIsXNext] = useState(true);
  const [tttResult, setTttResult] = useState<string | null>(null);
  const [tttWinningLine, setTttWinningLine] = useState<number[] | null>(null);
  const [tttScores, setTttScores] = useState({ X: 0, O: 0 });
  const [tttAiThinking, setTttAiThinking] = useState(false);

  // --------------------------------------------------------------------------
  // GAME 2: LUDO STATE (4 players x 4 tokens each: -1=yard, 0..55=track, 56=home)
  // --------------------------------------------------------------------------
  const [ludoTokens, setLudoTokens] = useState<number[][]>([
    [-1, -1, -1, -1],
    [-1, -1, -1, -1],
    [-1, -1, -1, -1],
    [-1, -1, -1, -1],
  ]);
  const [ludoTurn, setLudoTurn] = useState<0 | 1 | 2 | 3>(0);
  const [ludoDice, setLudoDice] = useState(6);
  const [ludoRolling, setLudoRolling] = useState(false);
  const [ludoPhase, setLudoPhase] = useState<'roll' | 'select' | 'finished'>('roll');
  const [ludoLegalTokens, setLudoLegalTokens] = useState<number[]>([]);
  const [ludoConsecutiveSixes, setLudoConsecutiveSixes] = useState(0);
  const [ludoWinner, setLudoWinner] = useState<number | null>(null);
  const [ludoLog, setLudoLog] = useState<string[]>([
    'Roll 6 to bring a Red token out of the yard!',
  ]);

  // --------------------------------------------------------------------------
  // GAME 3: QUIZ BATTLE STATE (70% Computer Science / 30% General Trivia)
  // --------------------------------------------------------------------------
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>(() =>
    pickShuffledQuizQuestions(10)
  );
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizScore, setQuizScore] = useState(0);
  const [quizAiScore, setQuizAiScore] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [quizFinished, setQuizFinished] = useState(false);
  const [quizTimer, setQuizTimer] = useState(15);
  const [quizSource, setQuizSource] = useState<'ai' | 'curated-70-30'>('curated-70-30');
  const [quizLoadingAi, setQuizLoadingAi] = useState(false);
  const seenQuizPromptsRef = useRef<string[]>([]);

  // --------------------------------------------------------------------------
  // GAME 4: CHESS STATE
  // --------------------------------------------------------------------------
  const [chessBoard, setChessBoard] = useState<(string | null)[][]>(() =>
    INITIAL_CHESS_BOARD.map((row) => [...row])
  );
  const [selectedSquare, setSelectedSquare] = useState<[number, number] | null>(null);
  const [chessTurn, setChessTurn] = useState<'white' | 'black'>('white');
  const [chessStatus, setChessStatus] = useState<'active' | 'check' | 'checkmate' | 'stalemate'>(
    'active'
  );
  const [chessWinner, setChessWinner] = useState<'white' | 'black' | 'draw' | null>(null);
  const [chessAiThinking, setChessAiThinking] = useState(false);
  const [chessMoveLog, setChessMoveLog] = useState<string[]>([
    'Match initialized. White to move first.',
  ]);

  const validChessMoves = useMemo<ChessMove[]>(() => {
    if (!selectedSquare || chessStatus === 'checkmate' || chessStatus === 'stalemate') return [];
    return getLegalMovesForSquare(chessBoard, selectedSquare[0], selectedSquare[1], chessTurn);
  }, [chessBoard, selectedSquare, chessTurn, chessStatus]);

  // --------------------------------------------------------------------------
  // GAME 5: SNAKE & LADDER STATE
  // --------------------------------------------------------------------------
  const [slPositions, setSlPositions] = useState<{ p1: number; p2: number }>({ p1: 1, p2: 1 });
  const [slTurn, setSlTurn] = useState<'p1' | 'p2'>('p1');
  const [slDice, setSlDice] = useState(1);
  const [slRolling, setSlRolling] = useState(false);
  const [slFinished, setSlFinished] = useState(false);
  const [slMessage, setSlMessage] = useState<string>('Your turn (Blue 📍). Roll the die to start!');

  // Ludo Seat Mapping: 2-player online rooms use Red (0) vs Yellow (2) opposite corners!
  const ludoInactiveSeats = useMemo<number[]>(() => {
    if (gameMode === 'ai' || !currentRoom) return [];
    const count = currentRoom.players.length;
    if (count <= 2) return [1, 3];
    if (count === 3) return [3];
    return [];
  }, [gameMode, currentRoom]);

  const myLudoSeat = useMemo<0 | 1 | 2 | 3>(() => {
    if (gameMode === 'ai' || !currentRoom) return 0;
    const idx = currentRoom.players.findIndex((p) => p.id === activePlayer.id);
    if (idx <= 0) return 0;
    if (currentRoom.players.length <= 2) return 2;
    return (idx % 4) as 0 | 1 | 2 | 3;
  }, [gameMode, currentRoom, activePlayer.id]);

  const getNextActiveLudoTurn = useCallback(
    (cur: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 => {
      if (gameMode === 'ai' || !currentRoom) {
        return (((cur + 1) % 4) as 0 | 1 | 2 | 3);
      }
      const count = currentRoom.players.length;
      if (count <= 2) {
        return cur === 0 ? 2 : 0;
      }
      if (count === 3) {
        return cur === 0 ? 1 : cur === 1 ? 2 : 0;
      }
      return (((cur + 1) % 4) as 0 | 1 | 2 | 3);
    },
    [gameMode, currentRoom]
  );

  // --------------------------------------------------------------------------
  // Reset helpers
  // --------------------------------------------------------------------------
  const resetTtt = useCallback(
    (sync = true) => {
      clearAiTimers();
      awardedMatchRef.current.tictactoe = false;
      setTttBoard(Array(9).fill(null));
      setIsXNext(true);
      setTttResult(null);
      setTttWinningLine(null);
      setTttAiThinking(false);
      if (sync && currentRoomRef.current) {
        const room = currentRoomRef.current;
        const resetState = {
          board: Array(9).fill(null),
          isXNext: true,
          result: null,
          line: null,
        };
        multiplayerSocket.rematchGame(room.roomCode, resetState);
        rematchFirestoreGameRoom(room.roomCode, resetState, room.players[0]?.id || room.hostId).catch(() => {});
      }
    },
    [clearAiTimers]
  );

  const resetLudo = useCallback(
    (sync = true) => {
      clearAiTimers();
      awardedMatchRef.current.ludo = false;
      const fresh = [
        [-1, -1, -1, -1],
        [-1, -1, -1, -1],
        [-1, -1, -1, -1],
        [-1, -1, -1, -1],
      ];
      setLudoTokens(fresh);
      setLudoTurn(0);
      setLudoDice(6);
      setLudoRolling(false);
      setLudoPhase('roll');
      setLudoLegalTokens([]);
      setLudoConsecutiveSixes(0);
      setLudoWinner(null);
      setLudoLog(['Match reset! Roll 6 to bring a Red token out of the yard.']);
      if (sync && currentRoomRef.current) {
        const room = currentRoomRef.current;
        const resetState = {
          tokens: fresh,
          turn: 0,
          dice: 6,
          log: ['Match reset! Roll 6 to bring a Red token out of the yard.'],
          winner: null,
        };
        multiplayerSocket.rematchGame(room.roomCode, resetState);
        rematchFirestoreGameRoom(room.roomCode, resetState, room.players[0]?.id || room.hostId).catch(() => {});
      }
    },
    [clearAiTimers]
  );

  const loadAiQuizQuestions = useCallback(
    async (difficulty: AIDifficulty = aiDifficulty) => {
      setQuizLoadingAi(true);
      try {
        const res = await fetchAiQuizRound({
          count: 10,
          difficulty,
          excludeQuestions: seenQuizPromptsRef.current.slice(-30),
        });
        if (res.questions.length > 0) {
          seenQuizPromptsRef.current = [
            ...seenQuizPromptsRef.current,
            ...res.questions.map((q) => q.q),
          ].slice(-40);
          setQuizQuestions(res.questions);
          setQuizSource(res.source);
          setQuizIndex(0);
          setQuizScore(0);
          setQuizAiScore(0);
          setSelectedOption(null);
          setQuizFinished(false);
          setQuizTimer(15);
        }
      } finally {
        setQuizLoadingAi(false);
      }
    },
    [aiDifficulty]
  );

  const resetQuiz = useCallback(() => {
    awardedMatchRef.current.quiz = false;
    setQuizQuestions(pickShuffledQuizQuestions(10, seenQuizPromptsRef.current));
    setQuizSource('curated-70-30');
    setQuizIndex(0);
    setQuizScore(0);
    setQuizAiScore(0);
    setSelectedOption(null);
    setQuizFinished(false);
    setQuizTimer(15);
    void loadAiQuizQuestions(aiDifficulty);
  }, [aiDifficulty, loadAiQuizQuestions]);

  const resetChess = useCallback(
    (sync = true) => {
      clearAiTimers();
      awardedMatchRef.current.chess = false;
      const fresh = INITIAL_CHESS_BOARD.map((r) => [...r]);
      setChessBoard(fresh);
      setSelectedSquare(null);
      setChessTurn('white');
      setChessStatus('active');
      setChessWinner(null);
      setChessAiThinking(false);
      setChessMoveLog(['Match reset. White to move first.']);
      if (sync && currentRoomRef.current) {
        const room = currentRoomRef.current;
        const resetState = {
          board: fresh,
          turn: 'white',
          log: ['Match reset. White to move first.'],
          status: 'active',
          winner: null,
        };
        multiplayerSocket.rematchGame(room.roomCode, resetState);
        rematchFirestoreGameRoom(room.roomCode, resetState, room.players[0]?.id || room.hostId).catch(() => {});
      }
    },
    [clearAiTimers]
  );

  const resetSnakeLadder = useCallback(
    (sync = true) => {
      clearAiTimers();
      awardedMatchRef.current.snake_ladder = false;
      setSlPositions({ p1: 1, p2: 1 });
      setSlTurn('p1');
      setSlDice(1);
      setSlRolling(false);
      setSlFinished(false);
      setSlMessage('Board reset! Your turn (Blue 📍) to roll.');
      if (sync && currentRoomRef.current) {
        const room = currentRoomRef.current;
        const resetState = {
          positions: { p1: 1, p2: 1 },
          turn: 'p1',
          dice: 1,
          message: 'Board reset! Host (Blue 📍) to roll.',
          finished: false,
        };
        multiplayerSocket.rematchGame(room.roomCode, resetState);
        rematchFirestoreGameRoom(room.roomCode, resetState, room.players[0]?.id || room.hostId).catch(() => {});
      }
    },
    [clearAiTimers]
  );

  const resetTruthDare = useCallback(() => {
    awardedMatchRef.current.truth_dare = false;
    setTruthDareState(null);
  }, []);

  const applySyncedMoveState = useCallback(
    (moveAction: string, gameState: any) => {
      if (!gameState || typeof gameState !== 'object') return;
      const moveId = typeof gameState.moveId === 'string' ? gameState.moveId : '';
      if (moveId && appliedMoveIdsRef.current.has(moveId)) return;
      if (moveId) {
        appliedMoveIdsRef.current.add(moveId);
        if (appliedMoveIdsRef.current.size > 150) {
          const first = appliedMoveIdsRef.current.values().next().value;
          if (first) appliedMoveIdsRef.current.delete(first);
        }
      }
      const seq = Number(gameState.moveSeq || 0);
      if (seq > roomMoveCounterRef.current) {
        roomMoveCounterRef.current = seq;
      }

      if (moveAction === 'REMATCH') {
        roomMoveCounterRef.current = 0;
        resetTtt(false);
        resetChess(false);
        resetLudo(false);
        resetQuiz();
        resetSnakeLadder(false);
        resetTruthDare();
        return;
      }

      if (moveAction === 'TTT_MOVE') {
        if (Array.isArray(gameState.board)) setTttBoard(gameState.board);
        if (typeof gameState.isXNext === 'boolean') setIsXNext(gameState.isXNext);
        setTttResult(gameState.result ?? null);
        setTttWinningLine(gameState.line || null);
      } else if (moveAction === 'LUDO_MOVE') {
        if (Array.isArray(gameState.tokens)) setLudoTokens(gameState.tokens);
        if (typeof gameState.turn === 'number') setLudoTurn(gameState.turn as 0 | 1 | 2 | 3);
        if (typeof gameState.dice === 'number') setLudoDice(gameState.dice);
        if (Array.isArray(gameState.log)) setLudoLog(gameState.log);
        setLudoLegalTokens([]);
        setLudoRolling(false);
        setLudoPhase(gameState.winner !== null && gameState.winner !== undefined ? 'finished' : 'roll');
        setLudoWinner(gameState.winner ?? null);
      } else if (moveAction === 'CHESS_MOVE') {
        if (Array.isArray(gameState.board)) setChessBoard(gameState.board);
        if (gameState.turn) setChessTurn(gameState.turn);
        if (Array.isArray(gameState.log)) setChessMoveLog(gameState.log);
        if (gameState.status) setChessStatus(gameState.status);
        if (gameState.winner !== undefined) setChessWinner(gameState.winner);
      } else if (moveAction === 'SL_MOVE') {
        if (gameState.positions) setSlPositions(gameState.positions);
        if (gameState.turn) setSlTurn(gameState.turn);
        if (typeof gameState.dice === 'number') setSlDice(gameState.dice);
        if (gameState.message) setSlMessage(gameState.message);
        if (typeof gameState.finished === 'boolean') setSlFinished(gameState.finished);
      } else if (moveAction === 'TD_MOVE') {
        setTruthDareState(gameState as TruthAndDareState);
      }
    },
    [resetChess, resetLudo, resetQuiz, resetSnakeLadder, resetTruthDare, resetTtt]
  );

  const attachFirestoreRoomSubscription = useCallback(
    (roomCode: string) => {
      if (roomUnsubRef.current) {
        roomUnsubRef.current();
        roomUnsubRef.current = null;
      }
      roomMoveCounterRef.current = 0;
      appliedMoveIdsRef.current.clear();
      seenReactionIdsRef.current.clear();
      lastStartIdRef.current = null;
      prevRoomStatusRef.current = null;

      roomUnsubRef.current = subscribeToGameRoom(
        roomCode,
        (room, moveAction) => {
          const stillMember =
            room.players.some((p) => p.id === activePlayer.id) ||
            (room.waitingPlayers || []).some((p) => p.id === activePlayer.id);

          if (!stillMember) {
            if (roomUnsubRef.current) {
              roomUnsubRef.current();
              roomUnsubRef.current = null;
            }
            setCurrentRoom(null);
            setIsLobbyOpen(false);
            setIsMatchmakingOpen(false);
            setJoinError('You were removed from the room.');
            return;
          }

          setCurrentRoom(room);
          setJoinError(null);

          if (room.isOpenGroup) {
            setGameMode('open_group');
          }

          // Automatically switch selectedGame to match room gameId
          if (room.gameId) {
            setSelectedGame(room.gameId as GameId);
          }

          const wasStatus = prevRoomStatusRef.current;
          prevRoomStatusRef.current = room.status;

          if (room.status === 'in_game') {
            setIsLobbyOpen(false);
            setIsMatchmakingOpen(false);
          }

          // Ensure all players start on a clean board on GAME_START or waiting->in_game transition
          const incomingStartId =
            typeof room.gameState?._startId === 'string' ? room.gameState._startId : null;
          const isFreshGameStart =
            (moveAction === 'GAME_START' && incomingStartId && incomingStartId !== lastStartIdRef.current) ||
            (wasStatus === 'waiting' && room.status === 'in_game' && (!room.gameState || !room.gameState.moveId));

          if (isFreshGameStart) {
            if (incomingStartId) lastStartIdRef.current = incomingStartId;
            roomMoveCounterRef.current = 0;
            appliedMoveIdsRef.current.clear();
            resetTtt(false);
            resetChess(false);
            resetLudo(false);
            resetQuiz();
            resetSnakeLadder(false);
            resetTruthDare();
          }

          if (Array.isArray(room.messages) && room.messages.length > 0) {
            setChatMessages((prev) => {
              if (room.messages.length > prev.length && !isChatOpenRef.current) {
                setUnreadChatCount((c) => c + (room.messages.length - prev.length));
              }
              return room.messages;
            });
          }

          if (Array.isArray(room.reactions)) {
            room.reactions.forEach((rx) => {
              if (Date.now() - rx.createdAtMs < 12000) {
                spawnFloatingReaction(rx.id, rx.emoji, rx.senderName);
              } else {
                seenReactionIdsRef.current.add(rx.id);
              }
            });
          }

          if (room.gameState && moveAction && moveAction !== 'ROOM_CREATED' && moveAction !== 'GAME_START') {
            applySyncedMoveState(moveAction, room.gameState);
          }
        },
        () => {
          setCurrentRoom(null);
          setIsLobbyOpen(false);
          setIsMatchmakingOpen(false);
          setGameMode('ai');
        }
      );
    },
    [
      activePlayer.id,
      applySyncedMoveState,
      resetChess,
      resetLudo,
      resetQuiz,
      resetSnakeLadder,
      resetTruthDare,
      resetTtt,
      spawnFloatingReaction,
    ]
  );

  useEffect(() => {
    return () => {
      if (roomUnsubRef.current) {
        roomUnsubRef.current();
        roomUnsubRef.current = null;
      }
    };
  }, []);

  const broadcastRoomMove = useCallback(
    (
      moveAction: string,
      newGameState: Record<string, any>,
      nextTurnId?: string,
      status: 'in_game' | 'finished' = 'in_game'
    ) => {
      const room = currentRoomRef.current;
      if (!room) return;
      const nextSeq = roomMoveCounterRef.current + 1;
      roomMoveCounterRef.current = nextSeq;
      const moveId = `${activePlayer.id}_${nextSeq}_${Math.random().toString(36).slice(2, 6)}`;
      appliedMoveIdsRef.current.add(moveId);

      const stampedState = {
        ...newGameState,
        moveSeq: nextSeq,
        moveId,
        byPlayerId: activePlayer.id,
      };
      multiplayerSocket.sendMove(room.roomCode, moveAction, stampedState, nextTurnId);
      pushFirestoreGameMove(room.roomCode, moveAction, stampedState, nextTurnId, status).catch(() => {});
    },
    [activePlayer.id]
  );

  // --------------------------------------------------------------------------
  // WebSocket Lifecycle & Event Handlers (fast-path alongside Firestore)
  // --------------------------------------------------------------------------
  useEffect(() => {
    multiplayerSocket.connect();

    const handleConnectionStatus = (data: { connected: boolean }) => {
      setSocketConnected(data.connected);
    };

    const handleRoomCreated = (data: { room: MultiplayerRoom }) => {
      if (!currentRoomRef.current) {
        setCurrentRoom(data.room);
      }
      setJoinError(null);
      setIsModeSelectOpen(false);
      setIsLobbyOpen(true);
    };

    const handleRoomUpdated = (data: { room: MultiplayerRoom }) => {
      setCurrentRoom(data.room);
      setJoinError(null);
      if (data.room.status === 'in_game') {
        setIsLobbyOpen(false);
      }
    };

    const handleGameStarted = (data: { room: MultiplayerRoom }) => {
      setCurrentRoom(data.room);
      setIsLobbyOpen(false);
    };

    const handleGameStateUpdated = (data: {
      roomCode: string;
      moveAction: string;
      gameState: any;
    }) => {
      if (!currentRoomRef.current || currentRoomRef.current.roomCode !== data.roomCode) return;
      applySyncedMoveState(data.moveAction, data.gameState);
    };

    const handleGameReset = (data: { room: MultiplayerRoom }) => {
      setCurrentRoom(data.room);
      resetTtt(false);
      resetChess(false);
      resetLudo(false);
      resetQuiz();
      resetSnakeLadder(false);
      resetTruthDare();
    };

    const handleChatMessage = (data: { message: InGameChatMessage }) => {
      setChatMessages((prev) => {
        if (prev.some((m) => m.id === data.message.id)) return prev;
        return [...prev, data.message];
      });
      if (!isChatOpenRef.current) {
        setUnreadChatCount((c) => c + 1);
      }
    };

    const handleReactionReceived = (data: {
      roomCode: string;
      reaction: { id: string; emoji: string; senderName: string };
    }) => {
      if (!currentRoomRef.current || currentRoomRef.current.roomCode !== data.roomCode) return;
      if (data.reaction) {
        spawnFloatingReaction(data.reaction.id, data.reaction.emoji, data.reaction.senderName);
      }
    };

    const handleModerationUpdated = (data: {
      roomCode: string;
      mutedVoiceIds: string[];
      mutedChatIds: string[];
    }) => {
      setCurrentRoom((prev) =>
        prev && prev.roomCode === data.roomCode
          ? { ...prev, mutedVoiceIds: data.mutedVoiceIds, mutedChatIds: data.mutedChatIds }
          : prev
      );
    };

    const handleCallSignal = (data: any) => {
      if (data.signalData?.type === 'CALL_START') {
        setActiveCallType(data.callType || 'video');
      } else if (data.signalData?.type === 'CALL_END') {
        setActiveCallType(null);
      }
    };

    const handlePlayerKicked = (data: { targetPlayerId: string; room: MultiplayerRoom }) => {
      if (data.targetPlayerId === activePlayer.id) {
        setCurrentRoom(null);
        setIsLobbyOpen(false);
        setIsMatchmakingOpen(false);
        setJoinError('You were removed from the room by the host.');
      } else {
        setCurrentRoom(data.room);
      }
    };

    const handleError = (data: { code: string; message: string }) => {
      if (data.code === 'CHAT_MUTED') {
        showRewardToast(data.message || 'Your chat access was restricted by the Room Host.');
        return;
      }
      if (!currentRoomRef.current) {
        setJoinError(data.message || 'Room error occurred.');
      }
    };

    multiplayerSocket.on('CONNECTION_STATUS', handleConnectionStatus);
    multiplayerSocket.on('ROOM_CREATED', handleRoomCreated);
    multiplayerSocket.on('ROOM_UPDATED', handleRoomUpdated);
    multiplayerSocket.on('GAME_STARTED', handleGameStarted);
    multiplayerSocket.on('GAME_STATE_UPDATED', handleGameStateUpdated);
    multiplayerSocket.on('GAME_RESET', handleGameReset);
    multiplayerSocket.on('CHAT_MESSAGE_RECEIVED', handleChatMessage);
    multiplayerSocket.on('REACTION_RECEIVED', handleReactionReceived);
    multiplayerSocket.on('MODERATION_UPDATED', handleModerationUpdated);
    multiplayerSocket.on('CALL_SIGNAL_RECEIVED', handleCallSignal);
    multiplayerSocket.on('PLAYER_KICKED', handlePlayerKicked);
    multiplayerSocket.on('ERROR', handleError);

    return () => {
      multiplayerSocket.off('CONNECTION_STATUS', handleConnectionStatus);
      multiplayerSocket.off('ROOM_CREATED', handleRoomCreated);
      multiplayerSocket.off('ROOM_UPDATED', handleRoomUpdated);
      multiplayerSocket.off('GAME_STARTED', handleGameStarted);
      multiplayerSocket.off('GAME_STATE_UPDATED', handleGameStateUpdated);
      multiplayerSocket.off('GAME_RESET', handleGameReset);
      multiplayerSocket.off('CHAT_MESSAGE_RECEIVED', handleChatMessage);
      multiplayerSocket.off('REACTION_RECEIVED', handleReactionReceived);
      multiplayerSocket.off('MODERATION_UPDATED', handleModerationUpdated);
      multiplayerSocket.off('CALL_SIGNAL_RECEIVED', handleCallSignal);
      multiplayerSocket.off('PLAYER_KICKED', handlePlayerKicked);
      multiplayerSocket.off('ERROR', handleError);
    };
  }, [
    activePlayer.id,
    applySyncedMoveState,
    resetTtt,
    resetChess,
    resetLudo,
    resetQuiz,
    resetSnakeLadder,
    resetTruthDare,
    showRewardToast,
    spawnFloatingReaction,
  ]);

  // Auto-Matchmaking Queue Polling: seamlessly pairs simultaneous searchers
  useEffect(() => {
    if (
      !isMatchmakingOpen ||
      gameMode !== 'random' ||
      !currentRoom ||
      currentRoom.status !== 'waiting'
    ) {
      return;
    }

    let cancelled = false;
    const pollTimer = window.setInterval(async () => {
      if (cancelled) return;
      try {
        const other = await findOtherWaitingQuickMatchRoom(
          selectedGame,
          currentRoom.roomCode,
          activePlayer.id
        );
        if (!other || cancelled) return;
        const oldCode = currentRoom.roomCode;
        const joined = await joinFirestoreGameRoom(other.roomCode, selectedGame, activePlayer);
        if (cancelled) return;
        await kickOrLeaveFirestoreRoom(oldCode, activePlayer.id).catch(() => {});
        setCurrentRoom(joined);
        attachFirestoreRoomSubscription(joined.roomCode);
        setIsMatchmakingOpen(false);
        soundFx.playWin();
        showRewardToast(`Match found! Connected to Room #${joined.roomCode}`);
      } catch {
        // Retry on next poll tick
      }
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
    };
  }, [
    isMatchmakingOpen,
    gameMode,
    currentRoom?.roomCode,
    currentRoom?.status,
    selectedGame,
    activePlayer,
    attachFirestoreRoomSubscription,
    showRewardToast,
  ]);

  // --------------------------------------------------------------------------
  // Multiplayer Room Actions (Firestore Authoritative + WS Fast-Path)
  // --------------------------------------------------------------------------
  const handleCreateFriendRoom = async () => {
    if (isRoomSubmitting) return;
    setIsRoomSubmitting(true);
    setGameMode('friend');
    setJoinError(null);
    setChatMessages([]);
    try {
      const maxP = selectedGame === 'ludo' ? 4 : 2;
      const room = await createFirestoreGameRoom(selectedGame, maxP, activePlayer, false);
      setCurrentRoom(room);
      attachFirestoreRoomSubscription(room.roomCode);
      setIsModeSelectOpen(false);
      setIsLobbyOpen(true);
    } catch (err: any) {
      setJoinError(err?.message || 'Could not create private room. Please try again.');
    } finally {
      setIsRoomSubmitting(false);
    }
  };

  const handleCreateOpenGroupRoom = async (activeSeatLimit: number) => {
    if (isRoomSubmitting) return;
    setIsRoomSubmitting(true);
    setGameMode('open_group');
    setJoinError(null);
    setChatMessages([]);
    try {
      const room = await createFirestoreGameRoom(selectedGame, 999, activePlayer, {
        isPublicMatch: true,
        isOpenGroup: true,
        activeSeatLimit,
      });
      setCurrentRoom(room);
      attachFirestoreRoomSubscription(room.roomCode);
      setIsModeSelectOpen(false);
      setIsLobbyOpen(false);
      resetTtt(false);
      resetChess(false);
      resetLudo(false);
      resetQuiz();
      resetSnakeLadder(false);
      resetTruthDare();
      showRewardToast(
        `Open Group #${room.roomCode} live (${activeSeatLimit} active seats · unlimited waiting queue)!`
      );
    } catch (err: any) {
      setJoinError(err?.message || 'Could not create Open Group room.');
    } finally {
      setIsRoomSubmitting(false);
    }
  };

  const handleJoinFriendRoom = async (code: string) => {
    if (isRoomSubmitting) return;
    setIsRoomSubmitting(true);
    setJoinError(null);
    setChatMessages([]);
    try {
      const room = await joinFirestoreGameRoom(code, undefined, activePlayer);
      setGameMode(room.isOpenGroup ? 'open_group' : 'friend');
      setSelectedGame(room.gameId as GameId);
      setSubView('play');
      setCurrentRoom(room);
      attachFirestoreRoomSubscription(room.roomCode);
      setIsModeSelectOpen(false);
      if (room.status === 'in_game' || room.isOpenGroup) {
        setIsLobbyOpen(false);
        resetTtt(false);
        resetChess(false);
        resetLudo(false);
        resetQuiz();
        resetSnakeLadder(false);
        resetTruthDare();
      } else {
        setIsLobbyOpen(true);
      }
      if (room.waitingPlayers?.some((w) => w.id === activePlayer.id)) {
        showRewardToast(
          `Active seats full — you joined the Waiting Seat queue in Room #${room.roomCode}!`
        );
      }
      if (room.gameState && Object.keys(room.gameState).filter((k) => !k.startsWith('_')).length > 0) {
        const lastAction =
          room.gameId === 'ludo'
            ? 'LUDO_MOVE'
            : room.gameId === 'chess'
            ? 'CHESS_MOVE'
            : room.gameId === 'snake_ladder'
            ? 'SL_MOVE'
            : room.gameId === 'truth_dare'
            ? 'TD_MOVE'
            : 'TTT_MOVE';
        applySyncedMoveState(lastAction, room.gameState);
      }
    } catch (err: any) {
      if (socketConnected) {
        multiplayerSocket.joinRoom(code, selectedGame, activePlayer);
      }
      setJoinError(err?.message || `Room #${code} not found. Please check the 4-digit code.`);
    } finally {
      setIsRoomSubmitting(false);
    }
  };

  const handlePlayRandom = async () => {
    if (isRoomSubmitting) return;
    setIsRoomSubmitting(true);
    setGameMode('random');
    setJoinError(null);
    setChatMessages([]);
    try {
      const maxP = 2;
      const { room, matchedExisting } = await quickMatchFirestoreRoom(
        selectedGame,
        maxP,
        activePlayer
      );
      setCurrentRoom(room);
      attachFirestoreRoomSubscription(room.roomCode);
      setIsModeSelectOpen(false);
      setIsLobbyOpen(false);
      setIsMatchmakingOpen(!matchedExisting && room.status === 'waiting');
      if (matchedExisting) {
        soundFx.playWin();
        showRewardToast(`Match found! Connected to Room #${room.roomCode}`);
      }
    } catch (err: any) {
      setJoinError(err?.message || 'Quick matchmaking failed. Please try again.');
    } finally {
      setIsRoomSubmitting(false);
    }
  };

  const handlePlayAI = (diff: AIDifficulty) => {
    if (roomUnsubRef.current) {
      roomUnsubRef.current();
      roomUnsubRef.current = null;
    }
    setGameMode('ai');
    setAiDifficulty(diff);
    setCurrentRoom(null);
    setIsModeSelectOpen(false);
    setIsLobbyOpen(false);
    setIsMatchmakingOpen(false);
    resetTtt(false);
    resetChess(false);
    resetLudo(false);
    resetQuiz();
    resetSnakeLadder(false);
    resetTruthDare();
  };

  const handleStartRoomGame = async () => {
    if (!currentRoom) return;
    resetTtt(false);
    resetChess(false);
    resetLudo(false);
    resetQuiz();
    resetSnakeLadder(false);
    resetTruthDare();
    setIsLobbyOpen(false);
    const firstTurnId = currentRoom.players[0]?.id || currentRoom.hostId;
    multiplayerSocket.startGame(currentRoom.roomCode);
    await startFirestoreGameRoom(currentRoom.roomCode, {}, firstTurnId).catch(() => {});
  };

  const handleKickPlayer = async (playerId: string) => {
    if (!currentRoom) return;
    multiplayerSocket.kickPlayer(currentRoom.roomCode, playerId);
    await kickOrLeaveFirestoreRoom(currentRoom.roomCode, playerId);
  };

  const handleLeaveRoom = async () => {
    if (roomUnsubRef.current) {
      roomUnsubRef.current();
      roomUnsubRef.current = null;
    }
    if (currentRoom) {
      multiplayerSocket.leaveRoom(currentRoom.roomCode, activePlayer.id);
      await kickOrLeaveFirestoreRoom(currentRoom.roomCode, activePlayer.id);
    }
    setCurrentRoom(null);
    setIsLobbyOpen(false);
    setIsMatchmakingOpen(false);
    setIsHostPanelOpen(false);
    setActiveCallType(null);
    setGameMode('ai');
  };

  const handleFallbackToAI = async () => {
    if (roomUnsubRef.current) {
      roomUnsubRef.current();
      roomUnsubRef.current = null;
    }
    if (currentRoom) {
      multiplayerSocket.leaveRoom(currentRoom.roomCode, activePlayer.id);
      await kickOrLeaveFirestoreRoom(currentRoom.roomCode, activePlayer.id);
    }
    setActiveCallType(null);
    handlePlayAI(aiDifficulty);
  };

  // --------------------------------------------------------------------------
  // In-Game Chat, Reactions, Moderation & Call Actions
  // --------------------------------------------------------------------------
  const handleSendInGameMessage = async (text?: string, imageUrl?: string) => {
    if (isHostMutedMyChat) {
      soundFx.playError();
      showRewardToast('Your chat access was restricted by the Room Host.');
      return;
    }
    const roomCode = currentRoom?.roomCode || 'LOCAL_ROOM';
    const msg = {
      senderId: activePlayer.id,
      senderName: activePlayer.name,
      senderAvatar: activePlayer.avatar,
      text,
      imageUrl,
    };

    if (currentRoom) {
      multiplayerSocket.sendChatMessage(roomCode, msg);
      const res = await sendFirestoreRoomChat(roomCode, msg);
      if (res.restricted) {
        soundFx.playError();
        showRewardToast('Your chat access was restricted by the Room Host.');
      }
    } else {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `msg_${Date.now()}`,
          roomCode,
          ...msg,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }
  };

  const handleSendReaction = async (emoji: string) => {
    const id = `rx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    spawnFloatingReaction(id, emoji, activePlayer.name);
    soundFx.playTick();

    if (currentRoom) {
      multiplayerSocket.sendReaction(currentRoom.roomCode, {
        id,
        emoji,
        senderId: activePlayer.id,
        senderName: activePlayer.name,
        createdAtMs: Date.now(),
      });
      await sendFirestoreRoomReaction(currentRoom.roomCode, {
        emoji,
        senderId: activePlayer.id,
        senderName: activePlayer.name,
      });
    }
  };

  const handleHostToggleVoiceMute = async (targetPlayerId: string) => {
    if (!currentRoom || !isRoomHost) return;
    const prev = currentRoom.mutedVoiceIds || [];
    const nextVoice = prev.includes(targetPlayerId)
      ? prev.filter((id) => id !== targetPlayerId)
      : [...prev, targetPlayerId];
    const nextChat = currentRoom.mutedChatIds || [];

    setCurrentRoom((r) => (r ? { ...r, mutedVoiceIds: nextVoice } : r));
    multiplayerSocket.hostUpdateModeration(currentRoom.roomCode, nextVoice, nextChat);
    await hostUpdateRoomModeration(currentRoom.roomCode, activePlayer.id, {
      mutedVoiceIds: nextVoice,
      mutedChatIds: nextChat,
    });
  };

  const handleHostToggleChatMute = async (targetPlayerId: string) => {
    if (!currentRoom || !isRoomHost) return;
    const prev = currentRoom.mutedChatIds || [];
    const nextChat = prev.includes(targetPlayerId)
      ? prev.filter((id) => id !== targetPlayerId)
      : [...prev, targetPlayerId];
    const nextVoice = currentRoom.mutedVoiceIds || [];

    setCurrentRoom((r) => (r ? { ...r, mutedChatIds: nextChat } : r));
    multiplayerSocket.hostUpdateModeration(currentRoom.roomCode, nextVoice, nextChat);
    await hostUpdateRoomModeration(currentRoom.roomCode, activePlayer.id, {
      mutedVoiceIds: nextVoice,
      mutedChatIds: nextChat,
    });
  };

  const handleHostRotatePlayers = async (nextActiveIds: string[]) => {
    if (!currentRoom || !isRoomHost) return;
    resetTtt(false);
    resetChess(false);
    resetLudo(false);
    resetQuiz();
    resetSnakeLadder(false);
    resetTruthDare();

    multiplayerSocket.hostRotatePlayers(currentRoom.roomCode, nextActiveIds, {});
    await hostRotateRoomPlayers(currentRoom.roomCode, activePlayer.id, nextActiveIds, {});
    showRewardToast('Host rotated players & started the next round!');
  };

  const handleToggleMutePlayer = (playerId: string) => {
    setMutedPlayerIds((prev) =>
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]
    );
  };

  const handleStartCall = (type: 'voice' | 'video') => {
    setActiveCallType(type);
    if (currentRoom) {
      multiplayerSocket.sendCallSignal(
        currentRoom.roomCode,
        { type: 'CALL_START' },
        undefined,
        activePlayer.id,
        type
      );
    }
  };

  const handleEndCall = () => {
    if (currentRoom) {
      multiplayerSocket.sendCallSignal(
        currentRoom.roomCode,
        { type: 'CALL_END' },
        undefined,
        activePlayer.id
      );
    }
    setActiveCallType(null);
  };

  // --------------------------------------------------------------------------
  // GAME 1: TIC TAC TOE LOGIC
  // --------------------------------------------------------------------------
  const handleTttClick = (index: number) => {
    if (tttBoard[index] || tttResult || tttAiThinking) return;

    if (currentRoom && isWaitingSpectator) {
      soundFx.playError();
      showRewardToast('You are in the Waiting Seat — chat, react, or join Voice while waiting!');
      return;
    }

    if (gameMode !== 'ai' && currentRoom) {
      const isXPlayer = currentRoom.players[0]?.id === activePlayer.id;
      const mySymbol = isXPlayer ? 'X' : 'O';
      const currentSymbol = isXNext ? 'X' : 'O';
      if (mySymbol !== currentSymbol) {
        soundFx.playError();
        return;
      }
    }

    const nextSymbol = isXNext ? 'X' : 'O';
    const newBoard = [...tttBoard];
    newBoard[index] = nextSymbol;
    soundFx.playMove();

    const { winner, line } = checkTicTacToeWinner(newBoard);
    const nextTurnBool = !isXNext;

    let resStr: string | null = null;
    if (winner) {
      if (winner === 'draw') {
        resStr = 'Match Drawn! +10 JIT Points';
        soundFx.playMove();
        triggerGameAward('tictactoe', {
          gameId: 'tictactoe',
          gameName: 'Tic Tac Toe',
          mode: gameMode,
          outcome: 'draw',
          pointsEarned: 10,
          scoreSummary: 'Draw (3x3)',
        });
      } else {
        const pts = gameMode === 'ai' && aiDifficulty === 'hard' ? 35 : 25;
        resStr = `Player ${winner} Won! +${pts} JIT Points`;
        setTttScores((prev) => ({
          ...prev,
          [winner]: prev[winner] + 1,
        }));
        soundFx.playWin();
        triggerGameAward('tictactoe', {
          gameId: 'tictactoe',
          gameName: 'Tic Tac Toe',
          mode: gameMode,
          outcome: 'win',
          pointsEarned: pts,
          scoreSummary: `${winner} Victory`,
        });
      }
    }

    setTttBoard(newBoard);
    setIsXNext(nextTurnBool);
    setTttResult(resStr);
    setTttWinningLine(line);

    if (currentRoom) {
      const nextTurnId = nextTurnBool ? currentRoom.players[0]?.id : currentRoom.players[1]?.id;
      broadcastRoomMove(
        'TTT_MOVE',
        { board: newBoard, isXNext: nextTurnBool, result: resStr, line },
        nextTurnId,
        winner ? 'finished' : 'in_game'
      );
    }

    if (gameMode === 'ai' && !winner && isXNext) {
      setTttAiThinking(true);
      registerAiTimer(() => {
        const aiBoard = [...newBoard];
        const aiMove = getTicTacToeAIMove(aiBoard, aiDifficulty);
        if (aiMove !== -1) {
          aiBoard[aiMove] = 'O';
          soundFx.playMove();
          const aiCheck = checkTicTacToeWinner(aiBoard);
          let aiRes: string | null = null;
          if (aiCheck.winner) {
            if (aiCheck.winner === 'draw') {
              aiRes = 'Match Drawn! +10 JIT Points';
              triggerGameAward('tictactoe', {
                gameId: 'tictactoe',
                gameName: 'Tic Tac Toe',
                mode: 'ai',
                outcome: 'draw',
                pointsEarned: 10,
                scoreSummary: `Draw vs ${aiDifficulty} AI`,
              });
            } else {
              aiRes = `Campus AI Bot (${aiDifficulty}) Won! +5 Participation Points`;
              setTttScores((prev) => ({ ...prev, O: prev.O + 1 }));
              triggerGameAward('tictactoe', {
                gameId: 'tictactoe',
                gameName: 'Tic Tac Toe',
                mode: 'ai',
                outcome: 'loss',
                pointsEarned: 5,
                scoreSummary: `Lost to ${aiDifficulty} AI`,
              });
            }
          }
          setTttBoard(aiBoard);
          setIsXNext(true);
          setTttResult(aiRes);
          setTttWinningLine(aiCheck.line);
        }
        setTttAiThinking(false);
      }, 450);
    }
  };

  // --------------------------------------------------------------------------
  // GAME 2: LUDO FULL RULES LOGIC
  // --------------------------------------------------------------------------
  const scheduleNextLudoAI = useCallback(
    (
      nextTurn: 0 | 1 | 2 | 3,
      tokensSnap: number[][],
      logSnap: string[],
      sixesCount: number
    ) => {
      if (gameMode !== 'ai' || nextTurn === 0) return;
      registerAiTimer(() => {
        const roll = Math.floor(Math.random() * 6) + 1;
        soundFx.playDice();
        setLudoDice(roll);
        const color = LUDO_COLORS[nextTurn];
        const newSixes = roll === 6 ? sixesCount + 1 : 0;

        if (newSixes >= 3) {
          const skipTurn = (((nextTurn + 1) % 4) as 0 | 1 | 2 | 3);
          const skipLog = [`🤖 ${color.name} rolled three 6s — turn forfeited!`, ...logSnap.slice(0, 4)];
          setLudoLog(skipLog);
          setLudoConsecutiveSixes(0);
          setLudoTurn(skipTurn);
          scheduleNextLudoAI(skipTurn, tokensSnap, skipLog, 0);
          return;
        }

        const tokenChoice = chooseLudoAIToken(tokensSnap, nextTurn, roll, aiDifficulty);
        if (tokenChoice === null) {
          const passTurn = (((nextTurn + 1) % 4) as 0 | 1 | 2 | 3);
          const passLog = [
            `🤖 ${color.name} rolled ${roll} (no legal move)`,
            ...logSnap.slice(0, 4),
          ];
          setLudoLog(passLog);
          setLudoConsecutiveSixes(0);
          setLudoTurn(passTurn);
          scheduleNextLudoAI(passTurn, tokensSnap, passLog, 0);
          return;
        }

        const updated = tokensSnap.map((arr) => [...arr]);
        const cur = updated[nextTurn][tokenChoice];
        const nextPos = cur === -1 ? 0 : cur + roll;
        updated[nextTurn][tokenChoice] = nextPos;

        let capturedName = '';
        const globalSq = ludoLocalToGlobal(nextTurn, nextPos);
        if (globalSq !== null && !LUDO_SAFE_GLOBAL_INDICES.has(globalSq)) {
          for (let opp = 0; opp < 4; opp++) {
            if (opp === nextTurn) continue;
            updated[opp].forEach((opPos, oIdx) => {
              if (ludoLocalToGlobal(opp, opPos) === globalSq) {
                updated[opp][oIdx] = -1;
                capturedName = LUDO_COLORS[opp].name;
                soundFx.playCapture();
              }
            });
          }
        }

        const hasWon = updated[nextTurn].every((p) => p === 56);
        const moveText =
          cur === -1
            ? `🤖 ${color.name} rolled 6 → Token #${tokenChoice + 1} entered play!`
            : `🤖 ${color.name} rolled ${roll} → Token #${tokenChoice + 1} to ${nextPos}/56${
                capturedName ? ` (Captured ${capturedName}!)` : ''
              }`;
        const nextLog = [moveText, ...logSnap.slice(0, 4)];
        setLudoTokens(updated);
        setLudoLog(nextLog);

        if (hasWon) {
          setLudoWinner(nextTurn);
          setLudoPhase('finished');
          triggerGameAward('ludo', {
            gameId: 'ludo',
            gameName: 'Ludo',
            mode: 'ai',
            outcome: 'loss',
            pointsEarned: 10,
            scoreSummary: `${color.name} AI won Ludo`,
          });
          return;
        }

        const bonusRoll = roll === 6 || Boolean(capturedName) || nextPos === 56;
        const followingTurn = bonusRoll
          ? nextTurn
          : (((nextTurn + 1) % 4) as 0 | 1 | 2 | 3);
        setLudoTurn(followingTurn);
        setLudoConsecutiveSixes(roll === 6 ? newSixes : 0);

        if (followingTurn !== 0) {
          scheduleNextLudoAI(followingTurn, updated, nextLog, roll === 6 ? newSixes : 0);
        }
      }, 850);
    },
    [aiDifficulty, gameMode, registerAiTimer, triggerGameAward]
  );

  const getPlayerIdForLudoSeat = useCallback((seat: 0 | 1 | 2 | 3): string | undefined => {
    const room = currentRoomRef.current;
    if (!room) return undefined;
    if (room.players.length <= 2) {
      return seat === 0 ? room.players[0]?.id : room.players[1]?.id;
    }
    return room.players[seat]?.id;
  }, []);

  const executeLudoTokenMove = (
    playerIdx: 0 | 1 | 2 | 3,
    tokenIdx: number,
    rollVal: number,
    overrideSixes?: number
  ) => {
    if (currentRoom && isWaitingSpectator) {
      soundFx.playError();
      return;
    }
    if (gameMode !== 'ai' && currentRoom && ludoTurn !== myLudoSeat) {
      soundFx.playError();
      return;
    }
    const updated = ludoTokens.map((arr) => [...arr]);
    const cur = updated[playerIdx][tokenIdx];
    const nextPos = cur === -1 ? 0 : cur + rollVal;
    updated[playerIdx][tokenIdx] = nextPos;

    let capturedName = '';
    const globalSq = ludoLocalToGlobal(playerIdx, nextPos);
    if (globalSq !== null && !LUDO_SAFE_GLOBAL_INDICES.has(globalSq)) {
      for (let opp = 0; opp < 4; opp++) {
        if (opp === playerIdx) continue;
        updated[opp].forEach((opPos, oIdx) => {
          if (ludoLocalToGlobal(opp, opPos) === globalSq) {
            updated[opp][oIdx] = -1;
            capturedName = LUDO_COLORS[opp].name;
          }
        });
      }
    }

    if (capturedName || nextPos === 56) {
      soundFx.playCapture();
    } else {
      soundFx.playMove();
    }

    const color = LUDO_COLORS[playerIdx];
    const hasWon = updated[playerIdx].every((p) => p === 56);
    const moveText =
      cur === -1
        ? `${color.name} rolled 6 → Token #${tokenIdx + 1} entered the board!`
        : nextPos === 56
        ? `${color.name} Token #${tokenIdx + 1} reached Home! ★`
        : `${color.name} moved Token #${tokenIdx + 1} to step ${nextPos}/56${
            capturedName ? ` (Captured ${capturedName}!)` : ''
          }`;

    const newLog = [moveText, ...ludoLog.slice(0, 4)];
    setLudoTokens(updated);
    setLudoLog(newLog);
    setLudoLegalTokens([]);

    if (hasWon) {
      setLudoWinner(playerIdx);
      setLudoPhase('finished');
      soundFx.playWin();
      const playerWon = gameMode === 'ai' ? playerIdx === 0 : playerIdx === myLudoSeat;
      triggerGameAward('ludo', {
        gameId: 'ludo',
        gameName: 'Ludo',
        mode: gameMode,
        outcome: playerWon ? 'win' : 'loss',
        pointsEarned: playerWon ? 55 : 10,
        scoreSummary: `${color.name} won Ludo`,
      });
      if (currentRoom) {
        broadcastRoomMove(
          'LUDO_MOVE',
          {
            tokens: updated,
            turn: playerIdx,
            dice: rollVal,
            log: newLog,
            winner: playerIdx,
          },
          getPlayerIdForLudoSeat(playerIdx),
          'finished'
        );
      }
      return;
    }

    const bonusRoll = rollVal === 6 || Boolean(capturedName) || nextPos === 56;
    const nextTurn = bonusRoll ? playerIdx : getNextActiveLudoTurn(playerIdx);
    const activeSixes = overrideSixes ?? ludoConsecutiveSixes;
    const nextSixes = rollVal === 6 ? activeSixes : 0;

    setLudoPhase('roll');
    setLudoTurn(nextTurn);
    setLudoConsecutiveSixes(bonusRoll && rollVal === 6 ? nextSixes : 0);

    if (currentRoom) {
      broadcastRoomMove(
        'LUDO_MOVE',
        {
          tokens: updated,
          turn: nextTurn,
          dice: rollVal,
          log: newLog,
          winner: null,
        },
        getPlayerIdForLudoSeat(nextTurn),
        'in_game'
      );
    }

    if (gameMode === 'ai' && nextTurn !== 0) {
      scheduleNextLudoAI(nextTurn, updated, newLog, 0);
    }
  };

  const rollLudoDice = () => {
    if (ludoRolling || ludoPhase !== 'roll') return;
    if (currentRoom && isWaitingSpectator) {
      soundFx.playError();
      return;
    }
    if (gameMode === 'ai' && ludoTurn !== 0) return;
    if (gameMode !== 'ai' && currentRoom && ludoTurn !== myLudoSeat) {
      soundFx.playError();
      return;
    }

    setLudoRolling(true);
    soundFx.playDice();

    const interval = window.setInterval(() => {
      setLudoDice(Math.floor(Math.random() * 6) + 1);
    }, 65);

    registerAiTimer(() => {
      window.clearInterval(interval);
      const roll = Math.floor(Math.random() * 6) + 1;
      setLudoDice(roll);
      setLudoRolling(false);

      const newSixes = roll === 6 ? ludoConsecutiveSixes + 1 : 0;
      const color = LUDO_COLORS[ludoTurn];

      if (newSixes >= 3) {
        const nextTurn = getNextActiveLudoTurn(ludoTurn);
        const newLog = [
          `${color.name} rolled three 6s in a row — turn forfeited!`,
          ...ludoLog.slice(0, 4),
        ];
        soundFx.playError();
        setLudoLog(newLog);
        setLudoConsecutiveSixes(0);
        setLudoTurn(nextTurn);
        if (currentRoom) {
          broadcastRoomMove(
            'LUDO_MOVE',
            {
              tokens: ludoTokens,
              turn: nextTurn,
              dice: roll,
              log: newLog,
              winner: null,
            },
            getPlayerIdForLudoSeat(nextTurn),
            'in_game'
          );
        }
        if (gameMode === 'ai' && nextTurn !== 0) {
          scheduleNextLudoAI(nextTurn, ludoTokens, newLog, 0);
        }
        return;
      }

      setLudoConsecutiveSixes(newSixes);
      const legal = getLegalLudoTokenIndices(ludoTokens[ludoTurn], roll);

      if (legal.length === 0) {
        const nextTurn = getNextActiveLudoTurn(ludoTurn);
        const newLog = [
          `${color.name} rolled ${roll} — no legal moves (need 6 to unlock or exact roll).`,
          ...ludoLog.slice(0, 4),
        ];
        setLudoLog(newLog);
        setLudoConsecutiveSixes(0);
        setLudoTurn(nextTurn);
        if (currentRoom) {
          broadcastRoomMove(
            'LUDO_MOVE',
            {
              tokens: ludoTokens,
              turn: nextTurn,
              dice: roll,
              log: newLog,
              winner: null,
            },
            getPlayerIdForLudoSeat(nextTurn),
            'in_game'
          );
        }
        if (gameMode === 'ai' && nextTurn !== 0) {
          scheduleNextLudoAI(nextTurn, ludoTokens, newLog, 0);
        }
        return;
      }

      if (legal.length === 1) {
        executeLudoTokenMove(ludoTurn, legal[0], roll, newSixes);
      } else {
        setLudoLegalTokens(legal);
        setLudoPhase('select');
      }
    }, 450);
  };

  // --------------------------------------------------------------------------
  // GAME 3: QUIZ BATTLE LOGIC (Fixed Timer Pause + AI Rival + Firebase Award)
  // --------------------------------------------------------------------------
  const handleQuizNext = useCallback(
    (optIdx: number | null) => {
      if (selectedOption !== null || quizFinished) return;
      setSelectedOption(optIdx);

      const curr = quizQuestions[quizIndex];
      const earnedThisQ = optIdx === curr.answer ? 100 + Math.min(20, quizTimer) : 0;
      const nextPlayerScore = quizScore + earnedThisQ;
      if (earnedThisQ > 0) {
        soundFx.playWin();
      } else {
        soundFx.playError();
      }
      setQuizScore(nextPlayerScore);

      let nextAiScore = quizAiScore;
      if (gameMode === 'ai') {
        const aiPick = getQuizAIMove(curr.answer, curr.options.length, aiDifficulty);
        if (aiPick.choice === curr.answer) {
          nextAiScore += 105;
        }
        setQuizAiScore(nextAiScore);
      }

      window.setTimeout(() => {
        if (quizIndex < quizQuestions.length - 1) {
          setQuizIndex((idx) => idx + 1);
          setSelectedOption(null);
          setQuizTimer(15);
        } else {
          setQuizFinished(true);
          const wonMatch = gameMode !== 'ai' ? nextPlayerScore >= 300 : nextPlayerScore >= nextAiScore;
          const pts = wonMatch ? 55 : nextPlayerScore > 0 ? 25 : 10;
          triggerGameAward('quiz', {
            gameId: 'quiz',
            gameName: 'Quiz Battle',
            mode: gameMode,
            outcome: wonMatch ? 'win' : 'loss',
            pointsEarned: pts,
            scoreSummary:
              gameMode === 'ai'
                ? `${nextPlayerScore} vs AI ${nextAiScore}`
                : `Scored ${nextPlayerScore} pts`,
          });
        }
      }, 850);
    },
    [
      aiDifficulty,
      gameMode,
      quizAiScore,
      quizFinished,
      quizIndex,
      quizQuestions,
      quizScore,
      quizTimer,
      selectedOption,
      triggerGameAward,
    ]
  );

  useEffect(() => {
    if (selectedGame !== 'quiz' || quizFinished || selectedOption !== null || subView !== 'play') {
      return;
    }
    const timer = window.setInterval(() => {
      setQuizTimer((t) => {
        if (t <= 1) {
          handleQuizNext(null);
          return 15;
        }
        return t - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [selectedGame, quizIndex, quizFinished, selectedOption, subView, handleQuizNext]);

  // --------------------------------------------------------------------------
  // GAME 4: CHESS LOGIC (Strict Legal Rules, Check/Checkmate/Stalemate, Promotion)
  // --------------------------------------------------------------------------
  const handleChessSquareClick = (r: number, c: number) => {
    if (chessStatus === 'checkmate' || chessStatus === 'stalemate' || chessAiThinking) return;

    if (gameMode === 'ai' && chessTurn === 'black') {
      soundFx.playError();
      return;
    }

    if (currentRoom && isWaitingSpectator) {
      soundFx.playError();
      return;
    }
    if (gameMode !== 'ai' && currentRoom) {
      const isWhitePlayer = currentRoom.players[0]?.id === activePlayer.id;
      const myColor = isWhitePlayer ? 'white' : 'black';
      if (myColor !== chessTurn) {
        soundFx.playError();
        return;
      }
    }

    const clickedPiece = chessBoard[r][c];
    const clickedColor = getPieceColor(clickedPiece);

    if (!selectedSquare) {
      if (clickedColor === chessTurn) {
        setSelectedSquare([r, c]);
        soundFx.playTick();
      } else if (clickedPiece) {
        soundFx.playError();
      }
      return;
    }

    const [sr, sc] = selectedSquare;
    if (sr === r && sc === c) {
      setSelectedSquare(null);
      return;
    }

    const legalTarget = validChessMoves.find((m) => m.to[0] === r && m.to[1] === c);
    if (!legalTarget) {
      if (clickedColor === chessTurn) {
        setSelectedSquare([r, c]);
        soundFx.playTick();
      } else {
        soundFx.playError();
        setSelectedSquare(null);
      }
      return;
    }

    const newBoard = applyChessMoveToBoard(chessBoard, legalTarget);
    const nextTurn: 'white' | 'black' = chessTurn === 'white' ? 'black' : 'white';
    const nextStatus = getChessGameStatus(newBoard, nextTurn);

    if (legalTarget.captured) {
      soundFx.playCapture();
    } else {
      soundFx.playMove();
    }

    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const fromCoord = `${files[sc]}${8 - sr}`;
    const toCoord = `${files[c]}${8 - r}`;
    const statusTag =
      nextStatus === 'checkmate'
        ? ' # CHECKMATE!'
        : nextStatus === 'check'
        ? ' + Check!'
        : nextStatus === 'stalemate'
        ? ' ½ Stalemate'
        : '';
    const promoTag = legalTarget.promotedTo ? `=${legalTarget.promotedTo}` : '';

    const newLog = [
      `${legalTarget.piece} ${fromCoord} → ${toCoord}${promoTag}${
        legalTarget.captured ? ` x${legalTarget.captured}` : ''
      }${statusTag}`,
      ...chessMoveLog.slice(0, 4),
    ];

    let winnerResult: 'white' | 'black' | 'draw' | null = null;
    if (nextStatus === 'checkmate') {
      winnerResult = chessTurn;
      soundFx.playWin();
      triggerGameAward('chess', {
        gameId: 'chess',
        gameName: 'Chess',
        mode: gameMode,
        outcome: 'win',
        pointsEarned: 60,
        scoreSummary: `Checkmate by ${chessTurn}`,
      });
    } else if (nextStatus === 'stalemate') {
      winnerResult = 'draw';
      triggerGameAward('chess', {
        gameId: 'chess',
        gameName: 'Chess',
        mode: gameMode,
        outcome: 'draw',
        pointsEarned: 20,
        scoreSummary: 'Stalemate Draw',
      });
    }

    setChessBoard(newBoard);
    setSelectedSquare(null);
    setChessTurn(nextTurn);
    setChessStatus(nextStatus);
    setChessWinner(winnerResult);
    setChessMoveLog(newLog);

    if (currentRoom) {
      const nextTurnId = nextTurn === 'white' ? currentRoom.players[0]?.id : currentRoom.players[1]?.id;
      broadcastRoomMove(
        'CHESS_MOVE',
        {
          board: newBoard,
          turn: nextTurn,
          log: newLog,
          status: nextStatus,
          winner: winnerResult,
        },
        nextTurnId,
        winnerResult ? 'finished' : 'in_game'
      );
    }

    // AI Bot Move
    if (
      gameMode === 'ai' &&
      nextTurn === 'black' &&
      nextStatus !== 'checkmate' &&
      nextStatus !== 'stalemate'
    ) {
      setChessAiThinking(true);
      registerAiTimer(() => {
        const aiMove = getChessAIMove(newBoard, aiDifficulty);
        if (aiMove) {
          const afterAiBoard = applyChessMoveToBoard(newBoard, aiMove);
          const aiNextStatus = getChessGameStatus(afterAiBoard, 'white');
          if (aiMove.captured) soundFx.playCapture();
          else soundFx.playMove();

          const [fsr, fsc] = aiMove.from;
          const [ftr, ftc] = aiMove.to;
          const aiTag =
            aiNextStatus === 'checkmate'
              ? ' # CHECKMATE!'
              : aiNextStatus === 'check'
              ? ' + Check!'
              : aiNextStatus === 'stalemate'
              ? ' ½ Stalemate'
              : '';

          const aiLog = [
            `🤖 ${aiMove.piece} ${files[fsc]}${8 - fsr} → ${files[ftc]}${8 - ftr}${
              aiMove.captured ? ` x${aiMove.captured}` : ''
            }${aiTag}`,
            ...newLog.slice(0, 4),
          ];

          let aiWinner: 'white' | 'black' | 'draw' | null = null;
          if (aiNextStatus === 'checkmate') {
            aiWinner = 'black';
            triggerGameAward('chess', {
              gameId: 'chess',
              gameName: 'Chess',
              mode: 'ai',
              outcome: 'loss',
              pointsEarned: 10,
              scoreSummary: `Checkmated by ${aiDifficulty} AI`,
            });
          } else if (aiNextStatus === 'stalemate') {
            aiWinner = 'draw';
            triggerGameAward('chess', {
              gameId: 'chess',
              gameName: 'Chess',
              mode: 'ai',
              outcome: 'draw',
              pointsEarned: 20,
              scoreSummary: 'Stalemate vs AI',
            });
          }

          setChessBoard(afterAiBoard);
          setChessTurn('white');
          setChessStatus(aiNextStatus);
          setChessWinner(aiWinner);
          setChessMoveLog(aiLog);
        }
        setChessAiThinking(false);
      }, 550);
    }
  };

  // --------------------------------------------------------------------------
  // GAME 5: SNAKE & LADDER LOGIC (Boustrophedon Board + 2P / AI Race)
  // --------------------------------------------------------------------------
  const executeSnakeLadderRoll = useCallback(
    (side: 'p1' | 'p2', currentPositions: { p1: number; p2: number }) => {
      if (currentRoom && isWaitingSpectator) {
        soundFx.playError();
        return;
      }
      if (gameMode !== 'ai' && currentRoom) {
        const mySide = currentRoom.players[0]?.id === activePlayer.id ? 'p1' : 'p2';
        if (side !== mySide) {
          soundFx.playError();
          return;
        }
      }
      setSlRolling(true);
      soundFx.playDice();

      const interval = window.setInterval(() => {
        setSlDice(Math.floor(Math.random() * 6) + 1);
      }, 65);

      registerAiTimer(() => {
        window.clearInterval(interval);
        const roll = Math.floor(Math.random() * 6) + 1;
        setSlDice(roll);
        setSlRolling(false);

        const label = side === 'p1' ? 'Player 1 (Blue 📍)' : gameMode === 'ai' ? 'AI Bot (Amber ⭐)' : 'Player 2 (Amber ⭐)';
        const startPos = currentPositions[side];
        let nextPos = startPos + roll;
        let msg = `${label} rolled ${roll}: moved ${startPos} → ${nextPos}`;

        if (nextPos > 100) {
          nextPos = startPos;
          msg = `${label} rolled ${roll} — needs exact ${100 - startPos} to finish on 100!`;
        } else if (SL_LADDERS[nextPos]) {
          const to = SL_LADDERS[nextPos];
          msg = `🪜 ${label} rolled ${roll} → climbed ladder ${nextPos} to ${to}!`;
          nextPos = to;
          soundFx.playWin();
        } else if (SL_SNAKES[nextPos]) {
          const to = SL_SNAKES[nextPos];
          msg = `🐍 ${label} rolled ${roll} → snake bite at ${nextPos}! Slid to ${to}.`;
          nextPos = to;
          soundFx.playError();
        } else {
          soundFx.playMove();
        }

        const updatedPos = { ...currentPositions, [side]: nextPos };
        setSlPositions(updatedPos);

        if (nextPos === 100) {
          setSlFinished(true);
          soundFx.playWin();
          const mySide = currentRoom ? (currentRoom.hostId === activePlayer.id ? 'p1' : 'p2') : 'p1';
          const playerWon = side === mySide;
          setSlMessage(
            playerWon
              ? '🏆 You reached Square 100! +50 JIT Points awarded!'
              : `🏁 ${label} reached Square 100 first! +10 Participation Points`
          );
          triggerGameAward('snake_ladder', {
            gameId: 'snake_ladder',
            gameName: 'Snake & Ladder',
            mode: gameMode,
            outcome: playerWon ? 'win' : 'loss',
            pointsEarned: playerWon ? 50 : 10,
            scoreSummary: playerWon ? 'Reached 100 First' : `${label} finished first`,
          });

          if (currentRoom) {
            const winnerId = side === 'p1' ? currentRoom.players[0]?.id : currentRoom.players[1]?.id;
            broadcastRoomMove(
              'SL_MOVE',
              {
                positions: updatedPos,
                turn: side,
                dice: roll,
                message: msg,
                finished: true,
              },
              winnerId,
              'finished'
            );
          }
          return;
        }

        const nextTurn: 'p1' | 'p2' = roll === 6 ? side : side === 'p1' ? 'p2' : 'p1';
        setSlTurn(nextTurn);
        const finalMsg = roll === 6 ? `${msg} (Bonus roll for 6!)` : msg;
        setSlMessage(finalMsg);

        if (currentRoom) {
          const nextTurnId = nextTurn === 'p1' ? currentRoom.players[0]?.id : currentRoom.players[1]?.id;
          broadcastRoomMove(
            'SL_MOVE',
            {
              positions: updatedPos,
              turn: nextTurn,
              dice: roll,
              message: finalMsg,
              finished: false,
            },
            nextTurnId,
            'in_game'
          );
        }

        if (gameMode === 'ai' && nextTurn === 'p2') {
          registerAiTimer(() => {
            executeSnakeLadderRoll('p2', updatedPos);
          }, 800);
        }
      }, 450);
    },
    [activePlayer.id, broadcastRoomMove, currentRoom, gameMode, registerAiTimer, triggerGameAward]
  );

  // --------------------------------------------------------------------------
  // Instructions Helper (exhaustive across all 7 GameIds)
  // --------------------------------------------------------------------------
  const getInstructions = (gameId: GameId): string[] => {
    switch (gameId) {
      case 'ludo':
        return [
          'Each player controls 4 tokens from the corner Yard to the center Home Triangle.',
          'Roll a 6 to unlock a token from the Yard. Rolling three 6s in a row forfeits the turn.',
          'Landing on an opponent outside Star (★) squares captures their token back to Yard.',
          'Exact roll required to reach step 56 (Home). First player with all 4 tokens home wins!',
        ];
      case 'tictactoe':
        return [
          'Place X and O marks on a 3x3 grid.',
          'Align 3 marks horizontally, vertically, or diagonally to win (+25 to +35 JIT Points).',
          'Play against Easy, Medium, or Hard (Minimax) AI or a friend via 4-digit room code.',
        ];
      case 'quiz':
        return [
          'Answer 6 randomized Science, Tech, and General Knowledge questions within 15 seconds each.',
          'Faster correct answers earn extra speed bonus points against the AI challenger.',
          'Win matches to earn up to +55 JIT Points directly synced to your Firebase leaderboard.',
        ];
      case 'chess':
        return [
          'Full international chess rules: legal piece movement, check, checkmate, and stalemate detection.',
          'Tap any piece on your turn to see green legal move dots and red capture highlights.',
          'Pawns reaching the final rank automatically promote to a Queen.',
        ];
      case 'snake_ladder':
        return [
          'Race from Square 1 (bottom-left) to Square 100 (top-left) following the numbered zigzag path.',
          'Rolling a 6 grants a bonus roll! Land on Ladders to climb up and avoid Snakes.',
          'Exact roll required to land on Square 100 and claim +50 JIT Points.',
        ];
      case 'carrom':
        return [
          'Adjust Striker position, aim angle (or tap directly on the board), and strike power.',
          'Pocket White coins (+10), Black coins (+10 for opponent), and the Red Queen (+30).',
          'Pocketing your own coin keeps your turn! Striker pocketing deducts -5 foul.',
        ];
      case 'spin_wheel':
        return [
          'Enjoy 3 complimentary Lucky Spins every day.',
          'Spin the wheel to win between +10 and +200 JACKPOT JIT Points!',
          'All won points sync straight to your Firebase profile and Global Leaderboard.',
        ];
      case 'truth_dare':
        return [
          'Host an Open Group room where unlimited friends can join! Overflow members enjoy Voice, Chat & Reactions in the Waiting Seat.',
          'Spin for the next spotlight player, choose Truth or Dare, and pick System Choice or write your Own Choice challenge.',
          'Completing a round earns +15 JIT Points and logs into live round history. Hosts can rotate Waiting Seat players any time!',
        ];
    }
  };

  const boustrophedonSquares = useMemo(() => {
    const arr: number[] = [];
    for (let visualRow = 0; visualRow < 10; visualRow++) {
      const rowFromBottom = 9 - visualRow;
      for (let visualCol = 0; visualCol < 10; visualCol++) {
        const colInRow = rowFromBottom % 2 === 0 ? visualCol : 9 - visualCol;
        arr.push(rowFromBottom * 10 + colInRow + 1);
      }
    }
    return arr;
  }, []);

  return (
    <div className="space-y-5 max-w-4xl mx-auto w-full">
      {/* 1. Header Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-800 p-5 sm:p-7 text-white shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="max-w-xl">
            <div className="flex items-center gap-2 mb-1.5">
              <Gamepad2 className="w-5 h-5 text-amber-300" />
              <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                JIT Gaming & Rewards Arena
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight mb-1.5">
              8 Playable Games · Live JIT Points
            </h2>
            <p className="text-xs sm:text-sm text-blue-100 leading-relaxed mb-3">
              Auto-Matchmaking, Open Group Truth & Dare, Waiting Seat Rotation, Live Emoji Reactions, and WebRTC Voice Chat.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-black/30 backdrop-blur-md rounded-xl text-xs font-semibold">
                {socketConnected || currentRoom || (typeof navigator !== 'undefined' && navigator.onLine) ? (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-300">Live Realtime Active</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5 text-amber-300" />
                    <span>Offline / AI Ready</span>
                  </>
                )}
              </div>

              {selectedGame !== 'spin_wheel' && (
                <button
                  type="button"
                  onClick={() => setIsModeSelectOpen(true)}
                  className="px-3.5 py-1.5 bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-colors min-h-[34px]"
                >
                  Change Game Mode
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  const next = !soundMuted;
                  soundFx.muted = next;
                  setSoundMuted(next);
                }}
                aria-label={soundMuted ? 'Unmute game sounds' : 'Mute game sounds'}
                className="p-2 bg-white/15 hover:bg-white/25 rounded-xl text-white transition-colors"
                title={soundMuted ? 'Unmute Sound FX' : 'Mute Sound FX'}
              >
                {soundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Points Pill & Sub-View Toggle */}
          <div className="flex flex-col sm:items-end gap-2.5 shrink-0">
            <div className="px-4 py-2 bg-black/25 backdrop-blur-md rounded-2xl border border-white/15 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-300" />
              <div className="text-left">
                <p className="text-[10px] text-blue-200 uppercase font-bold tracking-wider">
                  Your Balance
                </p>
                <p className="text-base font-black font-mono tabular-nums leading-tight">
                  {currentUser?.stats.rewardPoints ?? 0} Pts
                </p>
              </div>
            </div>

            <div className="flex p-1 bg-black/25 rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => setSubView('play')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                  subView === 'play' ? 'bg-white text-slate-900 shadow-sm' : 'text-white/80 hover:text-white'
                }`}
              >
                <Gamepad2 className="w-3.5 h-3.5" />
                <span>Play Games</span>
              </button>
              <button
                type="button"
                onClick={() => setSubView('leaderboard')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                  subView === 'leaderboard'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                <Trophy className="w-3.5 h-3.5 text-amber-500" />
                <span>Leaderboard</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {rewardBanner && (
        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center justify-between gap-3 text-xs font-bold text-emerald-800 dark:text-emerald-200 animate-in fade-in">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
            <span>{rewardBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('wallet')}
            className="underline text-emerald-700 dark:text-emerald-300 shrink-0"
          >
            View Wallet
          </button>
        </div>
      )}

      {subView === 'leaderboard' ? (
        <LeaderboardPanel />
      ) : (
        <>
          {/* 2. Choose Game Strip with Custom Logos */}
          <div>
            <div className="flex items-center justify-between mb-2.5 px-1">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Choose Game
              </h3>
              <button
                type="button"
                onClick={() => setInstructionsGame(selectedGame)}
                className="text-xs text-blue-600 dark:text-blue-400 font-semibold flex items-center gap-1 hover:underline"
              >
                <Info className="w-3.5 h-3.5" />
                <span>How to Play</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {APP_CONFIG.games.map((g) => {
                const gid = g.id as GameId;
                const isSelected = selectedGame === gid;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      setSelectedGame(gid);
                      setSubView('play');
                      if (gid !== 'spin_wheel') {
                        setIsModeSelectOpen(true);
                      } else {
                        setCurrentRoom(null);
                      }
                    }}
                    className={`p-2.5 rounded-2xl border text-left transition-all min-h-[56px] flex items-center gap-2.5 active:scale-[0.98] touch-manipulation ${
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-blue-400'
                    }`}
                  >
                    <GameLogo gameId={gid} size="sm" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate leading-tight">{g.name}</p>
                      <p
                        className={`text-[10px] mt-0.5 truncate ${
                          isSelected ? 'text-blue-100' : 'text-slate-400'
                        }`}
                      >
                        {g.category}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Active Playable Arena */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-3.5 sm:p-6 shadow-sm">
            {selectedGame !== 'spin_wheel' && (
              <GameActionBar
                gameMode={gameMode}
                roomCode={currentRoom?.roomCode}
                unreadChatCount={unreadChatCount}
                isCallActive={!!activeCallType || voiceChat.isMicEnabled}
                waitingCount={currentRoom?.waitingPlayers?.length || 0}
                activeCount={currentRoom?.players.length || 1}
                isHost={isRoomHost}
                onOpenChat={() => {
                  setIsChatOpen(true);
                  setUnreadChatCount(0);
                }}
                onStartVoiceCall={() => {
                  voiceChat.toggleMic();
                }}
                onStartVideoCall={() => handleStartCall('video')}
                onOpenMembers={() => setIsLobbyOpen(true)}
                onOpenHostPanel={() => setIsHostPanelOpen(true)}
                onInviteFriend={() => setIsLobbyOpen(true)}
                onLeaveRoom={handleLeaveRoom}
                aiDifficulty={aiDifficulty}
              />
            )}

            <InGameVoiceHud
              gameMode={gameMode}
              roomCode={currentRoom?.roomCode}
              isMicEnabled={voiceChat.isMicEnabled}
              isSpeakerEnabled={voiceChat.isSpeakerEnabled}
              isConnectingMic={voiceChat.isConnectingMic}
              isSpeaking={voiceChat.isSpeaking}
              isHostMutedMic={isHostMutedMyVoice}
              hostMutedVoiceIds={currentRoom?.mutedVoiceIds || []}
              voiceError={voiceChat.voiceError}
              voicePeers={voiceChat.voicePeers}
              localPlayerId={activePlayer.id}
              onToggleMic={voiceChat.toggleMic}
              onToggleSpeaker={voiceChat.toggleSpeaker}
              onClearError={voiceChat.clearVoiceError}
            />

            {currentRoom && isWaitingSpectator && (
              <div className="mb-4 p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
                <span className="text-amber-900 dark:text-amber-200 font-semibold">
                  Waiting Seat Active — You can watch live, talk in Voice, chat, and send emoji reactions until the Host rotates you in!
                </span>
                <button
                  type="button"
                  onClick={() => setIsHostPanelOpen(true)}
                  className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 font-bold text-amber-800 dark:text-amber-200 whitespace-nowrap"
                >
                  View Queue
                </button>
              </div>
            )}

            {currentRoom &&
              currentRoom.status === 'finished' &&
              isRoomHost &&
              (currentRoom.waitingPlayers?.length || 0) > 0 && (
                <div className="mb-4 p-3.5 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
                  <span className="text-indigo-900 dark:text-indigo-200 font-semibold">
                    Match Finished! {currentRoom.waitingPlayers?.length} player(s) waiting in the queue for the next match.
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsHostPanelOpen(true)}
                    className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-xs whitespace-nowrap"
                  >
                    Pick Next Players
                  </button>
                </div>
              )}

            {currentRoom && !currentRoom.isOpenGroup && currentRoom.status === 'waiting' && currentRoom.players.length < 2 && (
              <div className="mb-4 p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="text-amber-900 dark:text-amber-200">
                  <span className="font-bold">Room #{currentRoom.roomCode}</span> ·{' '}
                  {waitingSecondsLeft > 0
                    ? `Waiting for 2nd player to join (${waitingSecondsLeft}s until AI Bot fallback)...`
                    : 'No second player joined within 30s — AI Bot fallback is ready!'}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsLobbyOpen(true)}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 font-bold text-amber-800 dark:text-amber-200"
                  >
                    Room Lobby
                  </button>
                  {waitingSecondsLeft === 0 && (
                    <button
                      type="button"
                      onClick={handleFallbackToAI}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5 shadow-sm"
                    >
                      <Bot className="w-3.5 h-3.5" />
                      <span>Play vs AI Bot</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ----------------------------------------------------------- */}
            {/* GAME 1: TIC TAC TOE */}
            {/* ----------------------------------------------------------- */}
            {selectedGame === 'tictactoe' && (
              <div className="max-w-sm mx-auto flex flex-col items-center">
                <div className="flex items-center justify-between w-full mb-4 px-2">
                  <button
                    type="button"
                    onClick={() => setIsModeSelectOpen(true)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 border-blue-200 dark:border-blue-800"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span className="capitalize">
                      {gameMode === 'ai' ? `${aiDifficulty} AI` : gameMode}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => resetTtt(true)}
                    className="text-xs text-slate-600 dark:text-slate-300 hover:text-blue-600 flex items-center gap-1 font-semibold px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Rematch</span>
                  </button>
                </div>

                <div className="flex items-center justify-between w-full mb-3 px-2 text-xs font-bold">
                  <span className={isXNext && !tttResult ? 'text-blue-600' : 'text-slate-400'}>
                    You (X): {tttScores.X}
                  </span>
                  <span className="text-slate-400 text-[11px]">
                    {tttAiThinking ? 'AI thinking...' : tttResult ? 'Finished' : isXNext ? 'X Turn' : 'O Turn'}
                  </span>
                  <span className={!isXNext && !tttResult ? 'text-emerald-500' : 'text-slate-400'}>
                    {gameMode === 'ai' ? 'AI Bot (O)' : 'Opponent (O)'}: {tttScores.O}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2.5 p-3 bg-slate-100 dark:bg-slate-800/80 rounded-2xl w-full aspect-square max-w-[min(280px,100%)] touch-manipulation select-none">
                  {tttBoard.map((cell, idx) => {
                    const isWinCell = tttWinningLine?.includes(idx);
                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={Boolean(cell) || Boolean(tttResult) || tttAiThinking}
                        onClick={() => handleTttClick(idx)}
                        className={`w-full h-full rounded-xl flex items-center justify-center text-3xl font-black transition-all min-h-[44px] ${
                          isWinCell
                            ? 'bg-emerald-100 dark:bg-emerald-900/60 ring-2 ring-emerald-500 text-emerald-700 dark:text-emerald-300 scale-[1.03]'
                            : cell === 'X'
                            ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-sm'
                            : cell === 'O'
                            ? 'bg-white dark:bg-slate-900 text-emerald-500 shadow-sm'
                            : 'bg-white/70 dark:bg-slate-900/60 hover:bg-white dark:hover:bg-slate-900 text-transparent'
                        }`}
                      >
                        {cell}
                      </button>
                    );
                  })}
                </div>

                {tttResult && (
                  <div className="mt-4 w-full p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl text-xs font-semibold text-blue-700 dark:text-blue-300 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                      {tttResult}
                    </span>
                    <button
                      type="button"
                      onClick={() => resetTtt(true)}
                      className="px-3 py-1 bg-blue-600 text-white rounded-lg text-[11px] font-bold shrink-0"
                    >
                      Play Again
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ----------------------------------------------------------- */}
            {/* GAME 2: LUDO (Classic 15x15 Interactive Board) */}
            {/* ----------------------------------------------------------- */}
            {selectedGame === 'ludo' && (
              <div className="max-w-xl mx-auto flex flex-col items-center space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between w-full px-1">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    Turn: <span className={LUDO_COLORS[ludoTurn].text}>{LUDO_COLORS[ludoTurn].name}</span>
                    {gameMode !== 'ai' && currentRoom && (
                      <span className="ml-1.5 text-[11px] font-semibold text-slate-400">
                        ({ludoTurn === myLudoSeat ? 'Your Turn' : 'Opponent Turn'})
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => resetLudo(true)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-blue-600 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>New Match</span>
                  </button>
                </div>

                {/* 4 Player Score Chips */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full">
                  {LUDO_COLORS.map((c, idx) => {
                    const isInactive = ludoInactiveSeats.includes(idx);
                    const isCurrent = !isInactive && ludoTurn === idx && ludoPhase !== 'finished';
                    const homeCount = ludoTokens[idx].filter((p) => p === 56).length;
                    const roomPlayer = currentRoom
                      ? currentRoom.players.length <= 2
                        ? idx === 0
                          ? currentRoom.players[0]
                          : idx === 2
                          ? currentRoom.players[1]
                          : undefined
                        : currentRoom.players[idx]
                      : undefined;
                    const seatLabel = isInactive
                      ? `${c.name} (Empty)`
                      : roomPlayer
                      ? `${roomPlayer.name.split(' ')[0]} (${c.name})`
                      : idx === 0
                      ? 'You (Red)'
                      : gameMode === 'ai'
                      ? `${c.name} AI`
                      : c.name;

                    return (
                      <div
                        key={c.name}
                        className={`p-2 rounded-2xl text-center border transition-all ${
                          isInactive
                            ? 'opacity-45 bg-slate-50 dark:bg-slate-900/30 border-slate-100 dark:border-slate-800/60 text-slate-400'
                            : isCurrent
                            ? `border-current ${c.text} font-bold ring-2 ring-current/25 bg-slate-50 dark:bg-slate-800`
                            : 'bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800 text-slate-500'
                        }`}
                      >
                        <p className="text-[11px] font-bold truncate">{seatLabel}</p>
                        <p className="text-[10px] font-mono mt-0.5">
                          {isInactive ? 'Inactive' : `${homeCount}/4 Home`}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <LudoBoard
                  tokens={ludoTokens}
                  currentTurn={ludoTurn}
                  legalTokenIndices={ludoLegalTokens}
                  awaitingTokenChoice={
                    ludoPhase === 'select' &&
                    (gameMode === 'ai' ? ludoTurn === 0 : !currentRoom || ludoTurn === myLudoSeat)
                  }
                  inactiveSeats={ludoInactiveSeats}
                  onSelectToken={(tIdx) => executeLudoTokenMove(ludoTurn, tIdx, ludoDice)}
                />

                {/* Dice & Token Selector Bar */}
                {ludoPhase === 'finished' ? (
                  <div className="w-full p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                      <Trophy className="w-5 h-5 text-amber-500 shrink-0" />
                      <span>
                        {LUDO_COLORS[ludoWinner ?? 0].name} won the Ludo match!
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => resetLudo(true)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold shrink-0"
                    >
                      Play Again
                    </button>
                  </div>
                ) : ludoPhase === 'select' ? (
                  <div className="w-full p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl space-y-2 text-center">
                    <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
                      Rolled {ludoDice}! Choose which token to move:
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {ludoLegalTokens.map((tIdx) => (
                        <button
                          key={tIdx}
                          type="button"
                          disabled={gameMode !== 'ai' && Boolean(currentRoom) && ludoTurn !== myLudoSeat}
                          onClick={() => executeLudoTokenMove(ludoTurn, tIdx, ludoDice)}
                          className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-sm min-h-[40px]"
                        >
                          Move #{tIdx + 1} (
                          {ludoTokens[ludoTurn][tIdx] === -1
                            ? 'Yard → Start'
                            : `Step ${ludoTokens[ludoTurn][tIdx]}`}
                          )
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
                    <button
                      type="button"
                      onClick={rollLudoDice}
                      disabled={
                        ludoRolling ||
                        (gameMode === 'ai'
                          ? ludoTurn !== 0
                          : Boolean(currentRoom) && ludoTurn !== myLudoSeat)
                      }
                      className="w-14 h-14 sm:w-16 sm:h-16 bg-white dark:bg-slate-900 border-2 border-blue-500 rounded-2xl shadow-lg flex items-center justify-center text-2xl sm:text-3xl font-black text-blue-600 hover:scale-105 active:scale-95 disabled:opacity-50 transition-all"
                    >
                      {ludoDice}
                    </button>
                    <button
                      type="button"
                      onClick={rollLudoDice}
                      disabled={
                        ludoRolling ||
                        (gameMode === 'ai'
                          ? ludoTurn !== 0
                          : Boolean(currentRoom) && ludoTurn !== myLudoSeat)
                      }
                      className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-2xl text-xs font-bold shadow-md transition-colors min-h-[44px]"
                    >
                      {ludoRolling
                        ? 'Rolling Dice...'
                        : gameMode === 'ai' && ludoTurn !== 0
                        ? `${LUDO_COLORS[ludoTurn].name} AI Playing...`
                        : currentRoom && ludoTurn !== myLudoSeat
                        ? `Waiting for ${LUDO_COLORS[ludoTurn].name}...`
                        : `Roll for ${LUDO_COLORS[ludoTurn].name} 🎲`}
                    </button>
                  </div>
                )}

                <div className="w-full p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-xs text-slate-500 space-y-1">
                  {ludoLog.map((log, i) => (
                    <p key={i} className="text-[11px] font-mono">
                      {log}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* ----------------------------------------------------------- */}
            {/* GAME 3: QUIZ BATTLE (70% CS / 30% General Trivia AI Bot) */}
            {/* ----------------------------------------------------------- */}
            {selectedGame === 'quiz' && (
              <div className="max-w-md mx-auto">
                {/* Quiz Mix & AI Fresh Generator Bar */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/70 text-[11px]">
                  <div className="flex items-center gap-2 font-semibold text-slate-600 dark:text-slate-300">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                    <span>
                      Mix: {quizQuestions.filter((q) => q.domain === 'cs').length} CS (70%) ·{' '}
                      {quizQuestions.filter((q) => q.domain === 'general').length} General (30%)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadAiQuizQuestions(aiDifficulty)}
                    disabled={quizLoadingAi}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-[10px] transition-colors"
                  >
                    {quizLoadingAi ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Generating...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3" />
                        <span>{quizSource === 'ai' ? 'New AI Quiz' : 'Generate AI Quiz'}</span>
                      </>
                    )}
                  </button>
                </div>

                {!quizFinished ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-blue-600 font-mono">
                        Q {quizIndex + 1}/{quizQuestions.length}
                      </span>
                      <div
                        className={`flex items-center gap-1 font-mono px-2.5 py-1 rounded-lg ${
                          quizTimer <= 5
                            ? 'bg-red-100 text-red-600 animate-pulse'
                            : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600'
                        }`}
                      >
                        <Timer className="w-3.5 h-3.5" />
                        <span>{quizTimer}s</span>
                      </div>
                      <div className="font-mono text-right">
                        <span className="text-emerald-600">You: {quizScore}</span>
                        {gameMode === 'ai' && (
                          <span className="text-purple-500 ml-2">AI: {quizAiScore}</span>
                        )}
                      </div>
                    </div>

                    <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-100 dark:border-slate-800">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400">
                          {quizQuestions[quizIndex].category}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          {quizQuestions[quizIndex].domain === 'cs' ? 'Computer Science' : 'General Trivia'}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                        {quizQuestions[quizIndex].q}
                      </h4>
                    </div>

                    <div className="space-y-2">
                      {quizQuestions[quizIndex].options.map((opt, idx) => {
                        const isSelected = selectedOption === idx;
                        const isCorrect = idx === quizQuestions[quizIndex].answer;
                        let btnStyle =
                          'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-blue-400';
                        if (selectedOption !== null) {
                          if (isCorrect) {
                            btnStyle =
                              'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-700 dark:text-emerald-300 font-bold';
                          } else if (isSelected) {
                            btnStyle =
                              'bg-red-50 dark:bg-red-950/60 border-red-500 text-red-600 font-bold';
                          }
                        }

                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => selectedOption === null && handleQuizNext(idx)}
                            disabled={selectedOption !== null}
                            className={`w-full p-3.5 text-left text-xs rounded-xl border transition-all flex items-center justify-between min-h-[44px] ${btnStyle}`}
                          >
                            <span>{opt}</span>
                            <ChevronRight className="w-3.5 h-3.5 opacity-40" />
                          </button>
                        );
                      })}
                    </div>

                    {selectedOption !== null && quizQuestions[quizIndex].explanation && (
                      <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/70 dark:border-indigo-900/50 text-[11px] text-indigo-900 dark:text-indigo-200">
                        {quizQuestions[quizIndex].explanation}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-6 text-center space-y-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/70 dark:border-slate-700">
                    <Trophy className="w-12 h-12 text-amber-500 mx-auto" />
                    <h4 className="text-base font-bold text-slate-900 dark:text-white">
                      {gameMode === 'ai'
                        ? quizScore >= quizAiScore
                          ? 'Victory over Quiz AI Bot!'
                          : 'AI Bot edged ahead this round!'
                        : 'Quiz Battle Complete!'}
                    </h4>
                    <div className="flex items-center justify-center gap-6 font-mono">
                      <div>
                        <p className="text-[11px] text-slate-400">Your Score</p>
                        <p className="text-2xl font-black text-blue-600 tabular-nums">{quizScore}</p>
                      </div>
                      {gameMode === 'ai' && (
                        <div>
                          <p className="text-[11px] text-slate-400">AI Score</p>
                          <p className="text-2xl font-black text-purple-600 tabular-nums">
                            {quizAiScore}
                          </p>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={resetQuiz}
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md transition-colors"
                    >
                      Generate Fresh AI Quiz Round
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ----------------------------------------------------------- */}
            {/* GAME 4: CHESS (Legal Moves, Highlights, Check/Checkmate) */}
            {/* ----------------------------------------------------------- */}
            {selectedGame === 'chess' && (
              <div className="max-w-md mx-auto flex flex-col items-center">
                <div className="flex items-center justify-between w-full mb-3 text-xs font-bold px-2">
                  <span
                    className={
                      chessTurn === 'white' && !chessWinner
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-slate-400'
                    }
                  >
                    White (♔) {chessTurn === 'white' && chessStatus === 'check' ? '· IN CHECK!' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => resetChess(true)}
                    className="text-xs text-slate-600 dark:text-slate-300 hover:text-blue-600 flex items-center gap-1 font-semibold px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </button>
                  <span
                    className={
                      chessTurn === 'black' && !chessWinner
                        ? 'text-purple-600 dark:text-purple-400'
                        : 'text-slate-400'
                    }
                  >
                    {chessAiThinking
                      ? 'AI Thinking...'
                      : `Black (♚)${chessTurn === 'black' && chessStatus === 'check' ? ' · CHECK!' : ''}`}
                  </span>
                </div>

                {chessStatus === 'check' && !chessWinner && (
                  <div className="mb-2 px-3 py-1 rounded-xl bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 text-xs font-bold">
                    Check! Defend your King.
                  </div>
                )}

                <div className="grid grid-cols-8 border-2 border-slate-700 rounded-2xl overflow-hidden shadow-lg w-full aspect-square max-w-[min(380px,calc(100vw-2.25rem),52dvh)] touch-manipulation select-none">
                  {chessBoard.map((row, r) =>
                    row.map((cell, c) => {
                      const isLight = (r + c) % 2 === 0;
                      const isSelected =
                        selectedSquare && selectedSquare[0] === r && selectedSquare[1] === c;
                      const legalTarget = validChessMoves.find(
                        (m) => m.to[0] === r && m.to[1] === c
                      );
                      const isLegalEmpty = Boolean(legalTarget && !cell);
                      const isLegalCapture = Boolean(legalTarget && cell);

                      return (
                        <button
                          key={`${r}-${c}`}
                          type="button"
                          onClick={() => handleChessSquareClick(r, c)}
                          className={`relative w-full h-full flex items-center justify-center text-xl sm:text-2xl transition-colors select-none ${
                            isSelected
                              ? 'bg-amber-300 ring-2 ring-inset ring-amber-600'
                              : isLegalCapture
                              ? 'bg-red-400/75 dark:bg-red-700/70 ring-2 ring-inset ring-red-600'
                              : isLight
                              ? 'bg-amber-100 dark:bg-slate-600'
                              : 'bg-amber-800/85 dark:bg-slate-800 text-white'
                          }`}
                        >
                          {isLegalEmpty && (
                            <span className="w-3 h-3 rounded-full bg-emerald-500/80 ring-2 ring-white/70" />
                          )}
                          {cell && <span className="relative z-10 leading-none">{cell}</span>}
                        </button>
                      );
                    })
                  )}
                </div>

                {chessWinner && (
                  <div className="mt-3 w-full p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center justify-between gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    <span className="flex items-center gap-2">
                      <Crown className="w-4 h-4 text-amber-500 shrink-0" />
                      {chessWinner === 'draw'
                        ? 'Stalemate Draw! +20 JIT Points'
                        : `${chessWinner === 'white' ? 'White' : 'Black'} wins by Checkmate!`}
                    </span>
                    <button
                      type="button"
                      onClick={() => resetChess(true)}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-bold"
                    >
                      Rematch
                    </button>
                  </div>
                )}

                <div className="w-full mt-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-xs space-y-1">
                  <p className="font-semibold text-slate-700 dark:text-slate-300 text-[11px] uppercase tracking-wider">
                    Move History:
                  </p>
                  {chessMoveLog.map((log, i) => (
                    <p key={i} className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      {log}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* ----------------------------------------------------------- */}
            {/* GAME 5: SNAKE & LADDER (True Boustrophedon + SVG Snk/Ladder) */}
            {/* ----------------------------------------------------------- */}
            {selectedGame === 'snake_ladder' && (
              <div className="max-w-md mx-auto flex flex-col items-center">
                <div className="w-full mb-3 flex items-center justify-between text-xs font-bold px-1">
                  <span className={slTurn === 'p1' ? 'text-blue-600' : 'text-slate-400'}>
                    You 📍: Sq {slPositions.p1}/100
                  </span>
                  <button
                    type="button"
                    onClick={() => resetSnakeLadder(true)}
                    className="text-xs font-semibold px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </button>
                  <span className={slTurn === 'p2' ? 'text-amber-500' : 'text-slate-400'}>
                    {gameMode === 'ai' ? 'AI' : 'P2'} ⭐: Sq {slPositions.p2}/100
                  </span>
                </div>

                {/* 10x10 Boustrophedon Board with SVG Ladder & Snake overlay */}
                <div className="relative w-full aspect-square max-w-[min(380px,calc(100vw-2.25rem),52dvh)] p-1.5 bg-slate-200 dark:bg-slate-800 rounded-2xl border-2 border-slate-300 dark:border-slate-700 select-none touch-manipulation">
                  <div className="grid grid-cols-10 grid-rows-10 gap-[2px] w-full h-full">
                    {boustrophedonSquares.map((squareNum) => {
                      const p1Here = slPositions.p1 === squareNum;
                      const p2Here = slPositions.p2 === squareNum;
                      const isSnakeHead = Boolean(SL_SNAKES[squareNum]);
                      const isLadderBase = Boolean(SL_LADDERS[squareNum]);

                      return (
                        <div
                          key={squareNum}
                          className={`rounded-md flex flex-col items-center justify-center text-[9px] font-mono font-bold relative overflow-hidden ${
                            squareNum === 100
                              ? 'bg-amber-300 text-slate-900'
                              : isLadderBase
                              ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300'
                              : isSnakeHead
                              ? 'bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300'
                              : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          <span className="leading-none">{squareNum}</span>
                          {(p1Here || p2Here) && (
                            <div className="absolute inset-0 flex items-center justify-center gap-0.5 bg-black/15 z-20">
                              {p1Here && <span className="text-xs leading-none">📍</span>}
                              {p2Here && <span className="text-xs leading-none">⭐</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* SVG Overlay connecting exact cell centers */}
                  <svg
                    viewBox="0 0 100 100"
                    className="absolute inset-1.5 w-[calc(100%-0.75rem)] h-[calc(100%-0.75rem)] pointer-events-none z-10"
                    aria-hidden="true"
                  >
                    {Object.entries(SL_LADDERS).map(([fromStr, toNum]) => {
                      const a = getSlCenterPct(Number(fromStr));
                      const b = getSlCenterPct(toNum);
                      return (
                        <g key={`lad-${fromStr}`} opacity="0.72">
                          <line
                            x1={a.x - 1.2}
                            y1={a.y}
                            x2={b.x - 1.2}
                            y2={b.y}
                            stroke="#10B981"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                          />
                          <line
                            x1={a.x + 1.2}
                            y1={a.y}
                            x2={b.x + 1.2}
                            y2={b.y}
                            stroke="#10B981"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                          />
                        </g>
                      );
                    })}
                    {Object.entries(SL_SNAKES).map(([fromStr, toNum]) => {
                      const a = getSlCenterPct(Number(fromStr));
                      const b = getSlCenterPct(toNum);
                      const cx = (a.x + b.x) / 2 + 8;
                      const cy = (a.y + b.y) / 2;
                      return (
                        <g key={`snk-${fromStr}`} opacity="0.75">
                          <path
                            d={`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`}
                            fill="none"
                            stroke="#EF4444"
                            strokeWidth="1.8"
                            strokeDasharray="2 1.2"
                            strokeLinecap="round"
                          />
                          <circle cx={a.x} cy={a.y} r="1.8" fill="#DC2626" />
                        </g>
                      );
                    })}
                  </svg>
                </div>

                <div className="flex items-center gap-4 mt-4">
                  <button
                    type="button"
                    onClick={() => executeSnakeLadderRoll(slTurn, slPositions)}
                    disabled={
                      slRolling ||
                      slFinished ||
                      (gameMode === 'ai'
                        ? slTurn === 'p2'
                        : currentRoom
                        ? slTurn !== (currentRoom.hostId === activePlayer.id ? 'p1' : 'p2')
                        : false)
                    }
                    className="w-16 h-16 bg-white dark:bg-slate-900 border-2 border-emerald-500 rounded-2xl shadow-md flex items-center justify-center text-3xl font-black text-emerald-600 hover:scale-105 active:scale-95 disabled:opacity-50 transition-all"
                  >
                    {slDice}
                  </button>
                  <button
                    type="button"
                    onClick={() => executeSnakeLadderRoll(slTurn, slPositions)}
                    disabled={
                      slRolling ||
                      slFinished ||
                      (gameMode === 'ai'
                        ? slTurn === 'p2'
                        : currentRoom
                        ? slTurn !== (currentRoom.hostId === activePlayer.id ? 'p1' : 'p2')
                        : false)
                    }
                    className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-2xl text-xs font-bold shadow-md transition-colors min-h-[44px]"
                  >
                    {slFinished
                      ? 'Match Complete'
                      : slRolling
                      ? 'Rolling...'
                      : gameMode === 'ai' && slTurn === 'p2'
                      ? 'AI Rolling...'
                      : `Roll for ${slTurn === 'p1' ? 'Player 1 (📍)' : 'Player 2 (⭐)'} 🎲`}
                  </button>
                </div>

                {slMessage && (
                  <div className="mt-3 w-full p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs font-semibold text-emerald-800 dark:text-emerald-300 text-center">
                    {slMessage}
                  </div>
                )}
              </div>
            )}

            {/* ----------------------------------------------------------- */}
            {/* GAME 6: PHYSICS 2D CARROM */}
            {/* ----------------------------------------------------------- */}
            {selectedGame === 'carrom' && (
              <CarromBoard
                gameMode={gameMode}
                aiDifficulty={aiDifficulty}
                onMatchFinish={(outcome, summary, points) => {
                  triggerGameAward(`carrom_${Date.now()}`, {
                    gameId: 'carrom',
                    gameName: 'Carrom',
                    mode: gameMode,
                    outcome,
                    pointsEarned: points,
                    scoreSummary: summary,
                  });
                }}
              />
            )}

            {/* ----------------------------------------------------------- */}
            {/* GAME 7: DAILY LUCKY SPIN WHEEL */}
            {/* ----------------------------------------------------------- */}
            {selectedGame === 'spin_wheel' && (
              <SpinWheelGame
                userId={currentUser?.id || 'guest'}
                currentPoints={currentUser?.stats.rewardPoints || 0}
                onSpinReward={async (pts, label) => {
                  await triggerGameAward(`spin_${Date.now()}`, {
                    gameId: 'spin_wheel',
                    gameName: 'Lucky Spin',
                    mode: 'solo',
                    outcome: 'spin',
                    pointsEarned: pts,
                    scoreSummary: `Won ${label}`,
                  });
                }}
              />
            )}
            {/* ----------------------------------------------------------- */}
            {/* GAME 8: OPEN GROUP TRUTH & DARE */}
            {/* ----------------------------------------------------------- */}
            {selectedGame === 'truth_dare' && (
              <TruthAndDareGame
                players={
                  currentRoom
                    ? currentRoom.players
                    : [
                        {
                          id: activePlayer.id,
                          name: activePlayer.name,
                          avatar: activePlayer.avatar,
                          isHost: true,
                          isReady: true,
                        },
                      ]
                }
                waitingCount={currentRoom?.waitingPlayers?.length || 0}
                currentUserId={activePlayer.id}
                isHost={currentRoom ? isRoomHost : true}
                isSeatedActivePlayer={isSeatedActivePlayer}
                state={truthDareState}
                onUpdateState={(next, status = 'in_game') => {
                  setTruthDareState(next);
                  if (currentRoom) {
                    broadcastRoomMove('TD_MOVE', next, next.activePlayerId, status);
                  }
                }}
                onRoundAward={(points, summary) => {
                  triggerGameAward(`td_${Date.now()}`, {
                    gameId: 'truth_dare',
                    gameName: 'Truth & Dare',
                    mode: currentRoom ? gameMode : 'solo',
                    outcome: 'win',
                    pointsEarned: points,
                    scoreSummary: summary,
                  });
                }}
                onOpenHostPanel={currentRoom ? () => setIsHostPanelOpen(true) : undefined}
              />
            )}

            {/* Instant Floating Emoji Reaction Bar across all active games */}
            {selectedGame !== 'spin_wheel' && (
              <QuickReactionBar onSendReaction={handleSendReaction} />
            )}
          </section>

          {/* Quick Footer Banner to Leaderboard */}
          <div className="p-4 rounded-3xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Trophy className="w-5 h-5 text-amber-500 shrink-0" />
              <div>
                <p className="text-xs font-bold text-slate-900 dark:text-white">
                  Campus Global Leaderboard & Match History
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Every match win and Lucky Spin syncs directly to your Firebase rankings.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSubView('leaderboard')}
              className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-bold hover:opacity-90 transition-opacity"
            >
              Open Rankings
            </button>
          </div>
        </>
      )}

      {/* Floating Animated Reaction Overlay */}
      <FloatingReactionsOverlay reactions={floatingReactions} />

      {/* 4. Game Mode Select Modal */}
      <GameModeSelectModal
        isOpen={isModeSelectOpen}
        onClose={() => setIsModeSelectOpen(false)}
        gameId={selectedGame}
        onCreateFriendRoom={handleCreateFriendRoom}
        onJoinFriendRoom={handleJoinFriendRoom}
        onPlayRandom={handlePlayRandom}
        onCreateOpenGroupRoom={handleCreateOpenGroupRoom}
        onPlayAI={handlePlayAI}
        joinError={joinError}
        isSubmitting={isRoomSubmitting}
      />

      {/* 4b. Auto-Matchmaking Queue Timer Modal */}
      <MatchmakingQueueModal
        isOpen={isMatchmakingOpen}
        gameId={selectedGame}
        roomCode={currentRoom?.roomCode}
        onCancel={handleLeaveRoom}
        onFallbackToAI={handleFallbackToAI}
      />

      {/* 4c. Host Seat Rotation & Voice/Chat Moderation Panel */}
      <HostRoomControlPanel
        isOpen={isHostPanelOpen}
        onClose={() => setIsHostPanelOpen(false)}
        room={currentRoom}
        currentUserId={activePlayer.id}
        onToggleVoiceMute={handleHostToggleVoiceMute}
        onToggleChatMute={handleHostToggleChatMute}
        onKickPlayer={handleKickPlayer}
        onRotatePlayers={handleHostRotatePlayers}
      />

      {/* 5. 4-Digit Room Lobby Modal */}
      <RoomLobbyModal
        isOpen={isLobbyOpen}
        room={currentRoom}
        currentUserId={activePlayer.id}
        onStartGame={handleStartRoomGame}
        onKickPlayer={handleKickPlayer}
        onLeaveRoom={handleLeaveRoom}
        onFallbackToAI={handleFallbackToAI}
        onClose={() => setIsLobbyOpen(false)}
      />

      {/* 6. Live In-Game Chat Drawer */}
      <InGameChatDrawer
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        messages={chatMessages}
        currentUserId={activePlayer.id}
        onSendMessage={handleSendInGameMessage}
        mutedPlayerIds={mutedPlayerIds}
        onToggleMutePlayer={handleToggleMutePlayer}
        isHost={isRoomHost}
        isHostChatRestricted={isHostMutedMyChat}
        hostMutedChatIds={currentRoom?.mutedChatIds || []}
        hostMutedVoiceIds={currentRoom?.mutedVoiceIds || []}
        onHostToggleChatMute={handleHostToggleChatMute}
        onHostToggleVoiceMute={handleHostToggleVoiceMute}
        participants={allRoomParticipants}
      />

      {/* 7. In-Game Voice & Video Calling Dock */}
      {activeCallType && (
        <InGameCallOverlay
          callType={activeCallType}
          isActive={!!activeCallType}
          onEndCall={handleEndCall}
          callerName={
            currentRoom?.players.find((p) => p.id !== activePlayer.id)?.name || 'Opponent'
          }
          callerAvatar={
            currentRoom?.players.find((p) => p.id !== activePlayer.id)?.avatar
          }
        />
      )}

      {/* 8. Rules Modal */}
      {instructionsGame && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <div className="flex items-center gap-2.5">
                <GameLogo gameId={instructionsGame} size="sm" />
                <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  {APP_CONFIG.games.find((g) => g.id === instructionsGame)?.name} Rules
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setInstructionsGame(null)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300 mb-6">
              {getInstructions(instructionsGame).map((rule, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold font-mono">{idx + 1}.</span>
                  <span>{rule}</span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => setInstructionsGame(null)}
              className="w-full py-2.5 min-h-[44px] bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-bold transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
