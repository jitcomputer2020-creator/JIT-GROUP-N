/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Interactive 15x15 Classic Ludo Board
 * Real Yard unlock on 6, safe stars, opponent capture, home stretch, and win detection.
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
  // Red starts moving UP left column of bottom arm (6 steps: 13..8, col 6) -> wait: 5 steps from [13,6]..[9,6] then left arm
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  // Left arm bottom row going left (cols 5..0, row 8)
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  // Left tip middle
  [7, 0],
  // Left arm top row going right (cols 0..5, row 6) — [6, 1] is Green's start (idx 13)
  [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  // Top arm left column going up (rows 5..0, col 6)
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  // Top tip middle
  [0, 7],
  // Top arm right column going down (rows 0..5, col 8) — [1, 8] is Yellow's start (idx 26)
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  // Right arm top row going right (cols 9..14, row 6)
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  // Right tip middle
  [7, 14],
  // Right arm bottom row going left (cols 14..9, row 8) — [8, 13] is Blue's start (idx 39)
  [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  // Bottom arm right column going down (rows 9..14, col 8)
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

const YARD_SLOTS: [number, number][][] = [
  // Red (bottom-left yard)
  [[11, 2], [11, 3]],
  // Green (top-left yard)
  [[2, 2], [2, 3]],
  // Yellow (top-right yard)
  [[2, 11], [2, 12]],
  // Blue (bottom-right yard)
  [[11, 11], [11, 12]],
];

const HOME_GOAL_SLOTS: [number, number][] = [
  [8, 7], // Red
  [7, 6], // Green
  [6, 7], // Yellow
  [7, 8], // Blue
];

export function getTokenBoardCoords(playerIdx: number, tokenIdx: number, progress: number): [number, number] {
  if (progress === -1) {
    return YARD_SLOTS[playerIdx][tokenIdx % 2];
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
  return YARD_SLOTS[playerIdx][tokenIdx % 2];
}

interface LudoBoardProps {
  tokens: number[][]; // 4 players x 2 tokens
  currentTurn: 0 | 1 | 2 | 3;
  legalTokenIndices: number[];
  awaitingTokenChoice: boolean;
  onSelectToken: (tokenIdx: number) => void;
}

export const LudoBoard: React.FC<LudoBoardProps> = ({
  tokens,
  currentTurn,
  legalTokenIndices,
  awaitingTokenChoice,
  onSelectToken,
}) => {
  // Pre-build token lookup per grid cell for fast rendering
  const cellTokens = new Map<string, { playerIdx: number; tokenIdx: number; progress: number }[]>();
  tokens.forEach((playerTokens, pIdx) => {
    playerTokens.forEach((prog, tIdx) => {
      const [r, c] = getTokenBoardCoords(pIdx, tIdx, prog);
      const key = `${r}-${c}`;
      const existing = cellTokens.get(key) || [];
      existing.push({ playerIdx: pIdx, tokenIdx: tIdx, progress: prog });
      cellTokens.set(key, existing);
    });
  });

  // Lookup special cells
  const getCellStyle = (r: number, c: number): { bg: string; label?: string } => {
    // 4 Corner Home Yards
    if (r < 6 && c < 6) return { bg: 'bg-emerald-500/90 border-emerald-600/30' };
    if (r < 6 && c > 8) return { bg: 'bg-amber-400/95 border-amber-500/30' };
    if (r > 8 && c < 6) return { bg: 'bg-red-500/90 border-red-600/30' };
    if (r > 8 && c > 8) return { bg: 'bg-blue-600/90 border-blue-700/30' };

    // Center 3x3 Home Goal
    if (r >= 6 && r <= 8 && c >= 6 && c <= 8) {
      if (r === 7 && c === 7) return { bg: 'bg-slate-900 text-amber-300', label: '★' };
      if (r === 8 && c === 7) return { bg: 'bg-red-500 text-white' };
      if (r === 7 && c === 6) return { bg: 'bg-emerald-500 text-white' };
      if (r === 6 && c === 7) return { bg: 'bg-amber-400 text-slate-900' };
      if (r === 7 && c === 8) return { bg: 'bg-blue-600 text-white' };
      return { bg: 'bg-slate-200 dark:bg-slate-700' };
    }

    // Home stretch colored lanes
    if (c === 7 && r >= 9 && r <= 13) return { bg: 'bg-red-200 dark:bg-red-900/50' };
    if (r === 7 && c >= 1 && c <= 5) return { bg: 'bg-emerald-200 dark:bg-emerald-900/50' };
    if (c === 7 && r >= 1 && r <= 5) return { bg: 'bg-amber-200 dark:bg-amber-900/50' };
    if (r === 7 && c >= 9 && c <= 13) return { bg: 'bg-blue-200 dark:bg-blue-900/50' };

    // Start squares
    if (r === 13 && c === 6) return { bg: 'bg-red-500 text-white', label: '★' };
    if (r === 6 && c === 1) return { bg: 'bg-emerald-500 text-white', label: '★' };
    if (r === 1 && c === 8) return { bg: 'bg-amber-400 text-slate-900', label: '★' };
    if (r === 8 && c === 13) return { bg: 'bg-blue-600 text-white', label: '★' };

    // Other Safe Star squares
    const trackIdx = LUDO_MAIN_TRACK.findIndex(([tr, tc]) => tr === r && tc === c);
    if (trackIdx !== -1 && LUDO_SAFE_GLOBAL_INDICES.has(trackIdx)) {
      return { bg: 'bg-slate-200 dark:bg-slate-700 text-amber-500', label: '★' };
    }

    return { bg: 'bg-white dark:bg-slate-900' };
  };

  return (
    <div className="w-full max-w-[min(360px,100%)] aspect-square bg-slate-200 dark:bg-slate-800 p-1.5 rounded-2xl border-2 border-slate-300 dark:border-slate-700 shadow-inner select-none touch-manipulation">
      <div className="grid grid-cols-15 grid-rows-15 w-full h-full gap-[1px] bg-slate-300 dark:bg-slate-700 rounded-xl overflow-hidden" style={{ gridTemplateColumns: 'repeat(15, minmax(0, 1fr))', gridTemplateRows: 'repeat(15, minmax(0, 1fr))' }}>
        {Array.from({ length: 225 }).map((_, i) => {
          const r = Math.floor(i / 15);
          const c = i % 15;
          const style = getCellStyle(r, c);
          const here = cellTokens.get(`${r}-${c}`) || [];

          return (
            <div
              key={`${r}-${c}`}
              className={`relative flex items-center justify-center text-[9px] font-bold ${style.bg}`}
            >
              {here.length === 0 && style.label && (
                <span className="leading-none opacity-85">{style.label}</span>
              )}

              {here.length > 0 && (
                <div className="flex flex-wrap items-center justify-center gap-0.5 w-full h-full p-[1px]">
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
                          here.length > 1 ? 'w-2.5 h-2.5 text-[7px]' : 'w-4/5 h-4/5 text-[8px]'
                        } rounded-full ${color.bg} border-2 border-white shadow-md flex items-center justify-center text-white font-black transition-transform ${
                          isSelectable
                            ? 'ring-2 ring-slate-900 dark:ring-white scale-125 animate-bounce cursor-pointer z-20'
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
