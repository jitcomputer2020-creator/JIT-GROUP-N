/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Interactive 2D Physics Carrom Board
 * - High-DPI crisp canvas rendering with wood frame, baselines, corner pockets & shaded coins
 * - Responsive desktop mouse + mobile touch gestures (touch-none):
 *   1) Drag back from striker like a slingshot & release to strike
 *   2) Slide along the baseline to position striker (auto-avoids overlapping coins)
 *   3) Tap or drag anywhere on board to aim, or fine-tune with sliders + Strike button
 * - Sub-stepped elastic 2D collision physics (no coin tunneling at max power)
 * - Complete foul (-5), Red Queen (+30), coin retention turn rules, smart AI, and Firestore sync
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  GameMode,
  AIDifficulty,
  MultiplayerRoom,
  CarromSyncedState,
  CarromSyncedCoin,
} from '../../types/multiplayer';
import { soundFx } from '../../utils/soundFx';
import { Target, RotateCcw, Sparkles, MoveHorizontal } from 'lucide-react';

interface Coin extends CarromSyncedCoin {
  vx: number;
  vy: number;
}

interface CarromBoardProps {
  gameMode: GameMode;
  aiDifficulty: AIDifficulty;
  currentRoom?: MultiplayerRoom | null;
  activePlayerId?: string;
  firebaseAuthUid?: string | null;
  isWaitingSpectator?: boolean;
  syncedState?: CarromSyncedState | null;
  onSyncMove?: (
    state: CarromSyncedState,
    nextTurnId: string,
    status: 'playing' | 'active' | 'in_game' | 'finished'
  ) => void;
  onRequestRematch?: () => void;
  onMatchFinish: (outcome: 'win' | 'loss' | 'draw', summary: string, points: number) => void;
}

const SIZE = 340;
const BOARD_FRAME = 14;
const POCKET_OFFSET = 27;
const POCKET_RADIUS = 16;
const POCKETS = [
  { x: POCKET_OFFSET, y: POCKET_OFFSET },
  { x: SIZE - POCKET_OFFSET, y: POCKET_OFFSET },
  { x: POCKET_OFFSET, y: SIZE - POCKET_OFFSET },
  { x: SIZE - POCKET_OFFSET, y: SIZE - POCKET_OFFSET },
];
const BASELINE_MARGIN_X = 68;
const BASELINE_Y_PLAYER = SIZE - 54;
const BASELINE_Y_AI = 54;
const SUBSTEPS = 4;

type DragMode = 'none' | 'slingshot' | 'slide' | 'aim';

interface DragState {
  mode: DragMode;
  pointerId: number | null;
  pullDist: number;
  pullX: number;
  pullY: number;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function createInitialCoins(): Coin[] {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const coins: Coin[] = [
    { id: 'queen', x: cx, y: cy, vx: 0, vy: 0, r: 9.2, type: 'queen', pocketed: false },
  ];

  // Classic hexagonal Carrom rack: alternating White & Black around Queen + outer ring
  const innerRing = Array.from({ length: 6 }, (_, i) => {
    const angle = (i * Math.PI) / 3 - Math.PI / 2;
    return {
      dx: Math.cos(angle) * 20,
      dy: Math.sin(angle) * 20,
      t: i % 2 === 0 ? ('white' as const) : ('black' as const),
    };
  });

  const outerRing = [
    { dx: 0, dy: -40, t: 'white' as const },
    { dx: 35, dy: -20, t: 'black' as const },
    { dx: 35, dy: 20, t: 'white' as const },
    { dx: 0, dy: 40, t: 'black' as const },
    { dx: -35, dy: 20, t: 'white' as const },
    { dx: -35, dy: -20, t: 'black' as const },
  ];

  [...innerRing, ...outerRing].forEach((o, i) => {
    coins.push({
      id: `c_${i}`,
      x: cx + o.dx,
      y: cy + o.dy,
      vx: 0,
      vy: 0,
      r: 9.2,
      type: o.t,
      pocketed: false,
    });
  });

  return coins;
}

function findSafeStrikerX(preferredX: number, sy: number, coins: Coin[]): number {
  const minX = BASELINE_MARGIN_X;
  const maxX = SIZE - BASELINE_MARGIN_X;
  const base = clamp(preferredX, minX, maxX);
  const strikerRadius = 12.5;

  const isFree = (x: number) =>
    coins.every((c) => {
      if (c.pocketed) return true;
      return Math.hypot(c.x - x, c.y - sy) >= c.r + strikerRadius + 2;
    });

  if (isFree(base)) return base;

  for (let delta = 4; delta <= SIZE - BASELINE_MARGIN_X * 2; delta += 4) {
    const right = base + delta;
    if (right <= maxX && isFree(right)) return right;
    const left = base - delta;
    if (left >= minX && isFree(left)) return left;
  }

  return base;
}

export const CarromBoard: React.FC<CarromBoardProps> = ({
  gameMode,
  aiDifficulty,
  currentRoom,
  activePlayerId,
  firebaseAuthUid: _firebaseAuthUid,
  isWaitingSpectator = false,
  syncedState,
  onSyncMove,
  onRequestRematch,
  onMatchFinish,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const coinsRef = useRef<Coin[]>(createInitialCoins());
  const strikerRef = useRef<Coin>({
    id: 'striker',
    x: SIZE / 2,
    y: BASELINE_Y_PLAYER,
    vx: 0,
    vy: 0,
    r: 12.5,
    type: 'striker',
    pocketed: false,
  });
  const animRef = useRef<number | null>(null);
  const aiTimerRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const lastAwardedFinishRef = useRef<string | null>(null);
  const lastAppliedMoveIdRef = useRef<string | null>(null);
  const dragRef = useRef<DragState>({
    mode: 'none',
    pointerId: null,
    pullDist: 0,
    pullX: SIZE / 2,
    pullY: BASELINE_Y_PLAYER,
  });

  const [strikerX, setStrikerX] = useState(SIZE / 2);
  const [aimAngle, setAimAngle] = useState(0); // -80 to +80 deg from forward direction
  const [power, setPower] = useState(74);
  const [turn, setTurn] = useState<'player' | 'opponent'>('player');
  const [isSimulating, setIsSimulating] = useState(false);
  const [isPullingBack, setIsPullingBack] = useState(false);
  const [scores, setScores] = useState({ player: 0, opponent: 0, queenHolder: '' as string });
  const [statusLog, setStatusLog] = useState<string[]>([
    'Drag back from the striker & release to shoot, or tap anywhere to aim!',
  ]);
  const [winnerMsg, setWinnerMsg] = useState<string | null>(null);

  const scoresRef = useRef(scores);
  scoresRef.current = scores;
  const statusLogRef = useRef(statusLog);
  statusLogRef.current = statusLog;
  const gameModeRef = useRef(gameMode);
  gameModeRef.current = gameMode;
  const currentRoomRef = useRef(currentRoom);
  currentRoomRef.current = currentRoom;
  const aimAngleRef = useRef(aimAngle);
  aimAngleRef.current = aimAngle;
  const powerRef = useRef(power);
  powerRef.current = power;
  const turnRef = useRef(turn);
  turnRef.current = turn;
  const strikerXRef = useRef(strikerX);
  strikerXRef.current = strikerX;
  const isSimulatingRef = useRef(isSimulating);
  isSimulatingRef.current = isSimulating;

  const isMultiplayer = Boolean(currentRoom) || gameMode !== 'ai';
  const p1Id = currentRoom
    ? currentRoom.players[0]?.id || currentRoom.player1Id || currentRoom.hostId || ''
    : activePlayerId;
  const p2Id = currentRoom
    ? currentRoom.players[1]?.id || currentRoom.player2Id || ''
    : '';

  const mySide: 'player' | 'opponent' =
    !isMultiplayer || !currentRoom
      ? 'player'
      : p1Id === activePlayerId
      ? 'player'
      : 'opponent';

  const hasFriendJoined = Boolean(
    !currentRoom ||
      currentRoom.isOpenGroup ||
      currentRoom.guest?.id ||
      currentRoom.player2Id ||
      currentRoom.players.length >= 2
  );

  const expectedTurnActorId = !currentRoom
    ? activePlayerId
    : turn === 'player'
    ? p1Id
    : p2Id;

  const isAuthorizedMultiplayerActor = (() => {
    if (!currentRoom && gameMode === 'ai') return turn === 'player';
    if (!currentRoom) return false;
    if (isWaitingSpectator || !activePlayerId) return false;
    if (!hasFriendJoined) return false;
    if (currentRoom.status === 'finished') return false;
    if (currentRoom.status === 'waiting' && !currentRoom.isOpenGroup) return false;
    if (turn !== mySide) return false;
    const roomTurn =
      currentRoom.currentTurnUserId || currentRoom.currentTurn || expectedTurnActorId || '';
    if (roomTurn !== activePlayerId || expectedTurnActorId !== activePlayerId) return false;
    return true;
  })();

  const isAuthorizedRef = useRef(isAuthorizedMultiplayerActor);
  isAuthorizedRef.current = isAuthorizedMultiplayerActor;

  const drawBoard = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const targetPx = Math.round(SIZE * dpr);
    if (canvas.width !== targetPx || canvas.height !== targetPx) {
      canvas.width = targetPx;
      canvas.height = targetPx;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Outer wooden rosewood frame
    const frameGrad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    frameGrad.addColorStop(0, '#5C240A');
    frameGrad.addColorStop(0.5, '#78350F');
    frameGrad.addColorStop(1, '#451A03');
    ctx.fillStyle = frameGrad;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Subtle inner frame bevel
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.14)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(BOARD_FRAME - 2, BOARD_FRAME - 2, SIZE - (BOARD_FRAME - 2) * 2, SIZE - (BOARD_FRAME - 2) * 2);

    // Birch playing surface
    const surfGrad = ctx.createRadialGradient(
      SIZE / 2,
      SIZE / 2,
      20,
      SIZE / 2,
      SIZE / 2,
      SIZE * 0.65
    );
    surfGrad.addColorStop(0, '#FFFBEB');
    surfGrad.addColorStop(1, '#FDE68A');
    ctx.fillStyle = surfGrad;
    ctx.beginPath();
    ctx.roundRect(BOARD_FRAME, BOARD_FRAME, SIZE - BOARD_FRAME * 2, SIZE - BOARD_FRAME * 2, 18);
    ctx.fill();

    // Diagonal foul guide lines toward the 4 pockets
    ctx.strokeStyle = 'rgba(146, 64, 14, 0.28)';
    ctx.lineWidth = 1.25;
    POCKETS.forEach((p) => {
      const dirX = p.x < SIZE / 2 ? 1 : -1;
      const dirY = p.y < SIZE / 2 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(p.x + dirX * 26, p.y + dirY * 26);
      ctx.lineTo(p.x + dirX * 82, p.y + dirY * 82);
      ctx.stroke();

      // Small arrow tip arc
      ctx.beginPath();
      ctx.arc(p.x + dirX * 82, p.y + dirY * 82, 4.5, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Decorative center lotus circle & Queen ring
    ctx.strokeStyle = 'rgba(185, 28, 28, 0.35)';
    ctx.lineWidth = 1.75;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, 50, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(185, 28, 28, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, 44, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(220, 38, 38, 0.14)';
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Player & Opponent Baselines
    [BASELINE_Y_PLAYER, BASELINE_Y_AI].forEach((by, idx) => {
      const isActiveLine =
        !isSimulatingRef.current &&
        !finishedRef.current &&
        ((idx === 0 && turnRef.current === 'player') ||
          (idx === 1 && turnRef.current === 'opponent'));

      ctx.strokeStyle = isActiveLine ? 'rgba(37, 99, 235, 0.65)' : 'rgba(120, 53, 15, 0.42)';
      ctx.lineWidth = isActiveLine ? 2.2 : 1.7;
      ctx.beginPath();
      ctx.moveTo(BASELINE_MARGIN_X, by - 6);
      ctx.lineTo(SIZE - BASELINE_MARGIN_X, by - 6);
      ctx.moveTo(BASELINE_MARGIN_X, by + 6);
      ctx.lineTo(SIZE - BASELINE_MARGIN_X, by + 6);
      ctx.stroke();

      [BASELINE_MARGIN_X, SIZE - BASELINE_MARGIN_X].forEach((endX) => {
        ctx.fillStyle = '#DC2626';
        ctx.beginPath();
        ctx.arc(endX, by, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FEF3C7';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      });
    });

    // 4 Corner Pockets (recessed shadow + inner dark well)
    POCKETS.forEach((p) => {
      ctx.fillStyle = '#020617';
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#92400E';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_RADIUS - 3, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Coins with soft shadows & detail rings
    coinsRef.current.forEach((c) => {
      if (c.pocketed) return;
      ctx.save();
      ctx.shadowColor = 'rgba(15, 23, 42, 0.28)';
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 1.5;

      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      if (c.type === 'queen') {
        ctx.fillStyle = '#DC2626';
        ctx.strokeStyle = '#FCA5A5';
      } else if (c.type === 'white') {
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#94A3B8';
      } else {
        ctx.fillStyle = '#1E293B';
        ctx.strokeStyle = '#64748B';
      }
      ctx.fill();
      ctx.restore();

      ctx.lineWidth = 1.6;
      ctx.strokeStyle =
        c.type === 'queen' ? '#FCA5A5' : c.type === 'white' ? '#CBD5E1' : '#475569';
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.stroke();

      // Inner decorative groove on coin
      ctx.lineWidth = 1;
      ctx.strokeStyle =
        c.type === 'queen'
          ? 'rgba(254, 240, 138, 0.65)'
          : c.type === 'white'
          ? 'rgba(148, 163, 184, 0.45)'
          : 'rgba(148, 163, 184, 0.32)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Striker + Aiming Guide + Slingshot Pullback Visuals
    const st = strikerRef.current;
    if (!st.pocketed) {
      const canShowAim = !isSimulatingRef.current && !finishedRef.current;

      if (canShowAim) {
        const curTurn = turnRef.current;
        const curAngle = aimAngleRef.current;
        const curPower = powerRef.current;
        const dirRad = ((curTurn === 'player' ? -90 : 90) + curAngle) * (Math.PI / 180);
        const guideLen = 40 + curPower * 0.85;
        const endX = st.x + Math.cos(dirRad) * guideLen;
        const endY = st.y + Math.sin(dirRad) * guideLen;

        // Forward aim line
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle =
          dragRef.current.mode === 'slingshot'
            ? 'rgba(220, 38, 38, 0.85)'
            : 'rgba(37, 99, 235, 0.78)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(st.x, st.y);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Target reticle at aim tip
        ctx.setLineDash([]);
        ctx.fillStyle =
          dragRef.current.mode === 'slingshot'
            ? 'rgba(220, 38, 38, 0.85)'
            : 'rgba(37, 99, 235, 0.8)';
        ctx.beginPath();
        ctx.arc(endX, endY, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Slingshot pullback tension ring & cue vector
        if (dragRef.current.mode === 'slingshot' && dragRef.current.pullDist > 6) {
          const drag = dragRef.current;
          const ringRadius = Math.min(48, 16 + drag.pullDist * 0.35);
          ctx.save();
          ctx.strokeStyle = 'rgba(234, 88, 12, 0.75)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(st.x, st.y, ringRadius, 0, Math.PI * 2);
          ctx.stroke();

          ctx.strokeStyle = 'rgba(234, 88, 12, 0.9)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(st.x, st.y);
          ctx.lineTo(drag.pullX, drag.pullY);
          ctx.stroke();

          ctx.fillStyle = '#EA580C';
          ctx.beginPath();
          ctx.arc(drag.pullX, drag.pullY, 5, 0, Math.PI * 2);
          ctx.fill();

          // Live power percentage label
          ctx.fillStyle = '#0F172A';
          ctx.beginPath();
          ctx.roundRect(st.x - 19, st.y + (curTurn === 'player' ? -34 : 18), 38, 16, 6);
          ctx.fill();
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 10px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            `${curPower}%`,
            st.x,
            st.y + (curTurn === 'player' ? -26 : 26)
          );
          ctx.restore();
        }
      }

      // Striker body
      ctx.save();
      ctx.shadowColor = 'rgba(37, 99, 235, 0.35)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fillStyle = '#2563EB';
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#93C5FD';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(st.x, st.y, 6.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#DBEAFE';
      ctx.beginPath();
      ctx.arc(st.x, st.y, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }, []);

  const drawBoardRef = useRef(drawBoard);
  drawBoardRef.current = drawBoard;

  // Keep striker visual position synced whenever idle controls change
  useEffect(() => {
    if (!isSimulating) {
      strikerRef.current.x = strikerX;
      strikerRef.current.y = turn === 'player' ? BASELINE_Y_PLAYER : BASELINE_Y_AI;
      strikerRef.current.pocketed = false;
    }
    drawBoard();
  }, [strikerX, aimAngle, power, turn, isSimulating, drawBoard]);

  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (aiTimerRef.current) window.clearTimeout(aiTimerRef.current);
    };
  }, []);

  // Clear AI timer if entering non-bot multiplayer room
  useEffect(() => {
    if ((gameMode !== 'ai' || currentRoom) && !currentRoom?.isBotMatch) {
      if (aiTimerRef.current) {
        window.clearTimeout(aiTimerRef.current);
        aiTimerRef.current = null;
      }
    }
  }, [gameMode, currentRoom]);

  // Reset board ONLY when switching rooms or switching AI/multiplayer mode (NOT on drawBoard/aim/power changes)
  useEffect(() => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    if (aiTimerRef.current) {
      window.clearTimeout(aiTimerRef.current);
      aiTimerRef.current = null;
    }
    finishedRef.current = false;
    lastAwardedFinishRef.current = null;
    lastAppliedMoveIdRef.current = null;
    dragRef.current = {
      mode: 'none',
      pointerId: null,
      pullDist: 0,
      pullX: SIZE / 2,
      pullY: BASELINE_Y_PLAYER,
    };
    const freshCoins = createInitialCoins();
    coinsRef.current = freshCoins;
    const safeX = findSafeStrikerX(SIZE / 2, BASELINE_Y_PLAYER, freshCoins);
    strikerRef.current = {
      id: 'striker',
      x: safeX,
      y: BASELINE_Y_PLAYER,
      vx: 0,
      vy: 0,
      r: 12.5,
      type: 'striker',
      pocketed: false,
    };
    setStrikerX(safeX);
    setAimAngle(0);
    setPower(74);
    setTurn('player');
    setIsSimulating(false);
    setIsPullingBack(false);
    setScores({ player: 0, opponent: 0, queenHolder: '' });
    setWinnerMsg(null);
    setStatusLog(['Drag back from the striker & release to shoot, or tap anywhere to aim!']);
    drawBoardRef.current();
  }, [currentRoom?.roomCode, gameMode]);

  const applyCarromSnapshotState = useCallback(
    (incoming: CarromSyncedState) => {
      if (!incoming) return;
      if (incoming.moveId && lastAppliedMoveIdRef.current === incoming.moveId) {
        return;
      }
      if (incoming.moveId) {
        lastAppliedMoveIdRef.current = incoming.moveId;
      }
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
      setIsSimulating(false);
      setIsPullingBack(false);

      if (Array.isArray(incoming.coins) && incoming.coins.length > 0) {
        coinsRef.current = incoming.coins.map((c) => ({
          ...c,
          vx: 0,
          vy: 0,
        }));
      } else {
        coinsRef.current = createInitialCoins();
      }

      const syncedTurn = incoming.turn === 'opponent' ? 'opponent' : 'player';
      setTurn(syncedTurn);
      if (incoming.scores) {
        setScores(incoming.scores);
      }
      if (Array.isArray(incoming.statusLog) && incoming.statusLog.length > 0) {
        setStatusLog(incoming.statusLog);
      }

      const wasFinished = finishedRef.current;
      const isNowFinished = Boolean(incoming.finished);
      finishedRef.current = isNowFinished;
      if (!isNowFinished) {
        lastAwardedFinishRef.current = null;
      }
      setWinnerMsg(incoming.winnerMsg ?? null);

      if (isNowFinished && !wasFinished && currentRoomRef.current && gameModeRef.current !== 'ai') {
        const finalScores = incoming.scores || scoresRef.current;
        const finishSig = `${currentRoomRef.current.roomCode}:${finalScores.player}:${finalScores.opponent}:${incoming.winnerMsg || ''}`;
        if (lastAwardedFinishRef.current !== finishSig && incoming.byPlayerId !== activePlayerId) {
          lastAwardedFinishRef.current = finishSig;
          const p1Won = finalScores.player >= finalScores.opponent;
          const didMySideWin = mySide === 'player' ? p1Won : !p1Won;
          const summary = didMySideWin
            ? `Victory ${finalScores.player}-${finalScores.opponent}`
            : `Match ${finalScores.player}-${finalScores.opponent}`;
          if (didMySideWin) {
            soundFx.playWin();
          } else {
            soundFx.playMove();
          }
          onMatchFinish(didMySideWin ? 'win' : 'loss', summary, didMySideWin ? 45 : 10);
        }
      }

      const targetSy = syncedTurn === 'player' ? BASELINE_Y_PLAYER : BASELINE_Y_AI;
      const preferredX =
        typeof incoming.striker?.x === 'number' && Number.isFinite(incoming.striker.x)
          ? clamp(incoming.striker.x, BASELINE_MARGIN_X, SIZE - BASELINE_MARGIN_X)
          : SIZE / 2;
      const safeX = findSafeStrikerX(preferredX, targetSy, coinsRef.current);

      if (typeof incoming.striker?.angle === 'number' && Number.isFinite(incoming.striker.angle)) {
        setAimAngle(incoming.striker.angle);
      }
      if (typeof incoming.striker?.power === 'number' && Number.isFinite(incoming.striker.power)) {
        setPower(incoming.striker.power);
      }

      strikerRef.current = {
        id: 'striker',
        x: safeX,
        y: targetSy,
        vx: 0,
        vy: 0,
        r: 12.5,
        type: 'striker',
        pocketed: false,
      };
      setStrikerX(safeX);
      drawBoardRef.current();
    },
    [activePlayerId, mySide, onMatchFinish]
  );

  // Hydrate board state from parent syncedState (GamesView maintains the single room onSnapshot)
  useEffect(() => {
    if (!syncedState) return;
    applyCarromSnapshotState(syncedState);
  }, [syncedState, applyCarromSnapshotState]);

  const executeStrike = useCallback(
    (
      strikeX: number,
      strikeAngleDeg: number,
      strikePower: number,
      activeSide: 'player' | 'opponent',
      isAiShot = false
    ) => {
      if (isSimulatingRef.current || finishedRef.current) return;
      const room = currentRoomRef.current;
      const mode = gameModeRef.current;

      if (room && mode !== 'ai' && !isAiShot) {
        if (!isAuthorizedRef.current || activeSide !== mySide) {
          soundFx.playError();
          return;
        }
      } else if (mode === 'ai' && activeSide === 'player' && isAiShot) {
        return;
      }

      dragRef.current.mode = 'none';
      dragRef.current.pointerId = null;
      setIsPullingBack(false);
      setIsSimulating(true);
      isSimulatingRef.current = true;
      soundFx.playMove();

      const st = strikerRef.current;
      const activeBaselineY = activeSide === 'player' ? BASELINE_Y_PLAYER : BASELINE_Y_AI;
      st.x = findSafeStrikerX(strikeX, activeBaselineY, coinsRef.current);
      st.y = activeBaselineY;
      st.pocketed = false;

      const rad = ((activeSide === 'player' ? -90 : 90) + strikeAngleDeg) * (Math.PI / 180);
      const speed = 4.2 + (clamp(strikePower, 20, 100) / 100) * 12.2;
      st.vx = Math.cos(rad) * speed;
      st.vy = Math.sin(rad) * speed;

      const pocketedThisTurn: Coin['type'][] = [];
      const dampingPerSubstep = Math.pow(0.973, 1 / SUBSTEPS);

      const step = () => {
        const activeBodies = [st, ...coinsRef.current.filter((c) => !c.pocketed)];

        for (let sub = 0; sub < SUBSTEPS; sub++) {
          // 1. Move, damp & rebound off wooden cushions
          for (const b of activeBodies) {
            if (b.pocketed) continue;
            b.x += b.vx / SUBSTEPS;
            b.y += b.vy / SUBSTEPS;
            b.vx *= dampingPerSubstep;
            b.vy *= dampingPerSubstep;

            const minBound = BOARD_FRAME + b.r;
            const maxBound = SIZE - BOARD_FRAME - b.r;
            if (b.x < minBound) {
              b.x = minBound;
              b.vx = Math.abs(b.vx) * 0.84;
            } else if (b.x > maxBound) {
              b.x = maxBound;
              b.vx = -Math.abs(b.vx) * 0.84;
            }
            if (b.y < minBound) {
              b.y = minBound;
              b.vy = Math.abs(b.vy) * 0.84;
            } else if (b.y > maxBound) {
              b.y = maxBound;
              b.vy = -Math.abs(b.vy) * 0.84;
            }
          }

          // 2. Pairwise elastic collisions with realistic striker/coin mass ratio
          for (let i = 0; i < activeBodies.length; i++) {
            for (let j = i + 1; j < activeBodies.length; j++) {
              const a = activeBodies[i];
              const b = activeBodies[j];
              if (a.pocketed || b.pocketed) continue;
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const dist = Math.hypot(dx, dy);
              const minDist = a.r + b.r;
              if (dist > 0.0001 && dist < minDist) {
                const nx = dx / dist;
                const ny = dy / dist;
                const invMassA = a.type === 'striker' ? 1 / 1.45 : 1;
                const invMassB = b.type === 'striker' ? 1 / 1.45 : 1;
                const totalInvMass = invMassA + invMassB;

                const overlap = minDist - dist;
                a.x -= nx * overlap * (invMassA / totalInvMass);
                a.y -= ny * overlap * (invMassA / totalInvMass);
                b.x += nx * overlap * (invMassB / totalInvMass);
                b.y += ny * overlap * (invMassB / totalInvMass);

                const rvx = a.vx - b.vx;
                const rvy = a.vy - b.vy;
                const velAlongNormal = rvx * nx + rvy * ny;
                if (velAlongNormal > 0) {
                  const restitution = 0.92;
                  const jImpulse = ((1 + restitution) * velAlongNormal) / totalInvMass;
                  a.vx -= jImpulse * invMassA * nx;
                  a.vy -= jImpulse * invMassA * ny;
                  b.vx += jImpulse * invMassB * nx;
                  b.vy += jImpulse * invMassB * ny;
                }
              }
            }
          }

          // 3. Corner pocketing check
          for (const b of activeBodies) {
            if (b.pocketed) continue;
            for (const p of POCKETS) {
              if (Math.hypot(b.x - p.x, b.y - p.y) < POCKET_RADIUS + 1.5) {
                b.pocketed = true;
                b.vx = 0;
                b.vy = 0;
                pocketedThisTurn.push(b.type);
                soundFx.playCapture();
                break;
              }
            }
          }
        }

        // Snap near-stationary pieces to rest
        for (const b of activeBodies) {
          if (!b.pocketed && Math.hypot(b.vx, b.vy) < 0.09) {
            b.vx = 0;
            b.vy = 0;
          }
        }

        drawBoardRef.current();

        const stillMoving = activeBodies.some((b) => !b.pocketed && Math.hypot(b.vx, b.vy) > 0.09);
        if (stillMoving) {
          animRef.current = requestAnimationFrame(step);
          return;
        }

        // Turn settled
        animRef.current = null;
        setIsSimulating(false);
        isSimulatingRef.current = false;

        let playerGain = 0;
        let oppGain = 0;
        let queenMsg = '';
        let foul = false;
        let scoredOwnCoin = false;

        pocketedThisTurn.forEach((t) => {
          if (t === 'striker') {
            foul = true;
          } else if (t === 'queen') {
            if (activeSide === 'player') playerGain += 30;
            else oppGain += 30;
            queenMsg = activeSide === 'player' ? 'P1 (White)' : 'P2 (Black)';
            scoredOwnCoin = true;
          } else if (t === 'white') {
            playerGain += 10;
            if (activeSide === 'player') scoredOwnCoin = true;
          } else if (t === 'black') {
            oppGain += 10;
            if (activeSide === 'opponent') scoredOwnCoin = true;
          }
        });

        const prevScores = scoresRef.current;
        const nextScores = {
          player: Math.max(0, prevScores.player + playerGain - (foul && activeSide === 'player' ? 5 : 0)),
          opponent: Math.max(
            0,
            prevScores.opponent + oppGain - (foul && activeSide === 'opponent' ? 5 : 0)
          ),
          queenHolder: queenMsg || prevScores.queenHolder,
        };
        setScores(nextScores);

        const remainingCoins = coinsRef.current.filter((c) => !c.pocketed);
        const whitesLeft = remainingCoins.filter((c) => c.type === 'white').length;
        const blacksLeft = remainingCoins.filter((c) => c.type === 'black').length;
        const matchEnded = whitesLeft === 0 || blacksLeft === 0 || remainingCoins.length === 0;

        let computedWinnerMsg: string | null = null;
        if (matchEnded && !finishedRef.current) {
          finishedRef.current = true;
          const p1Won = nextScores.player >= nextScores.opponent;
          const didMySideWin =
            gameModeRef.current === 'ai' || !currentRoomRef.current
              ? p1Won
              : mySide === 'player'
              ? p1Won
              : !p1Won;
          const summary = didMySideWin
            ? `Victory ${nextScores.player}-${nextScores.opponent}`
            : `Match ${nextScores.player}-${nextScores.opponent}`;
          computedWinnerMsg = p1Won
            ? `White (P1) won Carrom (${nextScores.player} vs ${nextScores.opponent})!`
            : `Black (P2) won Carrom (${nextScores.opponent} vs ${nextScores.player})!`;
          const finishSig = `${currentRoomRef.current?.roomCode || 'ai'}:${nextScores.player}:${nextScores.opponent}:${computedWinnerMsg}`;
          lastAwardedFinishRef.current = finishSig;
          setWinnerMsg(computedWinnerMsg);
          if (didMySideWin) {
            soundFx.playWin();
          } else {
            soundFx.playMove();
          }
          onMatchFinish(didMySideWin ? 'win' : 'loss', summary, didMySideWin ? 45 : 10);
        }

        const turnLabel =
          gameModeRef.current === 'ai'
            ? activeSide === 'player'
              ? 'You'
              : 'AI Bot'
            : activeSide === 'player'
            ? currentRoomRef.current?.players[0]?.name?.split(' ')[0] || 'Player 1'
            : currentRoomRef.current?.players[1]?.name?.split(' ')[0] || 'Player 2';

        const logMsg = foul
          ? `${turnLabel} pocketed Striker (-5 foul)! Turn passes.`
          : pocketedThisTurn.length > 0
          ? `${turnLabel} pocketed ${pocketedThisTurn.join(', ')}!`
          : `${turnLabel} missed pockets.`;
        const nextLogs = [logMsg, ...statusLogRef.current.slice(0, 3)];
        setStatusLog(nextLogs);

        const nextSide: 'player' | 'opponent' =
          scoredOwnCoin && !foul ? activeSide : activeSide === 'player' ? 'opponent' : 'player';
        const nextSy = nextSide === 'player' ? BASELINE_Y_PLAYER : BASELINE_Y_AI;
        const nextSafeStrikerX = findSafeStrikerX(SIZE / 2, nextSy, coinsRef.current);

        strikerRef.current.pocketed = false;
        strikerRef.current.x = nextSafeStrikerX;
        strikerRef.current.y = nextSy;
        strikerRef.current.vx = 0;
        strikerRef.current.vy = 0;
        setStrikerX(nextSafeStrikerX);
        setTurn(nextSide);
        turnRef.current = nextSide;
        drawBoardRef.current();

        // Broadcast full Carrom board & turn state to Firestore room
        const activeRoom = currentRoomRef.current;
        if (activeRoom && gameModeRef.current !== 'ai' && onSyncMove) {
          const roomP1 =
            activeRoom.players[0]?.id || activeRoom.player1Id || activeRoom.hostId || '';
          const roomP2 = activeRoom.players[1]?.id || activeRoom.player2Id || '';
          const nextTurnActorId = nextSide === 'player' ? roomP1 : roomP2;
          const actorForMove = isAiShot && activeRoom.isBotMatch && roomP2 ? roomP2 : activePlayerId;
          const serializedCoins: CarromSyncedCoin[] = coinsRef.current.map((c) => ({
            id: c.id,
            x: Math.round(c.x * 100) / 100,
            y: Math.round(c.y * 100) / 100,
            r: c.r,
            type: c.type,
            pocketed: c.pocketed,
          }));
          onSyncMove(
            {
              coins: serializedCoins,
              striker: { x: Math.round(nextSafeStrikerX), angle: strikeAngleDeg, power: strikePower },
              turn: nextSide,
              currentTurn: nextTurnActorId,
              scores: nextScores,
              statusLog: nextLogs,
              winnerMsg: computedWinnerMsg,
              finished: finishedRef.current,
              byPlayerId: actorForMove,
            },
            nextTurnActorId,
            finishedRef.current ? 'finished' : 'playing'
          );
        }

        // Trigger AI turn ONLY in AI mode with no active room
        if (
          !finishedRef.current &&
          gameModeRef.current === 'ai' &&
          !currentRoomRef.current &&
          nextSide === 'opponent'
        ) {
          aiTimerRef.current = window.setTimeout(() => {
            if (finishedRef.current || gameModeRef.current !== 'ai' || currentRoomRef.current) return;
            const targets = coinsRef.current.filter(
              (c) => !c.pocketed && (c.type === 'black' || c.type === 'queen')
            );
            const fallbackTargets = coinsRef.current.filter((c) => !c.pocketed);
            const pool = targets.length > 0 ? targets : fallbackTargets;

            // Pick target closest to any bottom/top pocket alignment
            let chosen = pool[0];
            let bestScore = Infinity;
            for (const c of pool) {
              const distPocket = Math.min(
                ...POCKETS.map((p) => Math.hypot(c.x - p.x, c.y - p.y))
              );
              const distBaseline = Math.abs(c.y - BASELINE_Y_AI);
              const s = distPocket + distBaseline * 0.25;
              if (s < bestScore) {
                bestScore = s;
                chosen = c;
              }
            }

            const preferredAiX = chosen
              ? clamp(chosen.x + (Math.random() - 0.5) * 28, BASELINE_MARGIN_X + 10, SIZE - BASELINE_MARGIN_X - 10)
              : SIZE / 2;
            const sx = findSafeStrikerX(preferredAiX, BASELINE_Y_AI, coinsRef.current);

            let angleDeg = 0;
            if (chosen) {
              const rawRad = Math.atan2(chosen.y - BASELINE_Y_AI, chosen.x - sx);
              const rawDeg = (rawRad * 180) / Math.PI - 90;
              const jitter = aiDifficulty === 'hard' ? 2.5 : aiDifficulty === 'medium' ? 8 : 18;
              angleDeg = clamp(rawDeg + (Math.random() - 0.5) * jitter, -75, 75);
            }
            const aiPow = aiDifficulty === 'hard' ? 86 : aiDifficulty === 'medium' ? 76 : 64;
            executeStrike(sx, angleDeg, aiPow, 'opponent', true);
          }, 700);
        }
      };

      animRef.current = requestAnimationFrame(step);
    },
    [aiDifficulty, activePlayerId, mySide, onMatchFinish, onSyncMove]
  );

  // Automated 1.5-second Demo Challenger shot when playing in Random Play `isBotMatch`
  useEffect(() => {
    const room = currentRoom;
    if (
      !room ||
      !room.isBotMatch ||
      room.status === 'finished' ||
      finishedRef.current ||
      isSimulating ||
      turn !== 'opponent'
    ) {
      return;
    }
    const roomP1 = room.players[0]?.id || room.player1Id || room.hostId || '';
    const roomP2 = room.players[1]?.id || room.player2Id || '';
    if (!roomP1 || roomP1 !== activePlayerId || !roomP2.startsWith('bot_demo_')) {
      return;
    }

    const timer = window.setTimeout(() => {
      const liveRoom = currentRoomRef.current;
      if (
        !liveRoom ||
        liveRoom.roomCode !== room.roomCode ||
        !liveRoom.isBotMatch ||
        liveRoom.status === 'finished' ||
        finishedRef.current ||
        isSimulatingRef.current ||
        turnRef.current !== 'opponent'
      ) {
        return;
      }

      const targets = coinsRef.current.filter(
        (c) => !c.pocketed && (c.type === 'black' || c.type === 'queen')
      );
      const fallbackTargets = coinsRef.current.filter((c) => !c.pocketed);
      const pool = targets.length > 0 ? targets : fallbackTargets;
      let chosen = pool[0];
      let bestScore = Infinity;
      for (const c of pool) {
        const distPocket = Math.min(...POCKETS.map((p) => Math.hypot(c.x - p.x, c.y - p.y)));
        const distBaseline = Math.abs(c.y - BASELINE_Y_AI);
        const s = distPocket + distBaseline * 0.25;
        if (s < bestScore) {
          bestScore = s;
          chosen = c;
        }
      }
      const preferredAiX = chosen
        ? clamp(chosen.x + (Math.random() - 0.5) * 28, BASELINE_MARGIN_X + 10, SIZE - BASELINE_MARGIN_X - 10)
        : SIZE / 2;
      const sx = findSafeStrikerX(preferredAiX, BASELINE_Y_AI, coinsRef.current);
      let angleDeg = 0;
      if (chosen) {
        const rawRad = Math.atan2(chosen.y - BASELINE_Y_AI, chosen.x - sx);
        const rawDeg = (rawRad * 180) / Math.PI - 90;
        const jitter = aiDifficulty === 'hard' ? 2.5 : aiDifficulty === 'medium' ? 8 : 18;
        angleDeg = clamp(rawDeg + (Math.random() - 0.5) * jitter, -75, 75);
      }
      const aiPow = aiDifficulty === 'hard' ? 86 : aiDifficulty === 'medium' ? 76 : 64;
      executeStrike(sx, angleDeg, aiPow, 'opponent', true);
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [activePlayerId, aiDifficulty, currentRoom, executeStrike, isSimulating, turn]);

  const getBoardCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: clamp(((e.clientX - rect.left) / rect.width) * SIZE, 0, SIZE),
      y: clamp(((e.clientY - rect.top) / rect.height) * SIZE, 0, SIZE),
    };
  };

  const canCurrentUserAct = () => {
    if (isSimulatingRef.current || finishedRef.current) return false;
    if (gameModeRef.current === 'ai' && !currentRoomRef.current) {
      return turnRef.current === 'player';
    }
    return isAuthorizedRef.current;
  };

  const computeAimFromPoint = (px: number, py: number, sx: number, sy: number, activeSide: 'player' | 'opponent') => {
    const dx = px - sx;
    const dy = py - sy;
    const baseDeg = activeSide === 'player' ? -90 : 90;
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI - baseDeg;
    // Normalize to [-180, 180]
    while (deg > 180) deg -= 360;
    while (deg < -180) deg += 360;
    return clamp(Math.round(deg), -80, 80);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canCurrentUserAct()) return;
    const { x, y } = getBoardCoords(e);
    const activeSide = turnRef.current;
    const sy = activeSide === 'player' ? BASELINE_Y_PLAYER : BASELINE_Y_AI;
    const sx = strikerRef.current.x;
    const distToStriker = Math.hypot(x - sx, y - sy);

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore pointer capture errors on synthetic events
    }

    if (distToStriker <= 28) {
      dragRef.current = {
        mode: 'slingshot',
        pointerId: e.pointerId,
        pullDist: 0,
        pullX: x,
        pullY: y,
      };
      setIsPullingBack(true);
      drawBoardRef.current();
      return;
    }

    if (Math.abs(y - sy) <= 18 && x >= BASELINE_MARGIN_X - 8 && x <= SIZE - BASELINE_MARGIN_X + 8) {
      dragRef.current = {
        mode: 'slide',
        pointerId: e.pointerId,
        pullDist: 0,
        pullX: x,
        pullY: y,
      };
      const nextX = findSafeStrikerX(x, sy, coinsRef.current);
      setStrikerX(nextX);
      strikerRef.current.x = nextX;
      drawBoardRef.current();
      return;
    }

    dragRef.current = {
      mode: 'aim',
      pointerId: e.pointerId,
      pullDist: 0,
      pullX: x,
      pullY: y,
    };
    const nextAngle = computeAimFromPoint(x, y, sx, sy, activeSide);
    setAimAngle(nextAngle);
    aimAngleRef.current = nextAngle;
    drawBoardRef.current();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag.mode === 'none' || drag.pointerId !== e.pointerId) return;
    if (!canCurrentUserAct()) return;

    const { x, y } = getBoardCoords(e);
    const activeSide = turnRef.current;
    const sy = activeSide === 'player' ? BASELINE_Y_PLAYER : BASELINE_Y_AI;
    const sx = strikerRef.current.x;

    if (drag.mode === 'slide') {
      const nextX = findSafeStrikerX(x, sy, coinsRef.current);
      setStrikerX(nextX);
      strikerRef.current.x = nextX;
      drawBoardRef.current();
      return;
    }

    if (drag.mode === 'aim') {
      const nextAngle = computeAimFromPoint(x, y, sx, sy, activeSide);
      setAimAngle(nextAngle);
      aimAngleRef.current = nextAngle;
      drawBoardRef.current();
      return;
    }

    if (drag.mode === 'slingshot') {
      // Aim vector is opposite of pullback vector (from pointer back through striker)
      const pullDx = sx - x;
      const pullDy = sy - y;
      const pullDist = Math.hypot(pullDx, pullDy);
      drag.pullDist = pullDist;
      drag.pullX = x;
      drag.pullY = y;

      if (pullDist > 6) {
        const nextAngle = computeAimFromPoint(sx + pullDx, sy + pullDy, sx, sy, activeSide);
        const scaledPower = clamp(Math.round(20 + (pullDist / 88) * 80), 20, 100);
        setAimAngle(nextAngle);
        setPower(scaledPower);
        aimAngleRef.current = nextAngle;
        powerRef.current = scaledPower;
      }
      drawBoardRef.current();
    }
  };

  const finishPointerDrag = (e: React.PointerEvent<HTMLCanvasElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (drag.mode === 'none' || (drag.pointerId !== null && drag.pointerId !== e.pointerId)) {
      return;
    }

    const wasSlingshot = drag.mode === 'slingshot';
    const pullDist = drag.pullDist;

    dragRef.current = {
      mode: 'none',
      pointerId: null,
      pullDist: 0,
      pullX: strikerRef.current.x,
      pullY: strikerRef.current.y,
    };
    setIsPullingBack(false);

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }

    drawBoardRef.current();

    if (!cancelled && wasSlingshot && pullDist >= 15 && canCurrentUserAct()) {
      executeStrike(
        strikerRef.current.x,
        aimAngleRef.current,
        powerRef.current,
        turnRef.current
      );
    }
  };

  const resetCarrom = (triggerRemote = true) => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    if (aiTimerRef.current) {
      window.clearTimeout(aiTimerRef.current);
      aiTimerRef.current = null;
    }
    finishedRef.current = false;
    lastAwardedFinishRef.current = null;
    dragRef.current = {
      mode: 'none',
      pointerId: null,
      pullDist: 0,
      pullX: SIZE / 2,
      pullY: BASELINE_Y_PLAYER,
    };
    const freshCoins = createInitialCoins();
    coinsRef.current = freshCoins;
    const safeX = findSafeStrikerX(SIZE / 2, BASELINE_Y_PLAYER, freshCoins);
    strikerRef.current = {
      id: 'striker',
      x: safeX,
      y: BASELINE_Y_PLAYER,
      vx: 0,
      vy: 0,
      r: 12.5,
      type: 'striker',
      pocketed: false,
    };
    setStrikerX(safeX);
    setAimAngle(0);
    setPower(74);
    setTurn('player');
    turnRef.current = 'player';
    setIsSimulating(false);
    isSimulatingRef.current = false;
    setIsPullingBack(false);
    setScores({ player: 0, opponent: 0, queenHolder: '' });
    setWinnerMsg(null);
    setStatusLog(['Board reset! Drag back from striker & release to shoot.']);
    drawBoardRef.current();
    if (triggerRemote && currentRoom && onRequestRematch) {
      onRequestRematch();
    }
  };

  const isPlayerBlocked =
    isSimulating ||
    finishedRef.current ||
    (gameMode === 'ai' && !currentRoom
      ? turn === 'opponent'
      : Boolean(currentRoom) && !isAuthorizedMultiplayerActor);

  return (
    <div className="max-w-md mx-auto flex flex-col items-center">
      <div className="flex items-center justify-between w-full mb-3 text-xs font-bold px-2 gap-2">
        <span className={turn === 'player' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'}>
          {currentRoom
            ? `${currentRoom.host?.name || currentRoom.players[0]?.name || 'P1'} (White)`
            : 'You (White)'}
          : {scores.player} pts
        </span>
        <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold shrink-0">
          {scores.queenHolder ? `Queen: ${scores.queenHolder}` : 'Queen: +30'}
        </span>
        <span className={turn === 'opponent' ? 'text-purple-600 dark:text-purple-400' : 'text-slate-500'}>
          {gameMode === 'ai' && !currentRoom
            ? 'AI (Black)'
            : `${currentRoom?.guest?.name || currentRoom?.players[1]?.name || 'Waiting...'} (Black)`}
          : {scores.opponent} pts
        </span>
      </div>

      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => finishPointerDrag(e, false)}
        onPointerCancel={(e) => finishPointerDrag(e, true)}
        className="w-full max-w-[min(340px,100%)] aspect-square rounded-3xl shadow-2xl cursor-crosshair touch-none select-none game-surface border-2 border-amber-900/50"
      />

      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 text-center">
        {isPullingBack
          ? 'Release to strike! Pull further for higher power.'
          : 'Tip: Drag back on striker to shoot · Tap baseline to slide · Tap board to aim'}
      </p>

      {winnerMsg && (
        <div className="mt-3 w-full p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="truncate">{winnerMsg}</span>
          </div>
          <button
            type="button"
            disabled={Boolean(currentRoom && isWaitingSpectator)}
            onClick={() => resetCarrom(true)}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shrink-0"
          >
            Rematch
          </button>
        </div>
      )}

      <div className="w-full mt-3 space-y-3 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/60">
        <div>
          <div className="flex justify-between text-[11px] font-semibold mb-1">
            <span className="flex items-center gap-1">
              <MoveHorizontal className="w-3.5 h-3.5 text-blue-500" />
              <span>Striker Position</span>
            </span>
            <span className="font-mono">{Math.round(strikerX)}px</span>
          </div>
          <input
            type="range"
            min={BASELINE_MARGIN_X}
            max={SIZE - BASELINE_MARGIN_X}
            value={strikerX}
            disabled={isPlayerBlocked}
            onChange={(e) => {
              const sy = turn === 'player' ? BASELINE_Y_PLAYER : BASELINE_Y_AI;
              const safeX = findSafeStrikerX(Number(e.target.value), sy, coinsRef.current);
              setStrikerX(safeX);
            }}
            className="w-full accent-blue-600"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex justify-between text-[11px] font-semibold mb-1">
              <span>Aim Angle</span>
              <span className="font-mono">{aimAngle}°</span>
            </div>
            <input
              type="range"
              min="-80"
              max="80"
              value={aimAngle}
              disabled={isPlayerBlocked}
              onChange={(e) => setAimAngle(Number(e.target.value))}
              className="w-full accent-amber-600"
            />
          </div>
          <div>
            <div className="flex justify-between text-[11px] font-semibold mb-1">
              <span>Strike Power</span>
              <span className="font-mono">{power}%</span>
            </div>
            <input
              type="range"
              min="20"
              max="100"
              value={power}
              disabled={isPlayerBlocked}
              onChange={(e) => setPower(Number(e.target.value))}
              className="w-full accent-emerald-600"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={isPlayerBlocked}
            onClick={() => executeStrike(strikerX, aimAngle, power, turn)}
            className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md transition-colors flex items-center justify-center gap-2 min-h-[44px]"
          >
            <Target className="w-4 h-4" />
            <span>
              {isSimulating
                ? 'Simulating Shot...'
                : turn === 'opponent' && gameMode === 'ai' && !currentRoom
                ? 'AI Taking Shot...'
                : currentRoom && !hasFriendJoined
                ? 'Waiting for Friend to Join...'
                : currentRoom && !isAuthorizedMultiplayerActor
                ? `Waiting for ${
                    (turn === 'player'
                      ? currentRoom.players[0]?.name
                      : currentRoom.players[1]?.name) || 'Opponent'
                  }'s turn...`
                : 'Strike Striker'}
            </span>
          </button>
          <button
            type="button"
            disabled={Boolean(currentRoom && isWaitingSpectator)}
            onClick={() => resetCarrom(true)}
            className="px-4 py-2.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-45 text-slate-800 dark:text-slate-100 rounded-xl text-xs font-bold flex items-center gap-1.5 min-h-[44px]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      <div className="w-full mt-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-xs space-y-1">
        {statusLog.map((log, i) => (
          <p key={i} className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {log}
          </p>
        ))}
      </div>
    </div>
  );
};
