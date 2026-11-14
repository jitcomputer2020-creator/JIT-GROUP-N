/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Interactive 2D Physics Carrom Board
 * Real striker placement, aim direction, elastic coin collisions, corner pocketing,
 * Red Queen bonus, and AI/multiplayer turn management.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GameMode, AIDifficulty } from '../../types/multiplayer';
import { soundFx } from '../../utils/soundFx';
import { Target, RotateCcw, Sparkles } from 'lucide-react';

interface Coin {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  type: 'white' | 'black' | 'queen' | 'striker';
  pocketed: boolean;
}

interface CarromBoardProps {
  gameMode: GameMode;
  aiDifficulty: AIDifficulty;
  onMatchFinish: (outcome: 'win' | 'loss' | 'draw', summary: string, points: number) => void;
}

const SIZE = 320;
const POCKETS = [
  { x: 22, y: 22 },
  { x: SIZE - 22, y: 22 },
  { x: 22, y: SIZE - 22 },
  { x: SIZE - 22, y: SIZE - 22 },
];
const POCKET_RADIUS = 15;
const BASELINE_Y_PLAYER = SIZE - 52;
const BASELINE_Y_AI = 52;

function createInitialCoins(): Coin[] {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const coins: Coin[] = [
    { id: 'queen', x: cx, y: cy, vx: 0, vy: 0, r: 9, type: 'queen', pocketed: false },
  ];
  const ringOffsets = [
    { dx: 0, dy: -21, t: 'white' as const },
    { dx: 18, dy: -10, t: 'black' as const },
    { dx: 18, dy: 10, t: 'white' as const },
    { dx: 0, dy: 21, t: 'black' as const },
    { dx: -18, dy: 10, t: 'white' as const },
    { dx: -18, dy: -10, t: 'black' as const },
    { dx: -36, dy: 0, t: 'white' as const },
    { dx: 36, dy: 0, t: 'black' as const },
  ];
  ringOffsets.forEach((o, i) => {
    coins.push({
      id: `c_${i}`,
      x: cx + o.dx,
      y: cy + o.dy,
      vx: 0,
      vy: 0,
      r: 9,
      type: o.t,
      pocketed: false,
    });
  });
  return coins;
}

export const CarromBoard: React.FC<CarromBoardProps> = ({
  gameMode,
  aiDifficulty,
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
    r: 12,
    type: 'striker',
    pocketed: false,
  });
  const animRef = useRef<number | null>(null);
  const finishedRef = useRef(false);

  const [strikerX, setStrikerX] = useState(SIZE / 2);
  const [aimAngle, setAimAngle] = useState(0); // -65 to +65 deg from straight forward
  const [power, setPower] = useState(72);
  const [turn, setTurn] = useState<'player' | 'opponent'>('player');
  const [isSimulating, setIsSimulating] = useState(false);
  const [scores, setScores] = useState({ player: 0, opponent: 0, queenHolder: '' as string });
  const [statusLog, setStatusLog] = useState<string[]>([
    'Position striker, set angle & power, or tap the board to aim!',
  ]);
  const [winnerMsg, setWinnerMsg] = useState<string | null>(null);

  const drawBoard = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Outer wooden frame
    ctx.fillStyle = '#78350F';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Inner birch playing surface
    ctx.fillStyle = '#FEF3C7';
    ctx.beginPath();
    ctx.roundRect(10, 10, SIZE - 20, SIZE - 20, 16);
    ctx.fill();

    // Decorative center circles
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, 44, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, 13, 0, Math.PI * 2);
    ctx.stroke();

    // Baselines
    ctx.strokeStyle = 'rgba(120, 53, 15, 0.45)';
    ctx.lineWidth = 2;
    [BASELINE_Y_PLAYER, BASELINE_Y_AI].forEach((by) => {
      ctx.beginPath();
      ctx.moveTo(64, by);
      ctx.lineTo(SIZE - 64, by);
      ctx.stroke();
      ctx.fillStyle = '#DC2626';
      ctx.beginPath();
      ctx.arc(64, by, 5, 0, Math.PI * 2);
      ctx.arc(SIZE - 64, by, 5, 0, Math.PI * 2);
      ctx.fill();
    });

    // 4 Corner Pockets
    POCKETS.forEach((p) => {
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.arc(p.x, p.y, POCKET_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Coins
    coinsRef.current.forEach((c) => {
      if (c.pocketed) return;
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
        ctx.strokeStyle = '#475569';
      }
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Striker
    const st = strikerRef.current;
    if (!st.pocketed) {
      // Aim guide line when ready to strike
      if (!isSimulating && !finishedRef.current) {
        const dirRad = ((turn === 'player' ? -90 : 90) + aimAngle) * (Math.PI / 180);
        const guideLen = 35 + power * 0.7;
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(st.x, st.y);
        ctx.lineTo(st.x + Math.cos(dirRad) * guideLen, st.y + Math.sin(dirRad) * guideLen);
        ctx.stroke();
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fillStyle = '#2563EB';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = '#93C5FD';
      ctx.beginPath();
      ctx.arc(st.x, st.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [aimAngle, power, isSimulating, turn]);

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
    };
  }, []);

  const executeStrike = useCallback(
    (strikeX: number, strikeAngleDeg: number, strikePower: number, activeSide: 'player' | 'opponent') => {
      if (isSimulating || finishedRef.current) return;
      setIsSimulating(true);
      soundFx.playMove();

      const st = strikerRef.current;
      st.x = strikeX;
      st.y = activeSide === 'player' ? BASELINE_Y_PLAYER : BASELINE_Y_AI;
      st.pocketed = false;

      const rad = ((activeSide === 'player' ? -90 : 90) + strikeAngleDeg) * (Math.PI / 180);
      const speed = 4 + (strikePower / 100) * 11;
      st.vx = Math.cos(rad) * speed;
      st.vy = Math.sin(rad) * speed;

      const pocketedThisTurn: Coin['type'][] = [];

      const step = () => {
        const allBodies = [st, ...coinsRef.current.filter((c) => !c.pocketed)];

        // Integrate & wall bounce
        for (const b of allBodies) {
          b.x += b.vx;
          b.y += b.vy;
          b.vx *= 0.972;
          b.vy *= 0.972;
          if (Math.hypot(b.vx, b.vy) < 0.08) {
            b.vx = 0;
            b.vy = 0;
          }

          const minB = 12 + b.r;
          const maxB = SIZE - 12 - b.r;
          if (b.x < minB) {
            b.x = minB;
            b.vx = Math.abs(b.vx) * 0.82;
          } else if (b.x > maxB) {
            b.x = maxB;
            b.vx = -Math.abs(b.vx) * 0.82;
          }
          if (b.y < minB) {
            b.y = minB;
            b.vy = Math.abs(b.vy) * 0.82;
          } else if (b.y > maxB) {
            b.y = maxB;
            b.vy = -Math.abs(b.vy) * 0.82;
          }
        }

        // Elastic pairwise collisions
        for (let i = 0; i < allBodies.length; i++) {
          for (let j = i + 1; j < allBodies.length; j++) {
            const a = allBodies[i];
            const b = allBodies[j];
            if (a.pocketed || b.pocketed) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            const minDist = a.r + b.r;
            if (dist > 0 && dist < minDist) {
              const nx = dx / dist;
              const ny = dy / dist;
              const overlap = (minDist - dist) / 2;
              a.x -= nx * overlap;
              a.y -= ny * overlap;
              b.x += nx * overlap;
              b.y += ny * overlap;

              const dvx = a.vx - b.vx;
              const dvy = a.vy - b.vy;
              const dot = dvx * nx + dvy * ny;
              if (dot > 0) {
                const impulse = dot * 0.92;
                a.vx -= impulse * nx;
                a.vy -= impulse * ny;
                b.vx += impulse * nx;
                b.vy += impulse * ny;
              }
            }
          }
        }

        // Check pocketing
        for (const b of allBodies) {
          if (b.pocketed) continue;
          for (const p of POCKETS) {
            if (Math.hypot(b.x - p.x, b.y - p.y) < POCKET_RADIUS + 2) {
              b.pocketed = true;
              b.vx = 0;
              b.vy = 0;
              pocketedThisTurn.push(b.type);
              soundFx.playCapture();
              break;
            }
          }
        }

        drawBoard();

        const stillMoving = allBodies.some((b) => !b.pocketed && Math.hypot(b.vx, b.vy) > 0.08);
        if (stillMoving) {
          animRef.current = requestAnimationFrame(step);
          return;
        }

        // Settle turn & score
        setIsSimulating(false);
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
            queenMsg = activeSide === 'player' ? 'You' : 'Opponent';
            scoredOwnCoin = true;
          } else if (t === 'white') {
            playerGain += 10;
            if (activeSide === 'player') scoredOwnCoin = true;
          } else if (t === 'black') {
            oppGain += 10;
            if (activeSide === 'opponent') scoredOwnCoin = true;
          }
        });

        setScores((prev) => {
          const nextScores = {
            player: Math.max(0, prev.player + playerGain - (foul && activeSide === 'player' ? 5 : 0)),
            opponent: Math.max(0, prev.opponent + oppGain - (foul && activeSide === 'opponent' ? 5 : 0)),
            queenHolder: queenMsg || prev.queenHolder,
          };

          const remainingCoins = coinsRef.current.filter((c) => !c.pocketed);
          const whitesLeft = remainingCoins.filter((c) => c.type === 'white').length;
          const blacksLeft = remainingCoins.filter((c) => c.type === 'black').length;

          if ((whitesLeft === 0 || blacksLeft === 0 || remainingCoins.length === 0) && !finishedRef.current) {
            finishedRef.current = true;
            const playerWon = nextScores.player >= nextScores.opponent;
            const summary = playerWon
              ? `Victory ${nextScores.player}-${nextScores.opponent}`
              : `Match ${nextScores.player}-${nextScores.opponent}`;
            setWinnerMsg(
              playerWon
                ? `You won Carrom (${nextScores.player} vs ${nextScores.opponent})! +45 JIT Points`
                : `Opponent won (${nextScores.opponent} vs ${nextScores.player}). +10 Participation Points`
            );
            soundFx.playWin();
            onMatchFinish(playerWon ? 'win' : 'loss', summary, playerWon ? 45 : 10);
          }
          return nextScores;
        });

        const turnLabel = activeSide === 'player' ? 'You' : gameMode === 'ai' ? 'AI Bot' : 'Opponent';
        const logMsg = foul
          ? `${turnLabel} pocketed Striker (-5 foul)! Turn passes.`
          : pocketedThisTurn.length > 0
          ? `${turnLabel} pocketed ${pocketedThisTurn.join(', ')}!`
          : `${turnLabel} missed pockets.`;
        setStatusLog((prev) => [logMsg, ...prev.slice(0, 3)]);

        const nextSide: 'player' | 'opponent' = scoredOwnCoin && !foul ? activeSide : activeSide === 'player' ? 'opponent' : 'player';
        setTurn(nextSide);

        // Trigger AI turn if needed
        if (!finishedRef.current && gameMode === 'ai' && nextSide === 'opponent') {
          setTimeout(() => {
            if (finishedRef.current) return;
            const targets = coinsRef.current.filter((c) => !c.pocketed && (c.type === 'black' || c.type === 'queen'));
            const chosen = targets[0] || coinsRef.current.find((c) => !c.pocketed);
            const sx = 95 + Math.random() * (SIZE - 190);
            let angleDeg = 0;
            if (chosen) {
              const rawRad = Math.atan2(chosen.y - BASELINE_Y_AI, chosen.x - sx);
              const rawDeg = (rawRad * 180) / Math.PI - 90;
              const jitter = aiDifficulty === 'hard' ? 3 : aiDifficulty === 'medium' ? 10 : 22;
              angleDeg = Math.max(-65, Math.min(65, rawDeg + (Math.random() - 0.5) * jitter));
            }
            const aiPow = aiDifficulty === 'hard' ? 84 : aiDifficulty === 'medium' ? 74 : 62;
            executeStrike(sx, angleDeg, aiPow, 'opponent');
          }, 750);
        }
      };

      animRef.current = requestAnimationFrame(step);
    },
    [aiDifficulty, drawBoard, gameMode, isSimulating, onMatchFinish]
  );

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isSimulating || finishedRef.current || (gameMode === 'ai' && turn === 'opponent')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * SIZE;
    const clickY = ((e.clientY - rect.top) / rect.height) * SIZE;
    const sy = turn === 'player' ? BASELINE_Y_PLAYER : BASELINE_Y_AI;
    const dx = clickX - strikerX;
    const dy = clickY - sy;
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI - (turn === 'player' ? -90 : 90);
    const clamped = Math.max(-65, Math.min(65, Math.round(deg)));
    setAimAngle(clamped);
  };

  const resetCarrom = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    finishedRef.current = false;
    coinsRef.current = createInitialCoins();
    strikerRef.current = {
      id: 'striker',
      x: SIZE / 2,
      y: BASELINE_Y_PLAYER,
      vx: 0,
      vy: 0,
      r: 12,
      type: 'striker',
      pocketed: false,
    };
    setStrikerX(SIZE / 2);
    setAimAngle(0);
    setPower(72);
    setTurn('player');
    setIsSimulating(false);
    setScores({ player: 0, opponent: 0, queenHolder: '' });
    setWinnerMsg(null);
    setStatusLog(['Board reset! Tap board to aim or use sliders below.']);
  };

  const isPlayerBlocked = isSimulating || finishedRef.current || (gameMode === 'ai' && turn === 'opponent');

  return (
    <div className="max-w-md mx-auto flex flex-col items-center">
      <div className="flex items-center justify-between w-full mb-3 text-xs font-bold px-2">
        <span className={turn === 'player' ? 'text-blue-600' : 'text-slate-500'}>
          You (White): {scores.player} pts
        </span>
        <span className="text-[11px] text-amber-600 font-semibold">
          {scores.queenHolder ? `Queen: ${scores.queenHolder}` : 'Queen: +30'}
        </span>
        <span className={turn === 'opponent' ? 'text-purple-600' : 'text-slate-500'}>
          {gameMode === 'ai' ? 'AI (Black)' : 'P2 (Black)'}: {scores.opponent} pts
        </span>
      </div>

      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        onClick={handleCanvasClick}
        className="w-full max-w-[min(320px,100%)] aspect-square rounded-3xl shadow-2xl cursor-crosshair touch-manipulation select-none border border-amber-900/40"
      />

      {winnerMsg && (
        <div className="mt-3 w-full p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
          <span>{winnerMsg}</span>
        </div>
      )}

      <div className="w-full mt-4 space-y-3 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/60">
        <div>
          <div className="flex justify-between text-[11px] font-semibold mb-1">
            <span>Striker Position</span>
            <span className="font-mono">{Math.round(strikerX)}px</span>
          </div>
          <input
            type="range"
            min="70"
            max={SIZE - 70}
            value={strikerX}
            disabled={isPlayerBlocked}
            onChange={(e) => setStrikerX(Number(e.target.value))}
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
              min="-65"
              max="65"
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
              min="25"
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
            <span>{isSimulating ? 'Simulating Shot...' : turn === 'opponent' && gameMode === 'ai' ? 'AI Taking Shot...' : 'Strike Striker'}</span>
          </button>
          <button
            type="button"
            onClick={resetCarrom}
            className="px-4 py-2.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 rounded-xl text-xs font-bold flex items-center gap-1.5 min-h-[44px]"
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
