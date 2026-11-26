/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared Real-Time Multiplayer Room Hook
 * Binds any active game board to its Firestore `gameRooms/{roomId}` document via onSnapshot,
 * tracks Firebase Auth UID in real time, enforces strict turn authorization across all games,
 * deduplicates move sequences, and broadcasts moves/transactional Quiz answers atomically.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { MultiplayerRoom, QuizSyncedState } from '../types/multiplayer';
import { QuizQuestion } from '../services/gameAIEngine';
import { multiplayerSocket } from '../services/multiplayerSocket';
import {
  auth,
  subscribeToFirebaseAuthState,
  subscribeToGameRoom,
  pushFirestoreGameMove,
  pushFirestoreQuizAnswer,
  buildUnifiedBoardAndMoveFields,
} from '../lib/firebase';

const TURN_VALIDATED_ACTIONS = new Set([
  'TTT_MOVE',
  'LUDO_MOVE',
  'CHESS_MOVE',
  'SL_MOVE',
  'CARROM_MOVE',
  'SPIN_MOVE',
]);

interface UseMultiplayerRoomOptions {
  activePlayerId: string;
  currentRoomRef: React.MutableRefObject<MultiplayerRoom | null>;
  setCurrentRoom: React.Dispatch<React.SetStateAction<MultiplayerRoom | null>>;
}

export function useMultiplayerRoom({
  activePlayerId,
  currentRoomRef,
  setCurrentRoom,
}: UseMultiplayerRoomOptions) {
  const [firebaseAuthUid, setFirebaseAuthUid] = useState<string | null>(
    () => auth.currentUser?.uid || null
  );
  const firebaseAuthUidRef = useRef<string | null>(firebaseAuthUid);
  const activePlayerIdRef = useRef<string>(activePlayerId);
  const roomUnsubRef = useRef<(() => void) | null>(null);
  const roomMoveCounterRef = useRef<number>(0);
  const appliedMoveIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    activePlayerIdRef.current = activePlayerId;
  }, [activePlayerId]);

  useEffect(() => {
    const unsub = subscribeToFirebaseAuthState((fbUser) => {
      const uid = fbUser?.uid || null;
      firebaseAuthUidRef.current = uid;
      setFirebaseAuthUid(uid);
    });
    return () => unsub();
  }, []);

  const detachRoomSubscription = useCallback(() => {
    if (roomUnsubRef.current) {
      roomUnsubRef.current();
      roomUnsubRef.current = null;
    }
  }, []);

  const resetMoveTracking = useCallback(() => {
    roomMoveCounterRef.current = 0;
    appliedMoveIdsRef.current.clear();
  }, []);

  const markMoveIdApplied = useCallback((moveId: string): boolean => {
    if (!moveId) return true;
    if (appliedMoveIdsRef.current.has(moveId)) return false;
    appliedMoveIdsRef.current.add(moveId);
    if (appliedMoveIdsRef.current.size > 150) {
      const oldest = appliedMoveIdsRef.current.values().next().value;
      if (oldest) appliedMoveIdsRef.current.delete(oldest);
    }
    return true;
  }, []);

  const recordMoveSeq = useCallback((seq: number) => {
    if (Number.isFinite(seq) && seq > roomMoveCounterRef.current) {
      roomMoveCounterRef.current = seq;
    }
  }, []);

  /**
   * Strict turn authorization guard across all multiplayer boards:
   * 1. Rejects waiting-seat spectators and non-seated players.
   * 2. Rejects actions while room is still 'waiting' or guest hasn't joined yet.
   * 3. Verifies room.currentTurnUserId / room.currentTurn matches activePlayerId AND expectedSeatPlayerId.
   */
  const isAuthorizedTurnActor = useCallback((expectedSeatPlayerId?: string): boolean => {
    const room = currentRoomRef.current;
    if (!room) return true;

    const myId = activePlayerIdRef.current;
    if (!myId) return false;
    if ((room.waitingPlayers || []).some((p) => p.id === myId)) {
      return false;
    }
    if (!room.players.some((p) => p.id === myId)) {
      return false;
    }
    if (room.status === 'finished') {
      return false;
    }
    if (room.status === 'waiting' && !room.isOpenGroup) {
      return false;
    }
    if (!room.isOpenGroup && !room.guest && !room.player2Id && room.players.length < 2) {
      return false;
    }

    const turnOwnerId =
      room.currentTurnUserId || room.currentTurn || expectedSeatPlayerId || room.players[0]?.id || '';
    if (!turnOwnerId) return false;
    if (expectedSeatPlayerId && turnOwnerId !== expectedSeatPlayerId) {
      return false;
    }
    if (turnOwnerId !== myId) {
      return false;
    }

    return true;
  }, [currentRoomRef]);

  const attachRoomSubscription = useCallback(
    (
      roomCode: string,
      onRoomUpdate: (room: MultiplayerRoom, moveAction?: string) => void,
      onRoomDeleted?: () => void
    ) => {
      detachRoomSubscription();
      resetMoveTracking();

      roomUnsubRef.current = subscribeToGameRoom(
        roomCode,
        (room, moveAction) => {
          onRoomUpdate(room, moveAction);
        },
        () => {
          onRoomDeleted?.();
        }
      );
    },
    [detachRoomSubscription, resetMoveTracking]
  );

  const broadcastRoomMove = useCallback(
    (
      moveAction: string,
      newGameState: Record<string, any>,
      nextTurnId?: string,
      status: 'playing' | 'active' | 'in_game' | 'finished' = 'playing',
      options?: {
        bypassTurnGuard?: boolean;
        scores?: Record<string, number>;
        winnerId?: string | null;
        isDraw?: boolean;
      }
    ): boolean => {
      const room = currentRoomRef.current;
      if (!room) return false;

      if (!options?.bypassTurnGuard && TURN_VALIDATED_ACTIONS.has(moveAction)) {
        if (!isAuthorizedTurnActor()) {
          return false;
        }
      }

      const nextSeq = roomMoveCounterRef.current + 1;
      roomMoveCounterRef.current = nextSeq;
      const myId = activePlayerIdRef.current;
      const liveFbUid = auth.currentUser?.uid || firebaseAuthUidRef.current || null;
      const moveId = `${myId}_${nextSeq}_${Math.random().toString(36).slice(2, 6)}`;

      const stampedState = {
        ...newGameState,
        moveSeq: nextSeq,
        moveId,
        byPlayerId: myId,
        ...(liveFbUid ? { byAuthUid: liveFbUid } : {}),
      };
      const resolvedNextTurn = String(nextTurnId || '');
      const normalizedStatus: 'playing' | 'finished' =
        status === 'finished' ? 'finished' : 'playing';
      const unified = buildUnifiedBoardAndMoveFields(stampedState, moveAction, myId);

      const optimisticRoom: MultiplayerRoom = {
        ...room,
        currentTurn: resolvedNextTurn,
        currentTurnUserId: resolvedNextTurn,
        ...(options?.scores ? { scores: options.scores } : {}),
        ...(options?.winnerId !== undefined ? { winnerId: options.winnerId } : {}),
        ...(options?.isDraw !== undefined ? { isDraw: options.isDraw } : {}),
        status: normalizedStatus,
        gameState: stampedState,
        boardState: unified.boardState,
        diceRoll: unified.diceRoll,
        lastMove: unified.lastMove,
        lastUpdated: Date.now(),
      };

      currentRoomRef.current = optimisticRoom;
      setCurrentRoom((prev) =>
        prev && prev.roomCode === room.roomCode ? optimisticRoom : prev
      );

      multiplayerSocket.sendMove(room.roomCode, moveAction, stampedState, nextTurnId);
      pushFirestoreGameMove(room.roomCode, moveAction, stampedState, nextTurnId, normalizedStatus, {
        scores: options?.scores,
        winnerId: options?.winnerId,
        isDraw: options?.isDraw,
      }).catch(() => {});
      return true;
    },
    [currentRoomRef, isAuthorizedTurnActor, setCurrentRoom]
  );

  const submitQuizAnswer = useCallback(
    async (params: {
      questionIndex: number;
      optionIndex: number | null;
      nextScore: number;
      questions: QuizQuestion[];
      source: 'ai' | 'curated-70-30';
      questionSeed?: number;
    }): Promise<QuizSyncedState | null> => {
      const room = currentRoomRef.current;
      if (!room) return null;
      const myId = activePlayerIdRef.current;
      const nextSeq = roomMoveCounterRef.current + 1;
      roomMoveCounterRef.current = nextSeq;
      const moveId = `${myId}_quiz_${nextSeq}_${Math.random().toString(36).slice(2, 6)}`;
      appliedMoveIdsRef.current.add(moveId);

      const updated = await pushFirestoreQuizAnswer(room.roomCode, {
        actorId: myId,
        questionIndex: params.questionIndex,
        selectedOption: params.optionIndex,
        newPlayerScore: params.nextScore,
        questions: params.questions,
        source: params.source,
        questionSeed: params.questionSeed,
        moveId,
        moveSeq: nextSeq,
      });
      if (updated?.moveId) {
        markMoveIdApplied(updated.moveId);
      }
      if (typeof updated?.moveSeq === 'number') {
        recordMoveSeq(updated.moveSeq);
      }
      return updated;
    },
    [currentRoomRef, markMoveIdApplied, recordMoveSeq]
  );

  useEffect(() => {
    return () => {
      detachRoomSubscription();
    };
  }, [detachRoomSubscription]);

  return {
    firebaseAuthUid,
    roomMoveCounterRef,
    isAuthorizedTurnActor,
    attachRoomSubscription,
    detachRoomSubscription,
    resetMoveTracking,
    markMoveIdApplied,
    recordMoveSeq,
    broadcastRoomMove,
    submitQuizAnswer,
  };
}
