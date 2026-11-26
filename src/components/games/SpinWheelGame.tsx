/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lucky Spin Wheel Mini-Game & Live Multiplayer Spin Room
 * Supports Solo Daily Bonus spins AND synchronized Firestore room spins
 * (shared spinAngle, spinResult, isSpinning, scores, and strict currentTurn rotation).
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, RotateCw, Trophy, Users } from 'lucide-react';
import { soundFx } from '../../utils/soundFx';
import { GameMode, MultiplayerRoom, SpinSyncedState } from '../../types/multiplayer';

interface WheelSlice {
  label: string;
  points: number;
  color: string;
  textColor: string;
}

const WHEEL_SLICES: WheelSlice[] = [
  { label: '+15 Pts', points: 15, color: '#3B82F6', textColor: '#FFFFFF' },
  { label: '+50 Pts', points: 50, color: '#10B981', textColor: '#FFFFFF' },
  { label: '+10 Pts', points: 10, color: '#64748B', textColor: '#FFFFFF' },
  { label: '+100 Pts', points: 100, color: '#8B5CF6', textColor: '#FFFFFF' },
  { label: '+25 Pts', points: 25, color: '#F59E0B', textColor: '#0F172A' },
  { label: '+200 JACKPOT', points: 200, color: '#E11D48', textColor: '#FFFFFF' },
  { label: '+30 Pts', points: 30, color: '#0EA5E9', textColor: '#FFFFFF' },
  { label: '+75 Pts', points: 75, color: '#14B8A6', textColor: '#FFFFFF' },
];

const MAX_DAILY_SPINS = 3;

interface SpinWheelGameProps {
  userId: string;
  currentPoints: number;
  gameMode?: GameMode;
  currentRoom?: MultiplayerRoom | null;
  activePlayerId?: string;
  firebaseAuthUid?: string | null;
  isWaitingSpectator?: boolean;
  syncedState?: SpinSyncedState | null;
  onSyncSpin?: (
    nextState: SpinSyncedState,
    nextTurnId: string,
    status: 'playing' | 'active' | 'finished'
  ) => void;
  onRequestRematch?: () => void;
  onSpinReward: (points: number, label: string) => Promise<void>;
}

export const SpinWheelGame: React.FC<SpinWheelGameProps> = ({
  userId,
  currentPoints,
  gameMode = 'ai',
  currentRoom,
  activePlayerId,
  firebaseAuthUid,
  isWaitingSpectator = false,
  syncedState,
  onSyncSpin,
  onSpinReward,
}) => {
  const todayKey = new Date().toISOString().slice(0, 10);
  const storageKey = `jit_spin_usage_${userId || 'guest'}_${todayKey}`;

  const [spinsUsed, setSpinsUsed] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const saved = Number(localStorage.getItem(storageKey) || '0');
    return isNaN(saved) ? 0 : saved;
  });

  const [rotation, setRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [lastPrize, setLastPrize] = useState<WheelSlice | null>(null);
  const [roomScores, setRoomScores] = useState<Record<string, number>>({});
  const [roomSpinsUsed, setRoomSpinsUsed] = useState<Record<string, number>>({});
  const [roundNum, setRoundNum] = useState(1);
  const [lastWinnerName, setLastWinnerName] = useState<string | null>(null);

  const lastAppliedMoveIdRef = useRef<string | null>(null);
  const spinTimersRef = useRef<number[]>([]);
  const roomScoresRef = useRef(roomScores);
  roomScoresRef.current = roomScores;
  const roomSpinsUsedRef = useRef(roomSpinsUsed);
  roomSpinsUsedRef.current = roomSpinsUsed;
  const roundNumRef = useRef(roundNum);
  roundNumRef.current = roundNum;
  const spinsUsedRef = useRef(spinsUsed);
  spinsUsedRef.current = spinsUsed;

  const isMultiplayer = Boolean(currentRoom) || gameMode !== 'ai';
  const myId = activePlayerId || userId;
  const activePlayers = currentRoom?.players || [];
  const currentTurnId =
    currentRoom?.currentTurnUserId ||
    currentRoom?.currentTurn ||
    activePlayers[0]?.id ||
    currentRoom?.hostId ||
    '';

  const isAuthorizedSpinner = (() => {
    if (!isMultiplayer || !currentRoom) return gameMode === 'ai';
    if (isWaitingSpectator) return false;
    if (currentRoom.status === 'waiting' && !currentRoom.isOpenGroup) return false;
    if (!currentRoom.isOpenGroup && !currentRoom.guest && !currentRoom.player2Id && activePlayers.length < 2) {
      return false;
    }
    if (currentRoom.status === 'finished') return false;
    if (currentTurnId !== myId) return false;
    return true;
  })();

  const clearSpinTimers = useCallback(() => {
    spinTimersRef.current.forEach((t) => window.clearTimeout(t));
    spinTimersRef.current = [];
  }, []);

  useEffect(() => {
    return () => clearSpinTimers();
  }, [clearSpinTimers]);

  // Reset multiplayer spin state cleanly when switching rooms or modes
  useEffect(() => {
    clearSpinTimers();
    lastAppliedMoveIdRef.current = null;
    setRotation(0);
    setIsSpinning(false);
    setLastPrize(null);
    setLastWinnerName(null);
    setRoomScores({});
    setRoomSpinsUsed({});
    setRoundNum(1);
  }, [currentRoom?.roomCode, gameMode, clearSpinTimers]);

  // Safety watchdog so remote disconnects mid-spin never leave the wheel permanently locked
  useEffect(() => {
    if (!isSpinning || !isMultiplayer) return;
    const watchdog = window.setTimeout(() => {
      setIsSpinning(false);
    }, 6000);
    return () => window.clearTimeout(watchdog);
  }, [isSpinning, isMultiplayer]);

  const applySpinSnapshot = useCallback((incoming: SpinSyncedState | null | undefined) => {
    if (!incoming || typeof incoming !== 'object') return;
    if (incoming.moveId && lastAppliedMoveIdRef.current === incoming.moveId) {
      return;
    }
    if (incoming.moveId) {
      lastAppliedMoveIdRef.current = incoming.moveId;
    }
    if (typeof incoming.spinAngle === 'number' || typeof incoming.rotation === 'number') {
      const nextAngle =
        typeof incoming.spinAngle === 'number' ? incoming.spinAngle : incoming.rotation;
      setRotation(nextAngle);
    }
    setIsSpinning(Boolean(incoming.isSpinning));
    if (incoming.scores && typeof incoming.scores === 'object') {
      setRoomScores(incoming.scores);
    }
    if (incoming.spinsUsedByPlayer && typeof incoming.spinsUsedByPlayer === 'object') {
      setRoomSpinsUsed(incoming.spinsUsedByPlayer);
    }
    if (typeof incoming.round === 'number') {
      setRoundNum(incoming.round);
    }
    if (incoming.lastWinnerName) {
      setLastWinnerName(incoming.lastWinnerName);
    } else if (!incoming.isSpinning && !incoming.spinResult) {
      setLastWinnerName(null);
    }
    if (incoming.spinResult && !incoming.isSpinning) {
      const matchedSlice =
        WHEEL_SLICES.find((s) => s.label === incoming.spinResult?.label) || {
          label: incoming.spinResult.label,
          points: incoming.spinResult.points,
          color: incoming.spinResult.color || '#F59E0B',
          textColor: '#FFFFFF',
        };
      setLastPrize(matchedSlice);
    } else {
      setLastPrize(null);
    }
  }, []);

  useEffect(() => {
    if (!isMultiplayer || !syncedState) return;
    applySpinSnapshot(syncedState);
  }, [isMultiplayer, syncedState, applySpinSnapshot]);

  const myUsedCount = isMultiplayer ? roomSpinsUsed[myId] || 0 : spinsUsed;
  const spinsRemaining = Math.max(0, MAX_DAILY_SPINS - myUsedCount);

  const handleSpin = () => {
    if (isSpinning || spinsRemaining <= 0) return;
    if (isMultiplayer && !isAuthorizedSpinner) {
      soundFx.playError();
      return;
    }

    clearSpinTimers();
    setIsSpinning(true);
    setLastPrize(null);

    const sliceAngle = 360 / WHEEL_SLICES.length; // 45 deg
    const winnerIdx = Math.floor(Math.random() * WHEEL_SLICES.length);
    const chosen = WHEEL_SLICES[winnerIdx];

    // Align slice center under top pointer (0 deg / 12 o'clock)
    const sliceCenterAngle = winnerIdx * sliceAngle + sliceAngle / 2;
    const desiredMod = (360 - sliceCenterAngle) % 360;
    const currentMod = rotation % 360;
    const deltaMod = (desiredMod - currentMod + 360) % 360;
    const targetRotation = rotation + 360 * 5 + deltaMod;

    setRotation(targetRotation);

    const spinnerName =
      activePlayers.find((p) => p.id === myId)?.name || 'Player';

    if (isMultiplayer && onSyncSpin && currentRoom) {
      const startState: SpinSyncedState = {
        rotation: targetRotation,
        spinAngle: targetRotation,
        targetAngle: targetRotation,
        isSpinning: true,
        spinResult: { label: chosen.label, points: chosen.points, color: chosen.color },
        lastWinnerId: myId,
        lastWinnerName: spinnerName,
        scores: roomScores,
        spinsUsedByPlayer: roomSpinsUsed,
        round: roundNum,
        currentTurn: currentTurnId,
      };
      // Hold turn on current spinner while wheel animates so both clients see live spin simultaneously
      onSyncSpin(startState, currentTurnId, 'playing');
    }

    // Synthesized tick sounds during spin deceleration
    const tickDelays = [120, 260, 420, 620, 860, 1150, 1500, 1920, 2400, 2900];
    tickDelays.forEach((d) => {
      const tid = window.setTimeout(() => soundFx.playTick(), d);
      spinTimersRef.current.push(tid);
    });

    const finishId = window.setTimeout(async () => {
      setIsSpinning(false);
      setLastPrize(chosen);
      setLastWinnerName(spinnerName);
      soundFx.playWin();

      if (isMultiplayer && onSyncSpin && currentRoom) {
        const latestUsed = roomSpinsUsedRef.current;
        const latestScores = roomScoresRef.current;
        const latestRound = roundNumRef.current;
        const nextUsedMap: Record<string, number> = {
          ...latestUsed,
          [myId]: (latestUsed[myId] || 0) + 1,
        };
        const nextScoresMap: Record<string, number> = {
          ...latestScores,
          [myId]: (latestScores[myId] || 0) + chosen.points,
        };
        setRoomSpinsUsed(nextUsedMap);
        setRoomScores(nextScoresMap);
        const nextRound = latestRound + 1;
        setRoundNum(nextRound);

        const seatIdx = activePlayers.findIndex((p) => p.id === myId);
        const nextPlayer =
          activePlayers.length > 0
            ? activePlayers[(seatIdx >= 0 ? seatIdx + 1 : 0) % activePlayers.length]
            : null;
        const nextTurnId = nextPlayer?.id || myId;

        onSyncSpin(
          {
            rotation: targetRotation,
            spinAngle: targetRotation,
            targetAngle: targetRotation,
            isSpinning: false,
            spinResult: { label: chosen.label, points: chosen.points, color: chosen.color },
            lastWinnerId: myId,
            lastWinnerName: spinnerName,
            scores: nextScoresMap,
            spinsUsedByPlayer: nextUsedMap,
            round: nextRound,
            currentTurn: nextTurnId,
          },
          nextTurnId,
          'playing'
        );
      } else {
        const nextUsed = spinsUsedRef.current + 1;
        setSpinsUsed(nextUsed);
        if (typeof window !== 'undefined') {
          localStorage.setItem(storageKey, String(nextUsed));
        }
      }

      await onSpinReward(chosen.points, chosen.label);
    }, 3600);
    spinTimersRef.current.push(finishId);
  };

  const polarToCartesian = (cx: number, cy: number, r: number, deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  };

  const describeArc = (cx: number, cy: number, r: number, startAngle: number, endAngle: number) => {
    const start = polarToCartesian(cx, cy, r, endAngle);
    const end = polarToCartesian(cx, cy, r, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
  };

  const turnPlayerName =
    activePlayers.find((p) => p.id === currentTurnId)?.name?.split(' ')[0] || 'Player';

  return (
    <div className="max-w-md mx-auto flex flex-col items-center space-y-5">
      <div className="w-full flex items-center justify-between px-2 text-xs font-bold">
        <span className="text-slate-600 dark:text-slate-300">
          {isMultiplayer ? `Spins Used: ` : `Daily Spins Left: `}
          <span className="font-mono text-rose-600 dark:text-rose-400">
            {spinsRemaining}/{MAX_DAILY_SPINS}
          </span>
        </span>
        {isMultiplayer && (
          <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            {isAuthorizedSpinner ? 'Your Spin Turn' : `${turnPlayerName}'s Turn`}
          </span>
        )}
        <span className="font-mono text-amber-600 dark:text-amber-400 tabular-nums">
          Balance: {currentPoints} Pts
        </span>
      </div>

      {isMultiplayer && activePlayers.length > 0 && (
        <div className="w-full grid grid-cols-2 gap-2">
          {activePlayers.slice(0, 4).map((p) => {
            const isTurn = p.id === currentTurnId;
            return (
              <div
                key={p.id}
                className={`px-3 py-2 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                  isTurn
                    ? 'bg-rose-50 dark:bg-rose-950/35 border-rose-400 text-rose-800 dark:text-rose-200 font-bold'
                    : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                <span className="truncate">{p.id === myId ? 'You' : p.name.split(' ')[0]}</span>
                <span className="font-mono font-black">{roomScores[p.id] ?? 0} Pts</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Wheel Container */}
      <div className="relative w-72 h-72 sm:w-80 sm:h-80 flex items-center justify-center select-none">
        {/* Top Pointer Triangle */}
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-20 drop-shadow-md">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
            <polygon points="14,26 4,4 24,4" fill="#F59E0B" stroke="#FFFFFF" strokeWidth="2.5" />
          </svg>
        </div>

        {/* Rotating SVG Wheel */}
        <div
          className="w-full h-full rounded-full shadow-2xl border-4 border-slate-900 dark:border-slate-700 overflow-hidden"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: isSpinning ? 'transform 3.5s cubic-bezier(0.15, 0.85, 0.2, 1)' : 'none',
          }}
        >
          <svg viewBox="0 0 300 300" className="w-full h-full">
            {WHEEL_SLICES.map((slice, idx) => {
              const startAngle = idx * 45;
              const endAngle = startAngle + 45;
              const midAngle = startAngle + 22.5;
              const labelPos = polarToCartesian(150, 150, 96, midAngle);
              return (
                <g key={slice.label}>
                  <path
                    d={describeArc(150, 150, 148, startAngle, endAngle)}
                    fill={slice.color}
                    stroke="#FFFFFF"
                    strokeWidth="2"
                  />
                  <text
                    x={labelPos.x}
                    y={labelPos.y}
                    fill={slice.textColor}
                    fontSize="11"
                    fontWeight="800"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${midAngle - 90}, ${labelPos.x}, ${labelPos.y})`}
                  >
                    {slice.label}
                  </text>
                </g>
              );
            })}
            <circle cx="150" cy="150" r="24" fill="#0F172A" stroke="#FBBF24" strokeWidth="4" />
            <text
              x="150"
              y="151"
              fill="#FBBF24"
              fontSize="11"
              fontWeight="900"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              JIT
            </text>
          </svg>
        </div>
      </div>

      <button
        type="button"
        disabled={
          isSpinning ||
          spinsRemaining <= 0 ||
          (isMultiplayer && !isAuthorizedSpinner)
        }
        onClick={handleSpin}
        className="w-full max-w-xs py-3.5 px-6 bg-gradient-to-r from-rose-600 to-amber-500 hover:from-rose-700 hover:to-amber-600 disabled:opacity-45 text-white font-black text-sm rounded-2xl shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 min-h-[48px]"
      >
        <RotateCw className={`w-4 h-4 ${isSpinning ? 'animate-spin' : ''}`} />
        <span>
          {isSpinning
            ? 'Spinning Wheel Live...'
            : isMultiplayer && !isAuthorizedSpinner
            ? `Waiting for ${turnPlayerName} to Spin...`
            : spinsRemaining > 0
            ? 'Spin & Win JIT Points'
            : 'Spins Completed for This Session!'}
        </span>
      </button>

      {lastPrize && (
        <div className="w-full p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center gap-3 text-xs text-emerald-800 dark:text-emerald-200">
          <Trophy className="w-5 h-5 text-amber-500 shrink-0" />
          <div>
            <p className="font-bold flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>
                {lastWinnerName && isMultiplayer ? `${lastWinnerName} won ` : 'Won '}
                {lastPrize.label}!
              </span>
            </p>
            <p className="text-[11px] opacity-85">
              {lastPrize.points} virtual JIT Points synced live to Firebase.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
