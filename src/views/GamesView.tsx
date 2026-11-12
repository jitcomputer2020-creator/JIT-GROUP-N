/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * JIT GROUP - Advanced Multiplayer Gaming System
 * Supports 6 Games: Ludo, Tic Tac Toe, Quiz Battle, Chess, Snake & Ladder, and Carrom.
 * Modes: Play with Friend (4-digit code), Play with Random Player, and Play with AI Bot (Easy/Medium/Hard).
 * Integrated with Live In-Game Chat, In-Game Voice/Video Calling, Room Lobby, and Rematch.
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { GameId, NavTab } from '../types';
import { GameMode, AIDifficulty, MultiplayerRoom, InGameChatMessage } from '../types/multiplayer';
import { APP_CONFIG } from '../constants/branding';
import { multiplayerSocket } from '../services/multiplayerSocket';
import {
  getTicTacToeAIMove,
  getChessAIMove,
  getQuizAIMove,
  getLudoAIMove,
  getCarromAIMove,
} from '../services/gameAIEngine';

import { GameModeSelectModal } from '../components/games/GameModeSelectModal';
import { RoomLobbyModal } from '../components/games/RoomLobbyModal';
import { InGameChatDrawer } from '../components/games/InGameChatDrawer';
import { InGameCallOverlay } from '../components/games/InGameCallOverlay';
import { GameActionBar } from '../components/games/GameActionBar';

import {
  Gamepad2,
  Users,
  Trophy,
  Play,
  RotateCcw,
  Sparkles,
  Info,
  KeyRound,
  ShieldAlert,
  CheckCircle2,
  X,
  Bot,
  Timer,
  ChevronRight,
  Target,
  Shuffle,
  AlertCircle,
  Wifi,
  WifiOff,
} from 'lucide-react';

interface GamesViewProps {
  onNavigate: (tab: NavTab) => void;
}

export const GamesView: React.FC<GamesViewProps> = ({ onNavigate }) => {
  const { currentUser, claimDailyReward } = useAuth();

  // --------------------------------------------------------------------------
  // Selected Game & Multiplayer Mode State
  // --------------------------------------------------------------------------
  const [selectedGame, setSelectedGame] = useState<GameId>('tictactoe');
  const [gameMode, setGameMode] = useState<GameMode>('ai');
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('medium');
  const [isModeSelectOpen, setIsModeSelectOpen] = useState(false);
  const [isLobbyOpen, setIsLobbyOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [instructionsGame, setInstructionsGame] = useState<GameId | null>(null);

  // Room state
  const [currentRoom, setCurrentRoom] = useState<MultiplayerRoom | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);

  // In-Game Chat state
  const [chatMessages, setChatMessages] = useState<InGameChatMessage[]>([]);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [mutedPlayerIds, setMutedPlayerIds] = useState<string[]>([]);

  // In-Game Voice / Video Call state
  const [activeCallType, setActiveCallType] = useState<'voice' | 'video' | null>(null);

  // --------------------------------------------------------------------------
  // GAME 1: TIC TAC TOE STATE
  // --------------------------------------------------------------------------
  const [tttBoard, setTttBoard] = useState<(string | null)[]>(Array(9).fill(null));
  const [isXNext, setIsXNext] = useState(true);
  const [tttResult, setTttResult] = useState<string | null>(null);
  const [tttScores, setTttScores] = useState({ X: 0, O: 0 });

  // --------------------------------------------------------------------------
  // GAME 2: LUDO STATE
  // --------------------------------------------------------------------------
  const [ludoTurn, setLudoTurn] = useState<0 | 1 | 2 | 3>(0);
  const [ludoDice, setLudoDice] = useState(6);
  const [ludoRolling, setLudoRolling] = useState(false);
  const [ludoPositions, setLudoPositions] = useState<number[]>([0, 0, 0, 0]);
  const [ludoLog, setLudoLog] = useState<string[]>(['Match started. Player 1 (Red) to roll.']);

  const ludoColors = [
    { name: 'Red', bg: 'bg-red-500', text: 'text-red-500', light: 'bg-red-50 dark:bg-red-950/40' },
    { name: 'Green', bg: 'bg-emerald-500', text: 'text-emerald-500', light: 'bg-emerald-50 dark:bg-emerald-950/40' },
    { name: 'Yellow', bg: 'bg-amber-400', text: 'text-amber-500', light: 'bg-amber-50 dark:bg-amber-950/40' },
    { name: 'Blue', bg: 'bg-blue-600', text: 'text-blue-600', light: 'bg-blue-50 dark:bg-blue-950/40' },
  ];

  // --------------------------------------------------------------------------
  // GAME 3: QUIZ BATTLE STATE
  // --------------------------------------------------------------------------
  const quizQuestions = [
    {
      q: 'Which data structure follows the First-In-First-Out (FIFO) principle?',
      options: ['Stack', 'Queue', 'Binary Tree', 'Hash Map'],
      answer: 1,
      category: 'Computer Science',
    },
    {
      q: 'In WebRTC, what protocol is primarily used for media transport?',
      options: ['TCP', 'SRTP / UDP', 'FTP', 'HTTP/2'],
      answer: 1,
      category: 'Networking',
    },
    {
      q: 'What is the time complexity of searching in a balanced Binary Search Tree?',
      options: ['O(1)', 'O(n)', 'O(log n)', 'O(n log n)'],
      answer: 2,
      category: 'Algorithms',
    },
    {
      q: 'Which database isolation level prevents dirty reads, non-repeatable reads, and phantom reads?',
      options: ['Read Committed', 'Repeatable Read', 'Serializable', 'Read Uncommitted'],
      answer: 2,
      category: 'Databases',
    },
    {
      q: 'Which layer of the OSI model provides end-to-end communication control?',
      options: ['Data Link', 'Network', 'Transport', 'Presentation'],
      answer: 2,
      category: 'Computer Networks',
    },
  ];

  const [quizIndex, setQuizIndex] = useState(0);
  const [quizScore, setQuizScore] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [quizFinished, setQuizFinished] = useState(false);
  const [quizTimer, setQuizTimer] = useState(15);

  // --------------------------------------------------------------------------
  // GAME 4: CHESS STATE
  // --------------------------------------------------------------------------
  const initialChessBoard = [
    ['♜', '♞', '♝', '♛', '♚', '♝', '♞', '♜'],
    ['♟', '♟', '♟', '♟', '♟', '♟', '♟', '♟'],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    ['♙', '♙', '♙', '♙', '♙', '♙', '♙', '♙'],
    ['♖', '♘', '♗', '♕', '♔', '♗', '♘', '♖'],
  ];

  const [chessBoard, setChessBoard] = useState<(string | null)[][]>(initialChessBoard);
  const [selectedSquare, setSelectedSquare] = useState<[number, number] | null>(null);
  const [chessTurn, setChessTurn] = useState<'white' | 'black'>('white');
  const [chessMoveLog, setChessMoveLog] = useState<string[]>(['Match initialized. White to move.']);

  // --------------------------------------------------------------------------
  // GAME 5: SNAKE & LADDER STATE
  // --------------------------------------------------------------------------
  const [slPosition, setSlPosition] = useState(1);
  const [slDice, setSlDice] = useState(1);
  const [slRolling, setSlRolling] = useState(false);
  const [slMessage, setSlMessage] = useState<string | null>(null);

  const snakes: Record<number, number> = { 98: 28, 62: 19, 47: 26, 29: 9 };
  const ladders: Record<number, number> = { 4: 14, 21: 42, 51: 67, 72: 91 };

  // --------------------------------------------------------------------------
  // GAME 6: CARROM STATE
  // --------------------------------------------------------------------------
  const [carromAimAngle, setCarromAimAngle] = useState(45);
  const [carromPower, setCarromPower] = useState(60);
  const [carromCoinsPocketed, setCarromCoinsPocketed] = useState(0);
  const [queenPocketed, setQueenPocketed] = useState(false);
  const [carromLog, setCarromLog] = useState<string[]>(['Striker placed on baseline. Adjust angle & power to strike.']);

  // --------------------------------------------------------------------------
  // WebSocket Lifecycle & Event Handlers
  // --------------------------------------------------------------------------
  useEffect(() => {
    multiplayerSocket.connect();

    const handleConnectionStatus = (data: { connected: boolean }) => {
      setSocketConnected(data.connected);
    };

    const handleRoomCreated = (data: { room: MultiplayerRoom; isQuickMatch?: boolean }) => {
      setCurrentRoom(data.room);
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
      currentTurn?: string;
    }) => {
      if (!currentRoom || currentRoom.roomCode !== data.roomCode) return;
      const { moveAction, gameState } = data;

      if (moveAction === 'TTT_MOVE' && gameState) {
        setTttBoard(gameState.board);
        setIsXNext(gameState.isXNext);
        setTttResult(gameState.result);
      } else if (moveAction === 'LUDO_MOVE' && gameState) {
        setLudoPositions(gameState.positions);
        setLudoTurn(gameState.turn);
        setLudoDice(gameState.dice);
        setLudoLog(gameState.log);
      } else if (moveAction === 'CHESS_MOVE' && gameState) {
        setChessBoard(gameState.board);
        setChessTurn(gameState.turn);
        setChessMoveLog(gameState.log);
      } else if (moveAction === 'SL_MOVE' && gameState) {
        setSlPosition(gameState.position);
        setSlDice(gameState.dice);
        setSlMessage(gameState.message);
      } else if (moveAction === 'CARROM_MOVE' && gameState) {
        setCarromCoinsPocketed(gameState.coins);
        setQueenPocketed(gameState.queen);
        setCarromLog(gameState.log);
      }
    };

    const handleGameReset = (data: { room: MultiplayerRoom }) => {
      setCurrentRoom(data.room);
      // Reset all game local states
      resetTtt(false);
      resetChess(false);
      resetQuiz(false);
    };

    const handleChatMessage = (data: { message: InGameChatMessage }) => {
      setChatMessages((prev) => [...prev, data.message]);
      if (!isChatOpen) {
        setUnreadChatCount((c) => c + 1);
      }
    };

    const handleCallSignal = (data: any) => {
      if (data.signalData?.type === 'CALL_START') {
        setActiveCallType(data.callType || 'video');
      } else if (data.signalData?.type === 'CALL_END') {
        setActiveCallType(null);
      }
    };

    const handlePlayerKicked = (data: { targetPlayerId: string; room: MultiplayerRoom }) => {
      if (data.targetPlayerId === currentUser?.id) {
        setCurrentRoom(null);
        setIsLobbyOpen(false);
        setJoinError('You were removed from the room by the host.');
      } else {
        setCurrentRoom(data.room);
      }
    };

    const handleError = (data: { code: string; message: string }) => {
      setJoinError(data.message || 'Room error occurred.');
    };

    multiplayerSocket.on('CONNECTION_STATUS', handleConnectionStatus);
    multiplayerSocket.on('ROOM_CREATED', handleRoomCreated);
    multiplayerSocket.on('ROOM_UPDATED', handleRoomUpdated);
    multiplayerSocket.on('GAME_STARTED', handleGameStarted);
    multiplayerSocket.on('GAME_STATE_UPDATED', handleGameStateUpdated);
    multiplayerSocket.on('GAME_RESET', handleGameReset);
    multiplayerSocket.on('CHAT_MESSAGE_RECEIVED', handleChatMessage);
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
      multiplayerSocket.off('CALL_SIGNAL_RECEIVED', handleCallSignal);
      multiplayerSocket.off('PLAYER_KICKED', handlePlayerKicked);
      multiplayerSocket.off('ERROR', handleError);
    };
  }, [currentUser?.id, currentRoom?.roomCode, isChatOpen]);

  // --------------------------------------------------------------------------
  // Multiplayer Room Creation & Joining Actions
  // --------------------------------------------------------------------------

  const handleCreateFriendRoom = () => {
    if (!currentUser) return;
    setGameMode('friend');
    setJoinError(null);
    multiplayerSocket.createRoom(selectedGame, 2, {
      id: currentUser.id,
      name: currentUser.fullName,
      avatar: currentUser.avatarUrl || APP_CONFIG.logoUrl,
    });
  };

  const handleJoinFriendRoom = (code: string) => {
    if (!currentUser) return;
    setGameMode('friend');
    setJoinError(null);
    multiplayerSocket.joinRoom(code, selectedGame, {
      id: currentUser.id,
      name: currentUser.fullName,
      avatar: currentUser.avatarUrl || APP_CONFIG.logoUrl,
    });
  };

  const handlePlayRandom = () => {
    if (!currentUser) return;
    setGameMode('random');
    setJoinError(null);
    multiplayerSocket.quickMatch(selectedGame, 2, {
      id: currentUser.id,
      name: currentUser.fullName,
      avatar: currentUser.avatarUrl || APP_CONFIG.logoUrl,
    });
  };

  const handlePlayAI = (diff: AIDifficulty) => {
    setGameMode('ai');
    setAiDifficulty(diff);
    setCurrentRoom(null);
    setIsModeSelectOpen(false);
    setIsLobbyOpen(false);
    // Reset game state for fresh AI duel
    resetTtt(false);
    resetChess(false);
    resetQuiz(false);
  };

  const handleStartRoomGame = () => {
    if (!currentRoom) return;
    multiplayerSocket.startGame(currentRoom.roomCode);
    setIsLobbyOpen(false);
  };

  const handleKickPlayer = (playerId: string) => {
    if (!currentRoom) return;
    multiplayerSocket.kickPlayer(currentRoom.roomCode, playerId);
  };

  const handleLeaveRoom = () => {
    if (currentRoom && currentUser) {
      multiplayerSocket.leaveRoom(currentRoom.roomCode, currentUser.id);
    }
    setCurrentRoom(null);
    setIsLobbyOpen(false);
    setActiveCallType(null);
    setGameMode('ai');
  };

  // --------------------------------------------------------------------------
  // Live Chat & Calling Actions
  // --------------------------------------------------------------------------

  const handleSendInGameMessage = (text?: string, imageUrl?: string) => {
    if (!currentUser) return;
    const roomCode = currentRoom?.roomCode || 'LOCAL_ROOM';
    const msg = {
      senderId: currentUser.id,
      senderName: currentUser.fullName,
      senderAvatar: currentUser.avatarUrl || APP_CONFIG.logoUrl,
      text,
      imageUrl,
    };

    if (currentRoom) {
      multiplayerSocket.sendChatMessage(roomCode, msg);
    } else {
      // Local fallback simulation
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

  const handleToggleMutePlayer = (playerId: string) => {
    setMutedPlayerIds((prev) =>
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]
    );
  };

  const handleStartCall = (type: 'voice' | 'video') => {
    setActiveCallType(type);
    if (currentRoom && currentUser) {
      multiplayerSocket.sendCallSignal(
        currentRoom.roomCode,
        { type: 'CALL_START' },
        undefined,
        currentUser.id,
        type
      );
    }
  };

  const handleEndCall = () => {
    if (currentRoom && currentUser) {
      multiplayerSocket.sendCallSignal(
        currentRoom.roomCode,
        { type: 'CALL_END' },
        undefined,
        currentUser.id
      );
    }
    setActiveCallType(null);
  };

  // --------------------------------------------------------------------------
  // GAME 1: TIC TAC TOE LOGIC
  // --------------------------------------------------------------------------
  const checkTttWinner = (squares: (string | null)[]) => {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6],
    ];
    for (const [a, b, c] of lines) {
      if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
        return squares[a];
      }
    }
    return squares.every(Boolean) ? 'draw' : null;
  };

  const handleTttClick = (index: number) => {
    if (tttBoard[index] || tttResult) return;

    // In multiplayer, check turn
    if (gameMode !== 'ai' && currentRoom) {
      const isHost = currentRoom.hostId === currentUser?.id;
      const mySymbol = isHost ? 'X' : 'O';
      const currentSymbol = isXNext ? 'X' : 'O';
      if (mySymbol !== currentSymbol) {
        return; // Not my turn!
      }
    }

    const nextSymbol = isXNext ? 'X' : 'O';
    const newBoard = [...tttBoard];
    newBoard[index] = nextSymbol;
    const winner = checkTttWinner(newBoard);
    const nextTurnBool = !isXNext;

    let resStr: string | null = null;
    if (winner) {
      resStr = winner === 'draw' ? 'Match Drawn!' : `Player ${winner} Won! +25 JIT Points`;
      setTttScores((prev) => ({
        ...prev,
        [winner as 'X' | 'O']: (prev[winner as 'X' | 'O'] || 0) + 1,
      }));
    }

    setTttBoard(newBoard);
    setIsXNext(nextTurnBool);
    setTttResult(resStr);

    // Sync to multiplayer room if active
    if (currentRoom) {
      multiplayerSocket.sendMove(
        currentRoom.roomCode,
        'TTT_MOVE',
        { board: newBoard, isXNext: nextTurnBool, result: resStr },
        nextTurnBool ? currentRoom.players[0]?.id : currentRoom.players[1]?.id
      );
    }

    // AI Opponent move
    if (gameMode === 'ai' && !winner && isXNext) {
      setTimeout(() => {
        const aiMove = getTicTacToeAIMove(newBoard, aiDifficulty);
        if (aiMove !== -1) {
          newBoard[aiMove] = 'O';
          const aiWinner = checkTttWinner(newBoard);
          let aiRes: string | null = null;
          if (aiWinner) {
            aiRes = aiWinner === 'draw' ? 'Match Drawn!' : `Campus AI Bot (O) Won!`;
            setTttScores((prev) => ({ ...prev, O: prev.O + 1 }));
          }
          setTttBoard([...newBoard]);
          setIsXNext(true);
          setTttResult(aiRes);
        }
      }, 500);
    }
  };

  const resetTtt = (sync = true) => {
    setTttBoard(Array(9).fill(null));
    setIsXNext(true);
    setTttResult(null);
    if (sync && currentRoom) {
      multiplayerSocket.rematchGame(currentRoom.roomCode, {
        board: Array(9).fill(null),
        isXNext: true,
        result: null,
      });
    }
  };

  // --------------------------------------------------------------------------
  // GAME 2: LUDO LOGIC
  // --------------------------------------------------------------------------
  const rollLudoDice = () => {
    if (ludoRolling) return;
    setLudoRolling(true);

    const interval = setInterval(() => {
      setLudoDice(Math.floor(Math.random() * 6) + 1);
    }, 70);

    setTimeout(() => {
      clearInterval(interval);
      const roll = Math.floor(Math.random() * 6) + 1;
      setLudoDice(roll);
      setLudoRolling(false);

      const currentColor = ludoColors[ludoTurn];
      const newPos = Math.min(56, ludoPositions[ludoTurn] + roll);
      const updated = [...ludoPositions];
      updated[ludoTurn] = newPos;
      setLudoPositions(updated);

      const newLog = [
        `${currentColor.name} rolled a ${roll} → Advanced to step ${newPos}/56`,
        ...ludoLog.slice(0, 3),
      ];
      setLudoLog(newLog);

      const nextTurn = roll === 6 ? ludoTurn : (((ludoTurn + 1) % 4) as 0 | 1 | 2 | 3);
      setLudoTurn(nextTurn);

      if (currentRoom) {
        multiplayerSocket.sendMove(currentRoom.roomCode, 'LUDO_MOVE', {
          positions: updated,
          turn: nextTurn,
          dice: roll,
          log: newLog,
        });
      }

      // AI turn trigger if AI mode and not player 0
      if (gameMode === 'ai' && nextTurn !== 0) {
        setTimeout(() => {
          triggerLudoAITurn(nextTurn, updated, newLog);
        }, 1000);
      }
    }, 500);
  };

  const triggerLudoAITurn = (turnIdx: number, positions: number[], currentLog: string[]) => {
    const roll = Math.floor(Math.random() * 6) + 1;
    const aiColor = ludoColors[turnIdx];
    const newPos = getLudoAIMove(positions, turnIdx, roll, aiDifficulty);
    const updated = [...positions];
    updated[turnIdx] = newPos;
    setLudoPositions(updated);
    setLudoDice(roll);

    const newLog = [
      `🤖 ${aiColor.name} (AI) rolled a ${roll} → Advanced to ${newPos}/56`,
      ...currentLog.slice(0, 3),
    ];
    setLudoLog(newLog);

    const nextTurn = roll === 6 ? turnIdx : (((turnIdx + 1) % 4) as 0 | 1 | 2 | 3);
    setLudoTurn(nextTurn as 0 | 1 | 2 | 3);

    if (nextTurn !== 0) {
      setTimeout(() => triggerLudoAITurn(nextTurn, updated, newLog), 1000);
    }
  };

  // --------------------------------------------------------------------------
  // GAME 3: QUIZ BATTLE LOGIC
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (selectedGame !== 'quiz' || quizFinished) return;
    const timer = setInterval(() => {
      setQuizTimer((t) => {
        if (t <= 1) {
          handleQuizNext(null);
          return 15;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [selectedGame, quizIndex, quizFinished]);

  const handleQuizNext = (optIdx: number | null) => {
    setSelectedOption(optIdx);
    const curr = quizQuestions[quizIndex];
    if (optIdx === curr.answer) {
      setQuizScore((s) => s + 100);
    }

    setTimeout(() => {
      if (quizIndex < quizQuestions.length - 1) {
        setQuizIndex(quizIndex + 1);
        setSelectedOption(null);
        setQuizTimer(15);
      } else {
        setQuizFinished(true);
      }
    }, 700);
  };

  const resetQuiz = (sync = true) => {
    setQuizIndex(0);
    setQuizScore(0);
    setSelectedOption(null);
    setQuizFinished(false);
    setQuizTimer(15);
  };

  // --------------------------------------------------------------------------
  // GAME 4: CHESS LOGIC
  // --------------------------------------------------------------------------
  const handleChessSquareClick = (r: number, c: number) => {
    if (!selectedSquare) {
      if (chessBoard[r][c]) {
        setSelectedSquare([r, c]);
      }
    } else {
      const [sr, sc] = selectedSquare;
      if (sr === r && sc === c) {
        setSelectedSquare(null);
        return;
      }

      const newBoard = chessBoard.map((row) => [...row]);
      const piece = newBoard[sr][sc];
      const captured = newBoard[r][c];
      newBoard[r][c] = piece;
      newBoard[sr][sc] = null;

      const nextTurn = chessTurn === 'white' ? 'black' : 'white';
      const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      const fromCoord = `${files[sc]}${8 - sr}`;
      const toCoord = `${files[c]}${8 - r}`;
      const newLog = [
        `${piece} ${fromCoord} → ${toCoord}${captured ? ` (captured ${captured})` : ''}`,
        ...chessMoveLog.slice(0, 4),
      ];

      setChessBoard(newBoard);
      setSelectedSquare(null);
      setChessTurn(nextTurn);
      setChessMoveLog(newLog);

      if (currentRoom) {
        multiplayerSocket.sendMove(currentRoom.roomCode, 'CHESS_MOVE', {
          board: newBoard,
          turn: nextTurn,
          log: newLog,
        });
      }

      // AI Bot Move if AI Mode
      if (gameMode === 'ai' && nextTurn === 'black') {
        setTimeout(() => {
          const aiMove = getChessAIMove(newBoard, aiDifficulty);
          if (aiMove) {
            const [fsr, fsc] = aiMove.from;
            const [ftr, ftc] = aiMove.to;
            newBoard[ftr][ftc] = aiMove.piece;
            newBoard[fsr][fsc] = null;

            const aiLog = [
              `🤖 AI ${aiMove.piece} ${files[fsc]}${8 - fsr} → ${files[ftc]}${8 - ftr}${
                aiMove.captured ? ` (captured ${aiMove.captured})` : ''
              }`,
              ...newLog.slice(0, 4),
            ];

            setChessBoard([...newBoard]);
            setChessTurn('white');
            setChessMoveLog(aiLog);
          }
        }, 600);
      }
    }
  };

  const resetChess = (sync = true) => {
    setChessBoard(initialChessBoard);
    setSelectedSquare(null);
    setChessTurn('white');
    setChessMoveLog(['Match reset. White to move.']);
  };

  // --------------------------------------------------------------------------
  // GAME 5: SNAKE & LADDER LOGIC
  // --------------------------------------------------------------------------
  const rollSnakeLadder = () => {
    if (slRolling) return;
    setSlRolling(true);
    setSlMessage(null);

    const interval = setInterval(() => {
      setSlDice(Math.floor(Math.random() * 6) + 1);
    }, 70);

    setTimeout(() => {
      clearInterval(interval);
      const roll = Math.floor(Math.random() * 6) + 1;
      setSlDice(roll);
      setSlRolling(false);

      let nextPos = slPosition + roll;
      if (nextPos > 100) nextPos = slPosition;

      let msg: string | null = null;
      if (ladders[nextPos]) {
        const climbedTo = ladders[nextPos];
        msg = `🎉 Climbed ladder from ${nextPos} to ${climbedTo}!`;
        nextPos = climbedTo;
      } else if (snakes[nextPos]) {
        const bittenTo = snakes[nextPos];
        msg = `🐍 Snake bite! Slid from ${nextPos} to ${bittenTo}!`;
        nextPos = bittenTo;
      } else if (nextPos === 100) {
        msg = '🏆 Reached Square 100! +100 JIT Points awarded.';
      }

      setSlPosition(nextPos);
      setSlMessage(msg);

      if (currentRoom) {
        multiplayerSocket.sendMove(currentRoom.roomCode, 'SL_MOVE', {
          position: nextPos,
          dice: roll,
          message: msg,
        });
      }
    }, 500);
  };

  // --------------------------------------------------------------------------
  // GAME 6: CARROM LOGIC
  // --------------------------------------------------------------------------
  const handleCarromStrike = () => {
    let success = Math.random() < carromPower / 100;
    if (gameMode === 'ai') {
      const aiParams = getCarromAIMove(aiDifficulty);
      success = Math.random() < aiParams.successRate;
    }

    let updatedCoins = carromCoinsPocketed;
    let updatedQueen = queenPocketed;
    let newLogEntry = '';

    if (success) {
      const pocketQueen = !queenPocketed && Math.random() > 0.6;
      if (pocketQueen) {
        updatedQueen = true;
        updatedCoins += 1;
        newLogEntry = '👑 Red Queen Pocketed! +50 Points bonus.';
      } else {
        updatedCoins += 1;
        newLogEntry = `🎯 Coin pocketed in corner! Angle: ${carromAimAngle}° | Power: ${carromPower}%`;
      }
    } else {
      newLogEntry = `Rebound missed pocket! Angle: ${carromAimAngle}°. Readjust striker angle.`;
    }

    const newLog = [newLogEntry, ...carromLog.slice(0, 3)];
    setCarromCoinsPocketed(updatedCoins);
    setQueenPocketed(updatedQueen);
    setCarromLog(newLog);

    if (currentRoom) {
      multiplayerSocket.sendMove(currentRoom.roomCode, 'CARROM_MOVE', {
        coins: updatedCoins,
        queen: updatedQueen,
        log: newLog,
      });
    }
  };

  const getInstructions = (gameId: GameId) => {
    switch (gameId) {
      case 'ludo':
        return [
          '2 to 4 players race tokens around the colorful cross board to the home triangle.',
          'Roll a 6 to bring a new token out of the yard.',
          'Safe squares are marked and protect your tokens from opponent capture.',
          'First player to bring all tokens into the center triangle wins.',
        ];
      case 'tictactoe':
        return [
          'Take turns placing X and O marks on a 3x3 grid.',
          'Align 3 marks horizontally, vertically, or diagonally to win.',
          'Choose between 4-digit friend room, random match, or campus AI Bot.',
        ];
      case 'quiz':
        return [
          'Timed trivia speed rounds across Computer Science, Networks, and Algorithms.',
          'Answer within 15 seconds to gain maximum points.',
          'Compete for the highest accuracy on the campus scoreboard.',
        ];
      case 'chess':
        return [
          'International standard 64-square chessboard duel.',
          'Click a piece to select, then click destination square to execute the move.',
          'White moves first, alternating turns with Black.',
        ];
      case 'snake_ladder':
        return [
          'Roll the die to travel from square 1 to square 100.',
          'Land on green ladder rungs to advance immediately upward.',
          'Avoid snake heads which cause you to slide down.',
        ];
      case 'carrom':
        return [
          'Flick the striker from the baseline into carrom men.',
          'Pocket white and black coins into the 4 corner pockets.',
          'Pocket the Red Queen and follow up with a cover coin to score big points.',
        ];
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto w-full">
      {/* 1. Header Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-800 p-6 sm:p-8 text-white shadow-xl">
        <div className="relative z-10 max-w-xl">
          <div className="flex items-center gap-2 mb-2">
            <Gamepad2 className="w-5 h-5 text-amber-300" />
            <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
              JIT Multiplayer Gaming Arena
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight mb-2">
            6 Fully Playable Campus Games
          </h2>
          <p className="text-xs sm:text-sm text-blue-100 leading-relaxed mb-4">
            Play with Friends via 4-digit room codes, queue for Random Matches, or duel campus AI Bots across all 6 games with integrated live chat and voice/video calling!
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-black/30 backdrop-blur-md rounded-xl text-xs font-semibold">
              {socketConnected ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300">Live WebSocket Connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-300" />
                  <span>Connecting to Realtime Server...</span>
                </>
              )}
            </div>

            <button
              onClick={() => setIsModeSelectOpen(true)}
              className="px-3.5 py-1.5 bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-colors"
            >
              Change Game Mode
            </button>
          </div>
        </div>
      </section>

      {/* 2. Choose Game Strip */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            Choose Game
          </h3>
          <span className="text-xs text-slate-400 font-medium">All 6 Active</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-2.5">
          {APP_CONFIG.games.map((g) => {
            const isSelected = selectedGame === g.id;
            return (
              <button
                key={g.id}
                onClick={() => {
                  setSelectedGame(g.id as GameId);
                  setIsModeSelectOpen(true);
                }}
                className={`p-2.5 sm:p-3 rounded-2xl border text-center transition-all min-h-[44px] flex flex-col justify-center active:scale-[0.98] touch-manipulate ${
                  isSelected
                    ? 'bg-blue-600 text-white border-blue-600 shadow-md scale-102'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-blue-400'
                }`}
              >
                <p className="text-xs font-bold truncate">{g.name}</p>
                <p className={`text-[10px] mt-0.5 truncate ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>
                  {g.category}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Active Playable Arena */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-3.5 sm:p-6 shadow-sm">
        {/* Game Action & Communication Header */}
        <GameActionBar
          gameMode={gameMode}
          roomCode={currentRoom?.roomCode}
          unreadChatCount={unreadChatCount}
          isCallActive={!!activeCallType}
          onOpenChat={() => {
            setIsChatOpen(true);
            setUnreadChatCount(0);
          }}
          onStartVoiceCall={() => handleStartCall('voice')}
          onStartVideoCall={() => handleStartCall('video')}
          onOpenMembers={() => setIsLobbyOpen(true)}
          onInviteFriend={() => setIsLobbyOpen(true)}
          onLeaveRoom={handleLeaveRoom}
          aiDifficulty={aiDifficulty}
        />

        {/* ------------------------------------------------------------- */}
        {/* GAME 1: TIC TAC TOE INTERFACE */}
        {/* ------------------------------------------------------------- */}
        {selectedGame === 'tictactoe' && (
          <div className="max-w-sm mx-auto flex flex-col items-center">
            <div className="flex items-center justify-between w-full mb-4 px-2">
              <button
                onClick={() => setIsModeSelectOpen(true)}
                className="px-3 py-1 rounded-xl text-xs font-semibold border flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 border-blue-200 dark:border-blue-800"
              >
                <Bot className="w-3.5 h-3.5" />
                <span className="capitalize">Mode: {gameMode}</span>
              </button>
              <button
                onClick={() => resetTtt(true)}
                className="text-xs text-slate-500 hover:text-blue-600 flex items-center gap-1 font-semibold"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Rematch</span>
              </button>
            </div>

            <div className="flex items-center justify-between w-full mb-4 px-2 text-xs font-bold">
              <span className={isXNext ? 'text-blue-600' : 'text-slate-400'}>
                Player X: {tttScores.X}
              </span>
              <span className="text-slate-400">vs</span>
              <span className={!isXNext ? 'text-emerald-500' : 'text-slate-400'}>
                {gameMode === 'ai' ? `Campus Bot (O)` : 'Opponent (O)'}: {tttScores.O}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2.5 p-3 bg-slate-100 dark:bg-slate-800/80 rounded-2xl w-full aspect-square max-w-[min(280px,100%)] touch-manipulate select-none">
              {tttBoard.map((cell, idx) => (
                <button
                  key={idx}
                  onClick={() => handleTttClick(idx)}
                  className={`w-full h-full rounded-xl flex items-center justify-center text-3xl font-black transition-all ${
                    cell === 'X'
                      ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-sm'
                      : cell === 'O'
                      ? 'bg-white dark:bg-slate-900 text-emerald-500 shadow-sm'
                      : 'bg-white/60 dark:bg-slate-900/60 hover:bg-white dark:hover:bg-slate-900 text-transparent'
                  }`}
                >
                  {cell}
                </button>
              ))}
            </div>

            {tttResult && (
              <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl text-xs font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                <span>{tttResult}</span>
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* GAME 2: LUDO INTERFACE */}
        {/* ------------------------------------------------------------- */}
        {selectedGame === 'ludo' && (
          <div className="max-w-lg mx-auto flex flex-col items-center">
            {/* Player Turn Bar */}
            <div className="grid grid-cols-4 gap-2 w-full mb-4">
              {ludoColors.map((c, idx) => {
                const isCurrent = ludoTurn === idx;
                return (
                  <div
                    key={c.name}
                    className={`p-2.5 rounded-2xl text-center border transition-all ${
                      isCurrent
                        ? `${c.light} border-current ${c.text} font-bold ring-2 ring-current/20 scale-102`
                        : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800 text-slate-500'
                    }`}
                  >
                    <p className="text-xs">{c.name}</p>
                    <p className="text-[11px] font-mono mt-0.5">{ludoPositions[idx]}/56</p>
                  </div>
                );
              })}
            </div>

            {/* Visual Ludo Race Tracks */}
            <div className="w-full bg-slate-50 dark:bg-slate-800/40 rounded-2xl p-4 mb-4 space-y-3">
              {ludoColors.map((c, idx) => {
                const pos = ludoPositions[idx];
                const pct = Math.min(100, Math.round((pos / 56) * 100));
                return (
                  <div key={c.name} className="space-y-1">
                    <div className="flex justify-between text-[11px] font-semibold">
                      <span className={c.text}>{c.name} Token</span>
                      <span className="font-mono text-slate-500">{pct}% to Home</span>
                    </div>
                    <div className="h-3 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${c.bg} transition-all duration-300`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Dice Control */}
            <div className="flex flex-col items-center gap-3 my-2">
              <button
                onClick={rollLudoDice}
                disabled={ludoRolling}
                className="w-20 h-20 bg-white dark:bg-slate-900 border-2 border-blue-500 rounded-2xl shadow-lg flex items-center justify-center text-4xl font-black text-blue-600 hover:scale-105 active:scale-95 transition-all"
              >
                {ludoDice}
              </button>
              <button
                onClick={rollLudoDice}
                disabled={ludoRolling}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md transition-colors"
              >
                {ludoRolling ? 'Rolling Dice...' : `Roll for ${ludoColors[ludoTurn].name} 🎲`}
              </button>
            </div>

            {/* Move Log */}
            <div className="w-full mt-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-xs text-slate-500 space-y-1">
              <p className="font-semibold text-slate-700 dark:text-slate-300 text-[11px] uppercase tracking-wider">
                Live Move Log:
              </p>
              {ludoLog.map((log, i) => (
                <p key={i} className="text-[11px] font-mono">{log}</p>
              ))}
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* GAME 3: QUIZ BATTLE INTERFACE */}
        {/* ------------------------------------------------------------- */}
        {selectedGame === 'quiz' && (
          <div className="max-w-md mx-auto">
            {!quizFinished ? (
              <div className="space-y-5">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-blue-600 font-mono">
                    Question {quizIndex + 1} of {quizQuestions.length}
                  </span>
                  <div className="flex items-center gap-1.5 text-amber-500 font-mono">
                    <Timer className="w-4 h-4" />
                    <span>{quizTimer}s</span>
                  </div>
                  <span className="text-emerald-500 font-mono">Score: {quizScore}</span>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-slate-400 mb-1 block">
                    {quizQuestions[quizIndex].category}
                  </span>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                    {quizQuestions[quizIndex].q}
                  </h4>
                </div>

                <div className="space-y-2">
                  {quizQuestions[quizIndex].options.map((opt, idx) => {
                    const isSelected = selectedOption === idx;
                    const isCorrect = idx === quizQuestions[quizIndex].answer;
                    let btnStyle = 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-blue-400';
                    if (selectedOption !== null) {
                      if (isCorrect) {
                        btnStyle = 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-600 font-bold';
                      } else if (isSelected) {
                        btnStyle = 'bg-red-50 dark:bg-red-950/60 border-red-500 text-red-600 font-bold';
                      }
                    }

                    return (
                      <button
                        key={idx}
                        onClick={() => selectedOption === null && handleQuizNext(idx)}
                        disabled={selectedOption !== null}
                        className={`w-full p-3 text-left text-xs rounded-xl border transition-all flex items-center justify-between ${btnStyle}`}
                      >
                        <span>{opt}</span>
                        <ChevronRight className="w-3.5 h-3.5 opacity-40" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="p-6 text-center space-y-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl">
                <Trophy className="w-12 h-12 text-amber-500 mx-auto" />
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  Quiz Battle Complete!
                </h4>
                <p className="text-2xl font-black font-mono text-blue-600 tabular-nums">
                  {quizScore} Points
                </p>
                <button
                  onClick={() => resetQuiz(true)}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-md transition-colors"
                >
                  Play Another Round
                </button>
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* GAME 4: CHESS INTERFACE */}
        {/* ------------------------------------------------------------- */}
        {selectedGame === 'chess' && (
          <div className="max-w-md mx-auto flex flex-col items-center">
            <div className="flex items-center justify-between w-full mb-3 text-xs font-bold px-2">
              <span className={chessTurn === 'white' ? 'text-blue-600' : 'text-slate-400'}>
                White to Move (♔)
              </span>
              <button
                onClick={() => resetChess(true)}
                className="text-xs text-slate-500 hover:text-blue-600 flex items-center gap-1 font-normal"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Board</span>
              </button>
              <span className={chessTurn === 'black' ? 'text-purple-600' : 'text-slate-400'}>
                Black (♚)
              </span>
            </div>

            {/* 8x8 Grid */}
            <div className="grid grid-cols-8 border-2 border-slate-700 rounded-2xl overflow-hidden shadow-lg w-full aspect-square max-w-[min(340px,100%)] touch-manipulate select-none">
              {chessBoard.map((row, r) =>
                row.map((cell, c) => {
                  const isLight = (r + c) % 2 === 0;
                  const isSelected = selectedSquare && selectedSquare[0] === r && selectedSquare[1] === c;
                  return (
                    <button
                      key={`${r}-${c}`}
                      onClick={() => handleChessSquareClick(r, c)}
                      className={`w-full h-full flex items-center justify-center text-xl sm:text-2xl transition-colors select-none ${
                        isSelected
                          ? 'bg-amber-300 ring-2 ring-amber-500'
                          : isLight
                          ? 'bg-amber-100 dark:bg-slate-700'
                          : 'bg-amber-800/80 dark:bg-slate-900 text-white'
                      }`}
                    >
                      {cell}
                    </button>
                  );
                })
              )}
            </div>

            <div className="w-full mt-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-xs space-y-1">
              <p className="font-semibold text-slate-700 dark:text-slate-300 text-[11px] uppercase tracking-wider">
                Move History:
              </p>
              {chessMoveLog.map((log, i) => (
                <p key={i} className="text-[11px] font-mono text-slate-500">{log}</p>
              ))}
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* GAME 5: SNAKE & LADDER INTERFACE */}
        {/* ------------------------------------------------------------- */}
        {selectedGame === 'snake_ladder' && (
          <div className="max-w-md mx-auto flex flex-col items-center">
            <div className="w-full mb-3 flex items-center justify-between text-xs font-bold px-2">
              <span className="text-emerald-600">Current Position: Square {slPosition} / 100</span>
              <span className="text-slate-400">Aim: Reach Square 100</span>
            </div>

            <div className="grid grid-cols-10 gap-0.5 sm:gap-1 p-1.5 sm:p-2 bg-slate-100 dark:bg-slate-800/70 rounded-2xl w-full aspect-square max-w-[min(340px,100%)] touch-manipulate select-none">
              {Array.from({ length: 100 }).map((_, i) => {
                const squareNum = 100 - i;
                const isPlayerHere = slPosition === squareNum;
                const isSnake = snakes[squareNum];
                const isLadder = ladders[squareNum];

                return (
                  <div
                    key={squareNum}
                    className={`rounded-md flex items-center justify-center text-[9px] font-mono font-bold transition-all relative ${
                      isPlayerHere
                        ? 'bg-blue-600 text-white ring-2 ring-blue-400 scale-110 z-10'
                        : isLadder
                        ? 'bg-emerald-200 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300'
                        : isSnake
                        ? 'bg-red-200 dark:bg-red-900/50 text-red-800 dark:text-red-300'
                        : 'bg-white dark:bg-slate-900 text-slate-400'
                    }`}
                  >
                    {isPlayerHere ? '📍' : squareNum}
                  </div>
                );
              })}
            </div>

            {/* Roll Dice Controller */}
            <div className="flex flex-col items-center gap-3 mt-4">
              <button
                onClick={rollSnakeLadder}
                disabled={slRolling}
                className="w-16 h-16 bg-white dark:bg-slate-900 border-2 border-emerald-500 rounded-2xl shadow-md flex items-center justify-center text-3xl font-black text-emerald-600 hover:scale-105 active:scale-95 transition-all"
              >
                {slDice}
              </button>
              <button
                onClick={rollSnakeLadder}
                disabled={slRolling}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md transition-colors"
              >
                {slRolling ? 'Rolling...' : 'Roll Dice 🎲'}
              </button>
            </div>

            {slMessage && (
              <div className="mt-3 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                {slMessage}
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* GAME 6: CARROM INTERFACE */}
        {/* ------------------------------------------------------------- */}
        {selectedGame === 'carrom' && (
          <div className="max-w-md mx-auto flex flex-col items-center">
            <div className="flex items-center justify-between w-full mb-3 text-xs font-bold px-2">
              <span className="text-amber-700 dark:text-amber-400">Coins Pocketed: {carromCoinsPocketed}</span>
              <span className={queenPocketed ? 'text-red-500' : 'text-slate-400'}>
                {queenPocketed ? '👑 Queen Pocketed!' : 'Queen in Center'}
              </span>
            </div>

            {/* Wooden Carrom Board Graphic */}
            <div className="relative w-full aspect-square max-w-[min(320px,100%)] rounded-3xl bg-amber-100 dark:bg-amber-950/40 border-4 sm:border-8 border-amber-900 shadow-2xl p-3 sm:p-4 flex flex-col justify-between touch-manipulate select-none">
              <div className="absolute top-2 left-2 w-7 h-7 rounded-full bg-slate-950 border border-slate-700 shadow-inner" />
              <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-slate-950 border border-slate-700 shadow-inner" />
              <div className="absolute bottom-2 left-2 w-7 h-7 rounded-full bg-slate-950 border border-slate-700 shadow-inner" />
              <div className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-slate-950 border border-slate-700 shadow-inner" />

              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full border-2 border-red-500/40 flex items-center justify-center">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow-md ${queenPocketed ? 'bg-transparent text-transparent' : 'bg-red-600 text-white'}`}>
                  {!queenPocketed && 'Q'}
                </div>
              </div>

              <div className="w-full h-1 bg-amber-700/40 mt-auto mb-4 relative flex justify-center">
                <div
                  className="w-8 h-8 rounded-full bg-white border-2 border-blue-600 shadow-lg -mt-3.5 flex items-center justify-center text-[10px] font-black text-blue-600"
                  style={{ transform: `rotate(${carromAimAngle}deg)` }}
                >
                  ▲
                </div>
              </div>
            </div>

            <div className="w-full mt-4 space-y-3 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl">
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold">
                  <span>Aim Angle: {carromAimAngle}°</span>
                  <span>Power: {carromPower}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="90"
                  value={carromAimAngle}
                  onChange={(e) => setCarromAimAngle(Number(e.target.value))}
                  className="w-full"
                />
              </div>

              <button
                onClick={handleCarromStrike}
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-md transition-colors flex items-center justify-center gap-2"
              >
                <Target className="w-4 h-4" />
                <span>Strike Coins!</span>
              </button>
            </div>

            <div className="w-full mt-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-xs space-y-1">
              {carromLog.map((log, i) => (
                <p key={i} className="text-[11px] font-mono text-slate-500">{log}</p>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 4. Game Mode Select Modal (With Friend 4-digit, Random, AI) */}
      <GameModeSelectModal
        isOpen={isModeSelectOpen}
        onClose={() => setIsModeSelectOpen(false)}
        gameId={selectedGame}
        onCreateFriendRoom={handleCreateFriendRoom}
        onJoinFriendRoom={handleJoinFriendRoom}
        onPlayRandom={handlePlayRandom}
        onPlayAI={handlePlayAI}
        joinError={joinError}
      />

      {/* 5. 4-Digit Room Lobby Modal */}
      <RoomLobbyModal
        isOpen={isLobbyOpen}
        room={currentRoom}
        currentUserId={currentUser?.id || ''}
        onStartGame={handleStartRoomGame}
        onKickPlayer={handleKickPlayer}
        onLeaveRoom={handleLeaveRoom}
        onClose={() => setIsLobbyOpen(false)}
      />

      {/* 6. Live In-Game Chat Drawer */}
      <InGameChatDrawer
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        messages={chatMessages}
        currentUserId={currentUser?.id || ''}
        onSendMessage={handleSendInGameMessage}
        mutedPlayerIds={mutedPlayerIds}
        onToggleMutePlayer={handleToggleMutePlayer}
      />

      {/* 7. In-Game Voice & Video Calling Dock */}
      {activeCallType && (
        <InGameCallOverlay
          callType={activeCallType}
          isActive={!!activeCallType}
          onEndCall={handleEndCall}
          callerName={currentRoom?.players.find((p) => p.id !== currentUser?.id)?.name || 'Opponent'}
          callerAvatar={currentRoom?.players.find((p) => p.id !== currentUser?.id)?.avatar}
        />
      )}

      {/* 8. Rules Modal */}
      {instructionsGame && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                {APP_CONFIG.games.find((g) => g.id === instructionsGame)?.name} Rules
              </h4>
              <button
                onClick={() => setInstructionsGame(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
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
              onClick={() => setInstructionsGame(null)}
              className="w-full py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-bold transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
