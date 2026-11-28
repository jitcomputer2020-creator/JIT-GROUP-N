/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TicTacToe Multiplayer & AI Board Component
 * Strictly uses Firestore `gameRooms/{roomId}` via real-time `onSnapshot` as
 * the single source of truth in multiplayer rooms (no un-synced local board mutations).
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Bot, RotateCcw, Sparkles, Users, Loader2 } from 'lucide-react';
import { db, auth, COL, handleFirestoreError, OperationType } from '../../lib/firebase';
import { GameId } from '../../types';
import { AIDifficulty, GameMode, RoomParticipantInfo } from '../../types/multiplayer';
import { checkTicTacToeWinner, getTicTacToeAIMove } from '../../services/gameAIEngine';
import { soundFx } from '../../utils/soundFx';

export interface TicTacToeGameProps {
  roomId?: string;
  gameMode: GameMode;
  aiDifficulty: AIDifficulty;
  localPlayerId: string;
  isWaitingSpectator?: boolean;
  onWaitingSpectatorBlocked?: () => void;
  onOpenModeSelect: () => void;
  onAwardMatch: (params: {
    gameId: GameId;
    gameName: string;
    mode: GameMode | 'solo';
    outcome: 'win' | 'loss' | 'draw';
    pointsEarned: number;
    scoreSummary: string;
  }) => void;
}

type CellValue = 'X' | 'O' | null;

function extractBoardFromSnapshot(
  rawBoardState: unknown,
  rawGameState: unknown
): CellValue[] {
  const normalize = (arr: unknown[]): CellValue[] =>
    Array.from({ length: 9 }, (_, i) => {
      const val = arr[i];
      return val === 'X' || val === 'O' ? val : null;
    });

  if (Array.isArray(rawBoardState)) {
    return normalize(rawBoardState);
  }
  if (rawBoardState && typeof rawBoardState === 'object') {
    const nestedBoard = (rawBoardState as Record<string, unknown>).board;
    if (Array.isArray(nestedBoard)) {
      return normalize(nestedBoard);
    }
  }
  if (rawGameState && typeof rawGameState === 'object') {
    const gsBoard = (rawGameState as Record<string, unknown>).board;
    if (Array.isArray(gsBoard)) {
      return normalize(gsBoard);
    }
  }
  return Array<CellValue>(9).fill(null);
}

function extractParticipantsFromSnapshot(data: Record<string, any>): {
  host: RoomParticipantInfo | null;
  guest: RoomParticipantInfo | null;
} {
  let parsedPlayers: Array<{ id?: string; name?: string; avatar?: string }> = [];
  if (typeof data.playersJson === 'string') {
    try {
      const arr = JSON.parse(data.playersJson);
      if (Array.isArray(arr)) parsedPlayers = arr;
    } catch {
      parsedPlayers = [];
    }
  }

  const hostId = String(
    data.host?.id || data.player1Id || data.player1 || data.hostId || parsedPlayers[0]?.id || ''
  );
  const hostName = String(
    data.host?.name || data.player1Name || parsedPlayers[0]?.name || 'Player 1'
  );
  const guestId = String(
    data.guest?.id || data.player2Id || data.player2 || parsedPlayers[1]?.id || ''
  );
  const guestName = String(
    data.guest?.name || data.player2Name || parsedPlayers[1]?.name || ''
  );

  return {
    host: hostId
      ? {
          id: hostId,
          name: hostName,
          symbol: 'X',
          avatar: data.host?.avatar || parsedPlayers[0]?.avatar || '',
        }
      : null,
    guest: guestId
      ? {
          id: guestId,
          name: guestName || 'Opponent',
          symbol: 'O',
          avatar: data.guest?.avatar || parsedPlayers[1]?.avatar || '',
        }
      : null,
  };
}

function extractScoresFromSnapshot(
  data: Record<string, any>,
  hostId: string,
  guestId: string
): { X: number; O: number } {
  const topScores = data.scores;
  if (topScores && typeof topScores === 'object') {
    if (typeof topScores.X === 'number' || typeof topScores.O === 'number') {
      return {
        X: Number(topScores.X || 0),
        O: Number(topScores.O || 0),
      };
    }
    return {
      X: hostId ? Number(topScores[hostId] || 0) : 0,
      O: guestId ? Number(topScores[guestId] || 0) : 0,
    };
  }
  const boardMapScores =
    data.boardState && typeof data.boardState === 'object' && !Array.isArray(data.boardState)
      ? data.boardState.scores
      : null;
  if (boardMapScores && typeof boardMapScores === 'object') {
    return {
      X: Number(boardMapScores.X || 0),
      O: Number(boardMapScores.O || 0),
    };
  }
  return { X: 0, O: 0 };
}

export const TicTacToeGame: React.FC<TicTacToeGameProps> = ({
  roomId,
  gameMode,
  aiDifficulty,
  localPlayerId,
  isWaitingSpectator = false,
  onWaitingSpectatorBlocked,
  onOpenModeSelect,
  onAwardMatch,
}) => {
  // Strictly treat any room-backed session OR non-'ai' mode as multiplayer (never fall back to AI)
  const isMultiplayer = Boolean(roomId) || gameMode !== 'ai';

  // Multiplayer Single Source of Truth hydrated ONLY by Firestore `onSnapshot`
  const [roomData, setRoomData] = useState<Record<string, any> | null>(null);
  const [boardState, setBoardState] = useState<CellValue[]>(() => Array<CellValue>(9).fill(null));
  const [currentTurn, setCurrentTurn] = useState<string>('');
  const [scores, setScores] = useState<{ X: number; O: number }>({ X: 0, O: 0 });

  // Isolated AI-only state (strictly unused when playing in a multiplayer room)
  const [aiBoard, setAiBoard] = useState<CellValue[]>(() => Array<CellValue>(9).fill(null));
  const [aiIsXNext, setAiIsXNext] = useState(true);
  const [aiScores, setAiScores] = useState<{ X: number; O: number }>({ X: 0, O: 0 });
  const [aiThinking, setAiThinking] = useState(false);

  const isWritingRef = useRef(false);
  const aiTimerRef = useRef<number | null>(null);
  const awardedRoundRef = useRef<string | null>(null);
  const prevBoardJsonRef = useRef<string>('');

  // Clear AI timers immediately if entering a room or changing mode
  useEffect(() => {
    if (isMultiplayer && aiTimerRef.current !== null) {
      window.clearTimeout(aiTimerRef.current);
      aiTimerRef.current = null;
      setAiThinking(false);
    }
    return () => {
      if (aiTimerRef.current !== null) {
        window.clearTimeout(aiTimerRef.current);
        aiTimerRef.current = null;
      }
    };
  }, [gameMode, aiDifficulty, roomId, isMultiplayer]);

  // Real-Time Firestore Single-Source-of-Truth Subscription
  useEffect(() => {
    isWritingRef.current = false;
    if (!roomId) {
      setRoomData(null);
      setBoardState(Array<CellValue>(9).fill(null));
      setCurrentTurn('');
      setScores({ X: 0, O: 0 });
      awardedRoundRef.current = null;
      prevBoardJsonRef.current = '';
      return;
    }

    const docRef = doc(db, COL.gameRooms, roomId);
    const unsub = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          const { host, guest } = extractParticipantsFromSnapshot(data);
          const nextBoard = extractBoardFromSnapshot(data.boardState, data.gameState);
          const nextTurn = String(
            data.currentTurnUserId || data.currentTurn || host?.id || ''
          );
          const nextScores = extractScoresFromSnapshot(data, host?.id || '', guest?.id || '');

          setRoomData(data);
          setBoardState(nextBoard);
          setCurrentTurn(nextTurn);
          setScores(nextScores);

          // Sound cue when remote board updates
          const serialized = JSON.stringify(nextBoard);
          if (
            prevBoardJsonRef.current &&
            prevBoardJsonRef.current !== serialized &&
            nextBoard.some((c) => c !== null)
          ) {
            soundFx.playMove();
          }
          prevBoardJsonRef.current = serialized;
        }
      },
      (err) => {
        if (err?.code === 'permission-denied') {
          handleFirestoreError(err, OperationType.GET, `gameRooms/${roomId}`);
        }
        console.warn('TicTacToe onSnapshot notice:', err);
      }
    );

    return () => {
      isWritingRef.current = false;
      unsub();
    };
  }, [roomId]);

  const activeBoard = isMultiplayer ? boardState : aiBoard;
  const activeScores = isMultiplayer ? scores : aiScores;
  const { winner, line: winningLine } = useMemo(
    () => checkTicTacToeWinner(activeBoard),
    [activeBoard]
  );

  const participants = useMemo(
    () => (roomData ? extractParticipantsFromSnapshot(roomData) : { host: null, guest: null }),
    [roomData]
  );
  const hostInfo = participants.host;
  const guestInfo = participants.guest;

  const actorId = localPlayerId;
  const p1Id = hostInfo?.id || '';
  const p2Id = guestInfo?.id || '';
  const isPlayer1 = Boolean(isMultiplayer && p1Id && actorId === p1Id);
  const mySymbol: 'X' | 'O' = isPlayer1 ? 'X' : 'O';
  const roomStatus = String(roomData?.status || 'waiting');
  const hasGuestJoined = Boolean(p2Id);
  const isWaitingForFriend = Boolean(
    isMultiplayer && (!roomData || !hasGuestJoined || roomStatus === 'waiting')
  );
  const resolvedTurnUserId =
    currentTurn || String(roomData?.currentTurnUserId || roomData?.currentTurn || p1Id || '');
  const isMyMultiplayerTurn = Boolean(
    isMultiplayer &&
      roomData &&
      !isWaitingSpectator &&
      !isWaitingForFriend &&
      roomStatus !== 'finished' &&
      !winner &&
      actorId &&
      resolvedTurnUserId &&
      actorId === resolvedTurnUserId
  );
  const isXTurn = isMultiplayer ? resolvedTurnUserId === p1Id : aiIsXNext;

  const hostDisplayName = hostInfo?.name || 'Player 1';
  const guestDisplayName = guestInfo?.name || 'Waiting...';

  // Award JIT Points once when a multiplayer match finishes via Firestore snapshot
  useEffect(() => {
    if (!isMultiplayer || !roomId || !roomData) return;
    if (!winner) {
      awardedRoundRef.current = null;
      return;
    }

    const roundSig = `${roomId}:${boardState.map((c) => c || '_').join('')}`;
    if (awardedRoundRef.current === roundSig) return;
    awardedRoundRef.current = roundSig;

    if (winner === 'draw') {
      soundFx.playMove();
      onAwardMatch({
        gameId: 'tictactoe',
        gameName: 'Tic Tac Toe',
        mode: gameMode === 'ai' ? 'friend' : gameMode,
        outcome: 'draw',
        pointsEarned: 10,
        scoreSummary: 'Draw (3x3)',
      });
    } else {
      const iWon = winner === mySymbol;
      if (iWon) soundFx.playWin();
      else soundFx.playMove();
      onAwardMatch({
        gameId: 'tictactoe',
        gameName: 'Tic Tac Toe',
        mode: gameMode === 'ai' ? 'friend' : gameMode,
        outcome: iWon ? 'win' : 'loss',
        pointsEarned: iWon ? 25 : 5,
        scoreSummary: iWon ? `${winner} Victory` : 'Opponent Victory',
      });
    }
  }, [isMultiplayer, roomId, roomData, winner, boardState, mySymbol, gameMode, onAwardMatch]);

  const resultMessage = useMemo(() => {
    if (!winner) return null;
    if (winner === 'draw') return 'Match Drawn! +10 JIT Points';
    if (!isMultiplayer) {
      if (winner === 'X') {
        const pts = aiDifficulty === 'hard' ? 35 : 25;
        return `Player X Won! +${pts} JIT Points`;
      }
      return `Campus AI Bot (${aiDifficulty}) Won! +5 Participation Points`;
    }
    return winner === mySymbol
      ? `You (${winner}) Won! +25 JIT Points`
      : `${winner === 'X' ? hostDisplayName : guestDisplayName} (${winner}) Won! +5 Participation Points`;
  }, [winner, isMultiplayer, aiDifficulty, mySymbol, hostDisplayName, guestDisplayName]);

  const handleCellClick = useCallback(
    async (index: number) => {
      if (isMultiplayer) {
        if (!roomId || !roomData || isWritingRef.current) return;
        if (isWaitingSpectator) {
          soundFx.playError();
          onWaitingSpectatorBlocked?.();
          return;
        }
        if (isWaitingForFriend || !p1Id || !p2Id) {
          soundFx.playError();
          return;
        }
        if (boardState[index] || winner) return;

        // Mandatory Turn Verification against canonical user IDs
        const activeTurnUid =
          currentTurn || String(roomData.currentTurnUserId || roomData.currentTurn || '');
        if (!actorId || actorId !== activeTurnUid) {
          soundFx.playError();
          return;
        }

        const nextBoard = [...boardState];
        nextBoard[index] = mySymbol;

        const nextTurn = actorId === p1Id ? p2Id : p1Id;
        const { winner: nextWinner } = checkTicTacToeWinner(nextBoard);
        const nextPairScores =
          nextWinner === 'X' || nextWinner === 'O'
            ? { ...scores, [nextWinner]: scores[nextWinner] + 1 }
            : scores;
        const nextUserScores: Record<string, number> = {
          [p1Id]: nextPairScores.X,
          [p2Id]: nextPairScores.O,
        };
        const nextWinnerId =
          nextWinner === 'X' ? p1Id : nextWinner === 'O' ? p2Id : null;
        const nextIsDraw = nextWinner === 'draw';

        soundFx.playMove();
        isWritingRef.current = true;
        try {
          // Direct Firestore Write ONLY — onSnapshot handles UI updates on both devices
          const roomRef = doc(db, COL.gameRooms, roomId);
          await updateDoc(roomRef, {
            boardState: {
              board: nextBoard,
              scores: nextPairScores,
              result: nextWinner || null,
            },
            gameStateJson: JSON.stringify({
              board: nextBoard,
              scores: nextPairScores,
              byPlayerId: actorId,
            }),
            currentTurn: nextTurn,
            currentTurnUserId: nextTurn,
            scores: nextUserScores,
            winnerId: nextWinnerId,
            isDraw: nextIsDraw,
            status: nextWinner ? 'finished' : 'playing',
            moveAction: 'TTT_MOVE',
            lastMove: {
              action: 'TTT_MOVE',
              byPlayerId: actorId,
              byAuthUid: auth.currentUser?.uid || null,
              summary: `${mySymbol} -> cell ${index + 1}`,
              timestampMs: Date.now(),
            },
            lastUpdated: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err: any) {
          if (err?.code === 'permission-denied') {
            handleFirestoreError(err, OperationType.UPDATE, `gameRooms/${roomId}`);
          }
          console.warn('TicTacToe updateDoc failed:', err);
        } finally {
          isWritingRef.current = false;
        }
        return;
      }

      // Offline / Solo AI Mode (strictly only when no roomId & gameMode === 'ai')
      if (aiBoard[index] || winner || aiThinking || !aiIsXNext) return;
      const nextAiBoard = [...aiBoard];
      nextAiBoard[index] = 'X';
      soundFx.playMove();
      setAiBoard(nextAiBoard);

      const playerCheck = checkTicTacToeWinner(nextAiBoard);
      if (playerCheck.winner) {
        if (playerCheck.winner === 'draw') {
          onAwardMatch({
            gameId: 'tictactoe',
            gameName: 'Tic Tac Toe',
            mode: 'ai',
            outcome: 'draw',
            pointsEarned: 10,
            scoreSummary: `Draw vs ${aiDifficulty} AI`,
          });
        } else {
          const pts = aiDifficulty === 'hard' ? 35 : 25;
          setAiScores((prev) => ({ ...prev, X: prev.X + 1 }));
          soundFx.playWin();
          onAwardMatch({
            gameId: 'tictactoe',
            gameName: 'Tic Tac Toe',
            mode: 'ai',
            outcome: 'win',
            pointsEarned: pts,
            scoreSummary: 'X Victory',
          });
        }
        return;
      }

      setAiIsXNext(false);
      setAiThinking(true);
      if (aiTimerRef.current !== null) {
        window.clearTimeout(aiTimerRef.current);
      }
      aiTimerRef.current = window.setTimeout(() => {
        aiTimerRef.current = null;
        if (roomId || gameMode !== 'ai') {
          setAiThinking(false);
          return;
        }
        const botBoard = [...nextAiBoard];
        const moveIdx = getTicTacToeAIMove(botBoard, aiDifficulty);
        if (moveIdx !== -1) {
          botBoard[moveIdx] = 'O';
          soundFx.playMove();
          const botCheck = checkTicTacToeWinner(botBoard);
          if (botCheck.winner) {
            if (botCheck.winner === 'draw') {
              onAwardMatch({
                gameId: 'tictactoe',
                gameName: 'Tic Tac Toe',
                mode: 'ai',
                outcome: 'draw',
                pointsEarned: 10,
                scoreSummary: `Draw vs ${aiDifficulty} AI`,
              });
            } else {
              setAiScores((prev) => ({ ...prev, O: prev.O + 1 }));
              onAwardMatch({
                gameId: 'tictactoe',
                gameName: 'Tic Tac Toe',
                mode: 'ai',
                outcome: 'loss',
                pointsEarned: 5,
                scoreSummary: `Lost to ${aiDifficulty} AI`,
              });
            }
          }
          setAiBoard(botBoard);
        }
        setAiIsXNext(true);
        setAiThinking(false);
      }, 420);
    },
    [
      isMultiplayer,
      roomId,
      roomData,
      isWaitingSpectator,
      onWaitingSpectatorBlocked,
      isWaitingForFriend,
      p1Id,
      p2Id,
      boardState,
      winner,
      currentTurn,
      actorId,
      mySymbol,
      scores,
      aiBoard,
      aiThinking,
      aiIsXNext,
      gameMode,
      aiDifficulty,
      onAwardMatch,
    ]
  );

  const handleRematch = useCallback(async () => {
    if (isMultiplayer) {
      if (!roomId || !roomData || isWaitingSpectator || isWritingRef.current) return;
      const firstTurn = p1Id || String(roomData.hostId || '');
      if (!firstTurn) return;
      isWritingRef.current = true;
      const preservedScores: Record<string, number> = {
        ...(p1Id ? { [p1Id]: scores.X } : {}),
        ...(p2Id ? { [p2Id]: scores.O } : {}),
      };
      const emptyBoard = Array<CellValue>(9).fill(null);
      try {
        const roomRef = doc(db, COL.gameRooms, roomId);
        await updateDoc(roomRef, {
          boardState: {
            board: emptyBoard,
            scores,
            result: null,
          },
          gameStateJson: JSON.stringify({
            board: emptyBoard,
            scores,
            byPlayerId: actorId,
          }),
          currentTurn: firstTurn,
          currentTurnUserId: firstTurn,
          scores: preservedScores,
          winnerId: null,
          isDraw: false,
          status: p2Id ? 'playing' : 'waiting',
          moveAction: 'REMATCH',
          lastMove: {
            action: 'REMATCH',
            byPlayerId: actorId,
            byAuthUid: auth.currentUser?.uid || null,
            summary: 'TicTacToe rematch started',
            timestampMs: Date.now(),
          },
          lastUpdated: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err: any) {
        if (err?.code === 'permission-denied') {
          handleFirestoreError(err, OperationType.UPDATE, `gameRooms/${roomId}`);
        }
        console.warn('TicTacToe rematch failed:', err);
      } finally {
        isWritingRef.current = false;
      }
      return;
    }

    if (aiTimerRef.current !== null) {
      window.clearTimeout(aiTimerRef.current);
      aiTimerRef.current = null;
    }
    setAiBoard(Array<CellValue>(9).fill(null));
    setAiIsXNext(true);
    setAiThinking(false);
  }, [isMultiplayer, roomId, roomData, isWaitingSpectator, p1Id, p2Id, scores, actorId]);

  return (
    <div className="max-w-sm mx-auto flex flex-col items-center">
      <div className="flex items-center justify-between w-full mb-4 px-2">
        <button
          type="button"
          onClick={onOpenModeSelect}
          className="px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 border-blue-200 dark:border-blue-800"
        >
          {isMultiplayer ? <Users className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
          <span>
            {isMultiplayer
              ? roomId
                ? `Multiplayer Room #${roomId}`
                : 'Multiplayer'
              : `Vs ${aiDifficulty.charAt(0).toUpperCase() + aiDifficulty.slice(1)} AI`}
          </span>
        </button>
        <button
          type="button"
          onClick={handleRematch}
          disabled={isWaitingSpectator || (isMultiplayer && isWaitingForFriend)}
          className="text-xs text-slate-600 dark:text-slate-300 hover:text-blue-600 disabled:opacity-40 flex items-center gap-1 font-semibold px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Rematch</span>
        </button>
      </div>

      {isMultiplayer && isWaitingForFriend && (
        <div className="w-full mb-3 p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs font-semibold text-blue-700 dark:text-blue-300 flex items-center justify-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span>Waiting for friend to join Room #{roomId}...</span>
        </div>
      )}

      <div className="flex items-center justify-between w-full mb-3 px-2 text-xs font-bold gap-2">
        <span className={`truncate ${isXTurn && !winner ? 'text-blue-600' : 'text-slate-400'}`}>
          {isMultiplayer ? `${hostDisplayName} (X)` : 'You (X)'}: {activeScores.X}
        </span>
        <span className="text-slate-400 text-[11px] shrink-0">
          {!isMultiplayer && aiThinking
            ? 'AI thinking...'
            : winner
            ? 'Finished'
            : isMultiplayer
            ? isWaitingForFriend
              ? 'Waiting...'
              : isMyMultiplayerTurn
              ? `Your Turn (${mySymbol})`
              : `${isXTurn ? hostDisplayName.split(' ')[0] : guestDisplayName.split(' ')[0]}'s Turn`
            : isXTurn
            ? 'X Turn'
            : 'O Turn'}
        </span>
        <span className={`truncate ${!isXTurn && !winner ? 'text-emerald-500' : 'text-slate-400'}`}>
          {isMultiplayer ? `${guestDisplayName} (O)` : 'AI Bot (O)'}: {activeScores.O}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2.5 p-3 bg-slate-100 dark:bg-slate-800/80 rounded-2xl w-full aspect-square max-w-[min(280px,100%)] touch-manipulation select-none">
        {activeBoard.map((cell, idx) => {
          const isWinCell = winningLine?.includes(idx);
          const canClick = isMultiplayer
            ? !cell && !winner && isMyMultiplayerTurn
            : !cell && !winner && !aiThinking && aiIsXNext;

          return (
            <button
              key={idx}
              type="button"
              disabled={!canClick}
              onClick={() => void handleCellClick(idx)}
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

      {resultMessage && (
        <div className="mt-4 w-full p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl text-xs font-semibold text-blue-700 dark:text-blue-300 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
            {resultMessage}
          </span>
          <button
            type="button"
            onClick={handleRematch}
            className="px-3 py-1 bg-blue-600 text-white rounded-lg text-[11px] font-bold shrink-0"
          >
            Rematch
          </button>
        </div>
      )}
    </div>
  );
};
