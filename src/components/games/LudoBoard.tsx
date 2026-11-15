/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Interactive 15x15 Classic 4-Player Ludo Board
 * Features 4 colored bases (Red, Green, Yellow, Blue) with 4 token yard slots each,
 * Safe Star squares, colored home lanes, SVG 4-triangle center home goal,
 * and responsive scaling across mobile and desktop viewports.
 */

import React from 'react';
import {
  ludoLocalToGlobal,
  LUDO_SAFE_GLOBAL_INDICES,
} from '../../services/gameAIEngine';

export interface LudoColorConfig {
  name: string;
  bg: string;
  ring: string;
  text: string;
  hex: string;
}

export const LUDO_COLORS: LudoColorConfig[] = [
  { name: 'Red', bg: 'bg-red-500', ring: 'ring-red-300', text: 'text-red-600 dark:text-red-400', hex: '#EF4444' },
  { name: 'Green', bg: 'bg-emerald-500', ring: 'ring-emerald-300', text: 'text-emerald-600 dark:text-emerald-400', hex: '#10B981' },
  { name: 'Yellow', bg: 'bg-amber-400', ring: 'ring-amber-200', text: 'text-amber-600 dark:text-amber-400', hex: '#F59E0B' },
  { name: 'Blue', bg: 'bg-blue-600', ring: 'ring-blue-300', text: 'text-blue-600 dark:text-blue-400', hex: '#2563EB' },
];

// Standard 52-cell clockwise perimeter track starting at Red's exit [13, 6]
export const LUDO_MAIN_TRACK: [number, number][] = [
  // Red starts moving UP left column of bottom arm
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  // Left arm bottom row going left
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  // Left tip middle
  [7, 0],
  // Left arm top row going right ([6, 1] is Green's start idx 13)
  [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  // Top arm left column going up
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  // Top tip middle
  [0, 7],
  // Top arm right column going down ([1, 8] is Yellow's start idx 26)
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  // Right arm top row going right
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  // Right tip middle
  [7, 14],
  // Right arm bottom row going left ([8, 13] is Blue's start idx 39)
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  // Bottom arm right column going down
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  // Bottom tip middle
  [14, 7],
  // Last square before Red home stretch
  [14, 6],
];

// Private 5-square home stretch lanes (progress 51..55 -> indices 0..4)
export const LUDO_HOME_LANES: [number, number][][] = [
  // Red (bottom arm col 7, rows 13..9)
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  // Green (left arm row 7, cols 1..5)
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  // Yellow (top arm col 7, rows 1..5)
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  // Blue (right arm row 7, cols 13..9)
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
];

// 4 Yard token pockets per corner base
const YARD_SLOTS: [number, number][][] = [
  // Red (bottom-left base: rows 9..14, cols 0..5)
  [[10, 1], [10, 4], [13, 1], [13, 4]],
  // Green (top-left base: rows 0..5, cols 0..5)
  [[1, 1], [1, 4], [4, 1], [4, 4]],
  // Yellow (top-right base: rows 0..5, cols 9..14)
  [[1, 10], [1, 13], [4, 10], [4, 13]],
  // Blue (bottom-right base: rows 9..14, cols 9..14)
  [[10, 10], [10, 13], [13, 10], [13, 13]],
];

const HOME_GOAL_SLOTS: [number, number][] = [
  [8, 7], // Red (bottom triangle)
  [7, 6], // Green (left triangle)
  [6, 7], // Yellow (top triangle)
  [7, 8], // Blue (right triangle)
];

function findYardPocketPlayer(r: number, c: number): number | null {
  for (let pIdx = 0; pIdx < YARD_SLOTS.length; pIdx++) {
    if (YARD_SLOTS[pIdx].some(([yr, yc]) => yr === r && yc === c)) {
      return pIdx;
    }
  }
  return null;
}

export function getTokenBoardCoords(playerIdx: number, tokenIdx: number, progress: number): [number, number] {
  const safeSlotIdx = tokenIdx % 4;
  if (progress === -1) {
    return YARD_SLOTS[playerIdx][safeSlotIdx];
  }
  if (progress >= 56) {
    return HOME_GOAL_SLOTS[playerIdx];
  }
  if (progress >= 51) {
    return LUDO_HOME_LANES[playerIdx][progress - 51];
  }
  const globalIdx = ludoLocalToGlobal(playerIdx, progress);
  if (globalIdx !== null && LUDO_MAIN_TRACK[globalIdx]) {
    return LUDO_MAIN_TRACK[globalIdx];
  }
  return YARD_SLOTS[playerIdx][safeSlotIdx];
}

interface LudoBoardProps {
  tokens: number[][]; // 4 players x 4 tokens
  currentTurn: 0 | 1 | 2 | 3;
  legalTokenIndices: number[];
  awaitingTokenChoice: boolean;
  inactiveSeats?: number[];
  onSelectToken: (tokenIdx: number) => void;
}

export const LudoBoard: React.FC<LudoBoardProps> = ({
  tokens,
  currentTurn,
  legalTokenIndices,
  awaitingTokenChoice,
  inactiveSeats = [],
  onSelectToken,
}) => {
  const inactiveSet = new Set(inactiveSeats);

  // Pre-build token lookup per grid cell for fast rendering
  const cellTokens = new Map<string, { playerIdx: number; tokenIdx: number; progress: number }[]>();
  tokens.forEach((playerTokens, pIdx) => {
    if (inactiveSet.has(pIdx)) return;
    playerTokens.forEach((prog, tIdx) => {
      const [r, c] = getTokenBoardCoords(pIdx, tIdx, prog);
      const key = `${r}-${c}`;
      const existing = cellTokens.get(key) || [];
      existing.push({ playerIdx: pIdx, tokenIdx: tIdx, progress: prog });
      cellTokens.set(key, existing);
    });
  });

  const getCellStyle = (r: number, c: number): { bg: string; label?: string; pocketColor?: string } => {
    const pocketPlayer = findYardPocketPlayer(r, c);

    // Top-Left Base: Green (0..5, 0..5)
    if (r < 6 && c < 6) {
      const isInner = r >= 1 && r <= 4 && c >= 1 && c <= 4;
      const faded = inactiveSet.has(1) ? 'opacity-50' : '';
      if (isInner) {
        return {
          bg: `bg-white dark:bg-slate-900 ${faded}`,
          pocketColor: pocketPlayer === 1 ? 'ring-2 ring-emerald-500 bg-emerald-50 dark:bg-emerald-950/50' : undefined,
        };
      }
      return { bg: `bg-emerald-500 ${faded}` };
    }

    // Top-Right Base: Yellow (0..5, 9..14)
    if (r < 6 && c > 8) {
      const isInner = r >= 1 && r <= 4 && c >= 10 && c <= 13;
      const faded = inactiveSet.has(2) ? 'opacity-50' : '';
      if (isInner) {
        return {
          bg: `bg-white dark:bg-slate-900 ${faded}`,
          pocketColor: pocketPlayer === 2 ? 'ring-2 ring-amber-400 bg-amber-50 dark:bg-amber-950/50' : undefined,
        };
      }
      return { bg: `bg-amber-400 ${faded}` };
    }

    // Bottom-Left Base: Red (9..14, 0..5)
    if (r > 8 && c < 6) {
      const isInner = r >= 10 && r <= 13 && c >= 1 && c <= 4;
      const faded = inactiveSet.has(0) ? 'opacity-50' : '';
      if (isInner) {
        return {
          bg: `bg-white dark:bg-slate-900 ${faded}`,
          pocketColor: pocketPlayer === 0 ? 'ring-2 ring-red-500 bg-red-50 dark:bg-red-950/50' : undefined,
        };
      }
      return { bg: `bg-red-500 ${faded}` };
    }

    // Bottom-Right Base: Blue (9..14, 9..14)
    if (r > 8 && c > 8) {
      const isInner = r >= 10 && r <= 13 && c >= 10 && c <= 13;
      const faded = inactiveSet.has(3) ? 'opacity-50' : '';
      if (isInner) {
        return {
          bg: `bg-white dark:bg-slate-900 ${faded}`,
          pocketColor: pocketPlayer === 3 ? 'ring-2 ring-blue-600 bg-blue-50 dark:bg-blue-950/50' : undefined,
        };
      }
      return { bg: `bg-blue-600 ${faded}` };
    }

    // Center 3x3 Home Goal (SVG pinwheel renders behind tokens on z-10)
    if (r >= 6 && r <= 8 && c >= 6 && c <= 8) {
      return { bg: 'bg-transparent' };
    }

    // Home stretch colored lanes
    if (c === 7 && r >= 9 && r <= 13) return { bg: 'bg-red-200 dark:bg-red-900/60' };
    if (r === 7 && c >= 1 && c <= 5) return { bg: 'bg-emerald-200 dark:bg-emerald-900/60' };
    if (c === 7 && r >= 1 && r <= 5) return { bg: 'bg-amber-200 dark:bg-amber-900/60' };
    if (r === 7 && c >= 9 && c <= 13) return { bg: 'bg-blue-200 dark:bg-blue-900/60' };

    // Start squares
    if (r === 13 && c === 6) return { bg: 'bg-red-500 text-white', label: '★' };
    if (r === 6 && c === 1) return { bg: 'bg-emerald-500 text-white', label: '★' };
    if (r === 1 && c === 8) return { bg: 'bg-amber-400 text-slate-900', label: '★' };
    if (r === 8 && c === 13) return { bg: 'bg-blue-600 text-white', label: '★' };

    // Other Safe Star squares
    const trackIdx = LUDO_MAIN_TRACK.findIndex(([tr, tc]) => tr === r && tc === c);
    if (trackIdx !== -1 && LUDO_SAFE_GLOBAL_INDICES.has(trackIdx)) {
      return { bg: 'bg-amber-50 dark:bg-slate-700 text-amber-500', label: '★' };
    }

    return { bg: 'bg-white dark:bg-slate-900' };
  };

  return (
    <div className="w-full max-w-[min(420px,calc(100vw-2.25rem),54dvh)] aspect-square bg-slate-200 dark:bg-slate-800 p-1.5 rounded-2xl border-2 border-slate-300 dark:border-slate-700 shadow-lg select-none touch-manipulation">
      <div
        className="relative grid w-full h-full bg-slate-300 dark:bg-slate-700 rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700"
        style={{
          gridTemplateColumns: 'repeat(15, minmax(0, 1fr))',
          gridTemplateRows: 'repeat(15, minmax(0, 1fr))',
        }}
      >
        {/* Classic 4-Color Home Goal Triangles Overlay for Center 3x3 (cols 6..8, rows 6..8) */}
        <svg
          viewBox="0 0 100 100"
          className="absolute pointer-events-none z-10"
          style={{ left: '40%', top: '40%', width: '20%', height: '20%' }}
          aria-hidden="true"
        >
          {/* Top = Yellow */}
          <polygon points="0,0 100,0 50,50" fill="#F59E0B" />
          {/* Left = Green */}
          <polygon points="0,0 50,50 0,100" fill="#10B981" />
          {/* Right = Blue */}
          <polygon points="100,0 100,100 50,50" fill="#2563EB" />
          {/* Bottom = Red */}
          <polygon points="0,100 50,50 100,100" fill="#EF4444" />
          {/* Crisp borders */}
          <line x1="0" y1="0" x2="100" y2="100" stroke="#FFFFFF" strokeWidth="2" />
          <line x1="100" y1="0" x2="0" y2="100" stroke="#FFFFFF" strokeWidth="2" />
          <rect x="1" y="1" width="98" height="98" fill="none" stroke="#FFFFFF" strokeWidth="2" />
          <circle cx="50" cy="50" r="14" fill="#0F172A" stroke="#FFFFFF" strokeWidth="2" />
          <text
            x="50"
            y="55"
            textAnchor="middle"
            fill="#FBBF24"
            fontSize="14"
            fontWeight="bold"
          >
            ★
          </text>
        </svg>

        {Array.from({ length: 225 }).map((_, i) => {
          const r = Math.floor(i / 15);
          const c = i % 15;
          const style = getCellStyle(r, c);
          const here = cellTokens.get(`${r}-${c}`) || [];
          const isTrackCell = !(
            (r < 6 && c < 6) ||
            (r < 6 && c > 8) ||
            (r > 8 && c < 6) ||
            (r > 8 && c > 8) ||
            (r >= 6 && r <= 8 && c >= 6 && c <= 8)
          );

          return (
            <div
              key={`${r}-${c}`}
              className={`relative flex items-center justify-center text-[9px] font-bold ${
                isTrackCell ? 'border-[0.5px] border-slate-300/80 dark:border-slate-700/80' : ''
              } ${style.bg}`}
            >
              {/* Circular pocket well inside white inner yards */}
              {style.pocketColor && (
                <div className={`w-[78%] h-[78%] rounded-full ${style.pocketColor} pointer-events-none`} />
              )}

              {here.length === 0 && style.label && (
                <span className="leading-none opacity-90 text-[10px] sm:text-xs">{style.label}</span>
              )}

              {here.length > 0 && (
                <div className="absolute inset-0 flex flex-wrap items-center justify-center gap-[1px] p-[1px] z-20">
                  {here.map((tok) => {
                    const color = LUDO_COLORS[tok.playerIdx];
                    const isSelectable =
                      awaitingTokenChoice &&
                      tok.playerIdx === currentTurn &&
                      legalTokenIndices.includes(tok.tokenIdx);

                    return (
                      <button
                        key={`${tok.playerIdx}-${tok.tokenIdx}`}
                        type="button"
                        disabled={!isSelectable}
                        onClick={() => isSelectable && onSelectToken(tok.tokenIdx)}
                        title={`${color.name} Token ${tok.tokenIdx + 1}`}
                        className={`${
                          here.length >= 3
                            ? 'w-[42%] h-[42%] text-[6px]'
                            : here.length === 2
                            ? 'w-[46%] h-[46%] text-[7px]'
                            : 'w-[78%] h-[78%] text-[8px] sm:text-[9px]'
                        } rounded-full ${color.bg} border-2 border-white shadow-md flex items-center justify-center text-white font-black transition-transform ${
                          isSelectable
                            ? 'ring-2 ring-slate-900 dark:ring-white scale-125 animate-bounce cursor-pointer z-30'
                            : 'cursor-default'
                        }`}
                      >
                        {tok.tokenIdx + 1}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
