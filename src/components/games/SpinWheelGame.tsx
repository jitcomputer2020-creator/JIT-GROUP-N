/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Daily Lucky Spin Wheel Mini-Game
 * Awards real JIT Points directly to the user's Firebase profile & leaderboard.
 */

import React, { useState } from 'react';
import { Sparkles, RotateCw, Trophy } from 'lucide-react';
import { soundFx } from '../../utils/soundFx';

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
  onSpinReward: (points: number, label: string) => Promise<void>;
}

export const SpinWheelGame: React.FC<SpinWheelGameProps> = ({
  userId,
  currentPoints,
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

  const spinsRemaining = Math.max(0, MAX_DAILY_SPINS - spinsUsed);

  const handleSpin = () => {
    if (isSpinning || spinsRemaining <= 0) return;

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

    // Synthesized tick sounds during spin deceleration
    const tickDelays = [120, 260, 420, 620, 860, 1150, 1500, 1920, 2400, 2900];
    tickDelays.forEach((d) => {
      setTimeout(() => soundFx.playTick(), d);
    });

    setTimeout(async () => {
      const nextUsed = spinsUsed + 1;
      setSpinsUsed(nextUsed);
      if (typeof window !== 'undefined') {
        localStorage.setItem(storageKey, String(nextUsed));
      }
      setIsSpinning(false);
      setLastPrize(chosen);
      soundFx.playWin();
      await onSpinReward(chosen.points, chosen.label);
    }, 3600);
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

  return (
    <div className="max-w-md mx-auto flex flex-col items-center space-y-5">
      <div className="w-full flex items-center justify-between px-2 text-xs font-bold">
        <span className="text-slate-600 dark:text-slate-300">
          Daily Spins Left: <span className="font-mono text-rose-600 dark:text-rose-400">{spinsRemaining}/{MAX_DAILY_SPINS}</span>
        </span>
        <span className="font-mono text-amber-600 dark:text-amber-400 tabular-nums">
          Balance: {currentPoints} Pts
        </span>
      </div>

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
        disabled={isSpinning || spinsRemaining <= 0}
        onClick={handleSpin}
        className="w-full max-w-xs py-3.5 px-6 bg-gradient-to-r from-rose-600 to-amber-500 hover:from-rose-700 hover:to-amber-600 disabled:opacity-45 text-white font-black text-sm rounded-2xl shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 min-h-[48px]"
      >
        <RotateCw className={`w-4 h-4 ${isSpinning ? 'animate-spin' : ''}`} />
        <span>
          {isSpinning
            ? 'Spinning Wheel...'
            : spinsRemaining > 0
            ? 'Spin & Win JIT Points'
            : 'Daily Spins Completed — Come Back Tomorrow!'}
        </span>
      </button>

      {lastPrize && (
        <div className="w-full p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center gap-3 text-xs text-emerald-800 dark:text-emerald-200">
          <Trophy className="w-5 h-5 text-amber-500 shrink-0" />
          <div>
            <p className="font-bold flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Won {lastPrize.label}!</span>
            </p>
            <p className="text-[11px] opacity-85">
              {lastPrize.points} virtual JIT Points added directly to your Firebase profile.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
