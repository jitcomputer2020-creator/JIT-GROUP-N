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
import { Bot, RotateCcw, Sparkles } from 'lucide-react';
import { db, auth, handleFirestoreError, OperationType } from '../../lib/firebase';
import { GameId } from '../../types';
import { AIDifficulty, GameMode } from '../../types/multiplayer';
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

function extractScoresFromSnapshot(data: Record<string, any>): { X: number; O: number } {
  const topScores = data.scores;
  if (topScores && typeof topScores === 'object') {
    return {
      X: Number(topScores.X || 0),
      O: Number(topScores.O || 0),
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
  const isMultiplayer = Boolean(roomId && gameMode !== 'ai');

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

  // Clear AI timers on unmount or mode change
  useEffect(() => {
    return () => {
      if (aiTimerRef.current !== null) {
        window.clearTimeout(aiTimerRef.current);
        aiTimerRef.current = null;
      }
    };
  }, [gameMode, aiDifficulty]);

  // Real-Time Firestore Single-Source-of-Truth Subscription
  useEffect(() => {
    isWritingRef.current = false;
    if (!roomId || gameMode === 'ai') {
      setRoomData(null);
      setBoardState(Array<CellValue>(9).fill(null));
      setCurrentTurn('');
      setScores({ X: 0, O: 0 });
      awardedRoundRef.current = null;
      prevBoardJsonRef.current = '';
      return;
    }

    const docRef = doc(db, 'gameRooms', roomId);
    const unsub = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          const nextBoard = extractBoardFromSnapshot(data.boardState, data.gameState);
          const nextTurn = String(
            data.currentTurn || data.player1Id || data.player1 || data.hostId || ''
          );
          const nextScores = extractScoresFromSnapshot(data);

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
  }, [roomId, gameMode]);

  const activeBoard = isMultiplayer ? boardState : aiBoard;
  const activeScores = isMultiplayer ? scores : aiScores;
  const { winner, line: winningLine } = useMemo(
    () => checkTicTacToeWinner(activeBoard),
    [activeBoard]
  );

  const actorUid = auth.currentUser?.uid || localPlayerId;
  const p1Id = roomData
    ? String(roomData.player1Id || roomData.player1 || roomData.hostId || '')
    : '';
  const p2Id = roomData ? String(roomData.player2Id || roomData.player2 || '') : '';
  const isPlayer1 = Boolean(
    isMultiplayer &&
      roomData &&
      (actorUid === p1Id || (roomData.player1AuthUid && actorUid === roomData.player1AuthUid))
  );
  const mySymbol: 'X' | 'O' = isPlayer1 ? 'X' : 'O';
  const resolvedTurnUid = currentTurn || String(roomData?.currentTurn || p1Id || '');
  const isMyMultiplayerTurn = Boolean(
    isMultiplayer &&
      roomData &&
      !isWaitingSpectator &&
      actorUid &&
      resolvedTurnUid &&
      actorUid === resolvedTurnUid
  );
  const isXTurn = isMultiplayer ? resolvedTurnUid === p1Id : aiIsXNext;

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
        mode: gameMode,
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
        mode: gameMode,
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
      : `Opponent (${winner}) Won! +5 Participation Points`;
  }, [winner, isMultiplayer, aiDifficulty, mySymbol]);

  const handleCellClick = useCallback(
    async (index: number) => {
      if (isMultiplayer) {
        if (!roomId || !roomData || isWritingRef.current) return;
        if (isWaitingSpectator) {
          soundFx.playError();
          onWaitingSpectatorBlocked?.();
          return;
        }
        if (boardState[index] || winner) return;

        // Mandatory Auth/Turn Verification
        const currentActorUid = auth.currentUser?.uid || localPlayerId;
        const activeTurnUid = currentTurn || String(roomData.currentTurn || '');
        if (!currentActorUid || currentActorUid !== activeTurnUid) {
          soundFx.playError();
          return;
        }

        const player1Id = String(roomData.player1Id || roomData.player1 || roomData.hostId || '');
        const player2Id = String(roomData.player2Id || roomData.player2 || '');
        if (!player1Id || !player2Id) return;

        const nextBoard = [...boardState];
        nextBoard[index] = mySymbol;

        const nextTurn = currentActorUid === player1Id ? player2Id : player1Id;
        const { winner: nextWinner } = checkTicTacToeWinner(nextBoard);
        const nextScores =
          nextWinner === 'X' || nextWinner === 'O'
            ? { ...scores, [nextWinner]: scores[nextWinner] + 1 }
            : scores;

        soundFx.playMove();
        isWritingRef.current = true;
        try {
          // Direct Firestore Write ONLY — onSnapshot handles UI updates on both devices
          const roomRef = doc(db, 'gameRooms', roomId);
          await updateDoc(roomRef, {
            boardState: nextBoard,
            currentTurn: nextTurn,
            scores: nextScores,
            status: nextWinner ? 'finished' : 'active',
            moveAction: 'TTT_MOVE',
            lastMove: {
              action: 'TTT_MOVE',
              byPlayerId: currentActorUid,
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

      // Offline / Solo AI Mode
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
      boardState,
      winner,
      localPlayerId,
      currentTurn,
      mySymbol,
      scores,
      aiBoard,
      aiThinking,
      aiIsXNext,
      aiDifficulty,
      onAwardMatch,
    ]
  );

  const handleRematch = useCallback(async () => {
    if (isMultiplayer) {
      if (!roomId || !roomData || isWaitingSpectator || isWritingRef.current) return;
      const firstTurn = String(roomData.player1Id || roomData.player1 || roomData.hostId || '');
      if (!firstTurn) return;
      isWritingRef.current = true;
      try {
        const roomRef = doc(db, 'gameRooms', roomId);
        await updateDoc(roomRef, {
          boardState: Array<CellValue>(9).fill(null),
          currentTurn: firstTurn,
          scores,
          status: 'active',
          moveAction: 'REMATCH',
          lastMove: {
            action: 'REMATCH',
            byPlayerId: auth.currentUser?.uid || localPlayerId,
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
  }, [isMultiplayer, roomId, roomData, isWaitingSpectator, scores]);

  return (
    <div className="max-w-sm mx-auto flex flex-col items-center">
      <div className="flex items-center justify-between w-full mb-4 px-2">
        <button
          type="button"
          onClick={onOpenModeSelect}
          className="px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 border-blue-200 dark:border-blue-800"
        >
          <Bot className="w-3.5 h-3.5" />
          <span className="capitalize">
            {gameMode === 'ai' ? `${aiDifficulty} AI` : gameMode}
          </span>
        </button>
        <button
          type="button"
          onClick={handleRematch}
          disabled={isWaitingSpectator}
          className="text-xs text-slate-600 dark:text-slate-300 hover:text-blue-600 disabled:opacity-40 flex items-center gap-1 font-semibold px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Rematch</span>
        </button>
      </div>

      <div className="flex items-center justify-between w-full mb-3 px-2 text-xs font-bold">
        <span className={isXTurn && !winner ? 'text-blue-600' : 'text-slate-400'}>
          {isMultiplayer ? (isPlayer1 ? 'You (X)' : 'P1 (X)') : 'You (X)'}: {activeScores.X}
        </span>
        <span className="text-slate-400 text-[11px]">
          {aiThinking
            ? 'AI thinking...'
            : winner
            ? 'Finished'
            : isMultiplayer
            ? isMyMultiplayerTurn
              ? `Your Turn (${mySymbol})`
              : `Opponent Turn (${isPlayer1 ? 'O' : 'X'})`
            : isXTurn
            ? 'X Turn'
            : 'O Turn'}
        </span>
        <span className={!isXTurn && !winner ? 'text-emerald-500' : 'text-slate-400'}>
          {gameMode === 'ai'
            ? 'AI Bot (O)'
            : !isPlayer1 && isMultiplayer
            ? 'You (O)'
            : 'Opponent (O)'}
          : {activeScores.O}
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
            Play Again
          </button>
        </div>
      )}
    </div>
  );
};
