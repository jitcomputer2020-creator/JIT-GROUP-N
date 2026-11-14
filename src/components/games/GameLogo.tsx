/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Clean, distinct vector SVG emblems for each JIT GROUP game.
 * Zero external image dependencies so logos always render crisply on any screen.
 */

import React from 'react';
import { GameId } from '../../types';

interface GameLogoProps {
  gameId: GameId;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP = {
  sm: 'w-8 h-8',
  md: 'w-11 h-11',
  lg: 'w-14 h-14',
};

export const GameLogo: React.FC<GameLogoProps> = ({ gameId, size = 'md', className = '' }) => {
  const dims = SIZE_MAP[size];

  switch (gameId) {
    case 'ludo':
      return (
        <div className={`${dims} ${className} rounded-2xl overflow-hidden shadow-sm border border-amber-300/60 shrink-0`}>
          <svg viewBox="0 0 64 64" className="w-full h-full" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="#FFFBEB" />
            <rect x="4" y="4" width="25" height="25" rx="6" fill="#EF4444" />
            <rect x="35" y="4" width="25" height="25" rx="6" fill="#10B981" />
            <rect x="4" y="35" width="25" height="25" rx="6" fill="#3B82F6" />
            <rect x="35" y="35" width="25" height="25" rx="6" fill="#F59E0B" />
            <circle cx="16.5" cy="16.5" r="5.5" fill="#FFFFFF" />
            <circle cx="47.5" cy="16.5" r="5.5" fill="#FFFFFF" />
            <circle cx="16.5" cy="47.5" r="5.5" fill="#FFFFFF" />
            <circle cx="47.5" cy="47.5" r="5.5" fill="#FFFFFF" />
            <polygon points="32,20 44,32 32,44 20,32" fill="#1E293B" />
            <circle cx="32" cy="32" r="4.5" fill="#FBBF24" />
          </svg>
        </div>
      );

    case 'tictactoe':
      return (
        <div className={`${dims} ${className} rounded-2xl overflow-hidden shadow-sm border border-blue-400/40 shrink-0`}>
          <svg viewBox="0 0 64 64" className="w-full h-full" aria-hidden="true">
            <defs>
              <linearGradient id="tttBg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#1D4ED8" />
                <stop offset="100%" stopColor="#4338CA" />
              </linearGradient>
            </defs>
            <rect width="64" height="64" rx="14" fill="url(#tttBg)" />
            <line x1="25" y1="10" x2="25" y2="54" stroke="#93C5FD" strokeWidth="2.5" strokeLinecap="round" opacity="0.55" />
            <line x1="39" y1="10" x2="39" y2="54" stroke="#93C5FD" strokeWidth="2.5" strokeLinecap="round" opacity="0.55" />
            <line x1="10" y1="25" x2="54" y2="25" stroke="#93C5FD" strokeWidth="2.5" strokeLinecap="round" opacity="0.55" />
            <line x1="10" y1="39" x2="54" y2="39" stroke="#93C5FD" strokeWidth="2.5" strokeLinecap="round" opacity="0.55" />
            {/* Bold X */}
            <line x1="12" y1="12" x2="21" y2="21" stroke="#FDE047" strokeWidth="3.5" strokeLinecap="round" />
            <line x1="21" y1="12" x2="12" y2="21" stroke="#FDE047" strokeWidth="3.5" strokeLinecap="round" />
            {/* Bold O */}
            <circle cx="47.5" cy="47.5" r="5.5" fill="none" stroke="#34D399" strokeWidth="3.5" />
            {/* Center X */}
            <line x1="28.5" y1="28.5" x2="35.5" y2="35.5" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
            <line x1="35.5" y1="28.5" x2="28.5" y2="35.5" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      );

    case 'quiz':
      return (
        <div className={`${dims} ${className} rounded-2xl overflow-hidden shadow-sm border border-purple-400/40 shrink-0`}>
          <svg viewBox="0 0 64 64" className="w-full h-full" aria-hidden="true">
            <defs>
              <linearGradient id="quizBg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#7C3AED" />
                <stop offset="100%" stopColor="#DB2777" />
              </linearGradient>
            </defs>
            <rect width="64" height="64" rx="14" fill="url(#quizBg)" />
            <circle cx="32" cy="32" r="20" fill="#FFFFFF" opacity="0.16" />
            <path
              d="M25 24.5C25 20.4 28.2 17.5 32.3 17.5C36.6 17.5 39.5 20.1 39.5 23.9C39.5 27.1 37.3 28.9 34.7 30.6C32.8 31.8 32 33.1 32 35.5V37"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="4.2"
              strokeLinecap="round"
            />
            <circle cx="32" cy="44.5" r="2.8" fill="#FDE047" />
            <polygon points="48,12 50,17 55,17 51,20 52.5,25 48,22 43.5,25 45,20 41,17 46,17" fill="#FDE047" />
          </svg>
        </div>
      );

    case 'chess':
      return (
        <div className={`${dims} ${className} rounded-2xl overflow-hidden shadow-sm border border-slate-600/60 shrink-0`}>
          <svg viewBox="0 0 64 64" className="w-full h-full" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="#0F172A" />
            <rect x="8" y="8" width="24" height="24" rx="4" fill="#1E293B" />
            <rect x="32" y="32" width="24" height="24" rx="4" fill="#1E293B" />
            {/* Crown / King silhouette */}
            <path
              d="M19 44L16 25L24 31L32 19L40 31L48 25L45 44H19Z"
              fill="#F59E0B"
              stroke="#FDE68A"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <rect x="18" y="46" width="28" height="5" rx="2.5" fill="#E2E8F0" />
            <circle cx="32" cy="14" r="2.5" fill="#FDE047" />
          </svg>
        </div>
      );

    case 'snake_ladder':
      return (
        <div className={`${dims} ${className} rounded-2xl overflow-hidden shadow-sm border border-emerald-400/50 shrink-0`}>
          <svg viewBox="0 0 64 64" className="w-full h-full" aria-hidden="true">
            <defs>
              <linearGradient id="slBg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#059669" />
                <stop offset="100%" stopColor="#0F766E" />
              </linearGradient>
            </defs>
            <rect width="64" height="64" rx="14" fill="url(#slBg)" />
            {/* Golden Ladder */}
            <line x1="17" y1="50" x2="29" y2="14" stroke="#FDE047" strokeWidth="3.2" strokeLinecap="round" />
            <line x1="27" y1="53" x2="39" y2="17" stroke="#FDE047" strokeWidth="3.2" strokeLinecap="round" />
            <line x1="20" y1="42" x2="30" y2="45" stroke="#FEF08A" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="23" y1="33" x2="33" y2="36" stroke="#FEF08A" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="26" y1="24" x2="36" y2="27" stroke="#FEF08A" strokeWidth="2.5" strokeLinecap="round" />
            {/* Coiled Coral Snake */}
            <path
              d="M46 16C52 16 53 24 46 27C39 30 39 39 46 42C51 44 50 51 42 51"
              fill="none"
              stroke="#FCA5A5"
              strokeWidth="4.5"
              strokeLinecap="round"
            />
            <circle cx="45.5" cy="16" r="4" fill="#EF4444" />
            <circle cx="44.5" cy="15" r="1.2" fill="#FFFFFF" />
          </svg>
        </div>
      );

    case 'carrom':
      return (
        <div className={`${dims} ${className} rounded-2xl overflow-hidden shadow-sm border border-amber-700/60 shrink-0`}>
          <svg viewBox="0 0 64 64" className="w-full h-full" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="#78350F" />
            <rect x="7" y="7" width="50" height="50" rx="9" fill="#FEF3C7" />
            {/* 4 Corner Pockets */}
            <circle cx="13" cy="13" r="4" fill="#0F172A" />
            <circle cx="51" cy="13" r="4" fill="#0F172A" />
            <circle cx="13" cy="51" r="4" fill="#0F172A" />
            <circle cx="51" cy="51" r="4" fill="#0F172A" />
            {/* Center Circle & Red Queen */}
            <circle cx="32" cy="32" r="12" fill="none" stroke="#DC2626" strokeWidth="1.8" opacity="0.65" />
            <circle cx="32" cy="32" r="5" fill="#DC2626" />
            {/* Carrom Men */}
            <circle cx="25" cy="29" r="3" fill="#1E293B" />
            <circle cx="39" cy="35" r="3" fill="#F8FAFC" stroke="#94A3B8" strokeWidth="1" />
            {/* Striker */}
            <circle cx="32" cy="48" r="4" fill="#2563EB" stroke="#FFFFFF" strokeWidth="1.5" />
          </svg>
        </div>
      );

    case 'spin_wheel':
      return (
        <div className={`${dims} ${className} rounded-2xl overflow-hidden shadow-sm border border-rose-400/50 shrink-0`}>
          <svg viewBox="0 0 64 64" className="w-full h-full" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="#881337" />
            <circle cx="32" cy="34" r="21" fill="#FDE047" />
            <path d="M32 34 L32 15 A19 19 0 0 1 51 34 Z" fill="#EF4444" />
            <path d="M32 34 L51 34 A19 19 0 0 1 32 53 Z" fill="#3B82F6" />
            <path d="M32 34 L32 53 A19 19 0 0 1 13 34 Z" fill="#10B981" />
            <path d="M32 34 L13 34 A19 19 0 0 1 32 15 Z" fill="#F59E0B" />
            <circle cx="32" cy="34" r="6" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2" />
            {/* Top Pointer */}
            <polygon points="32,16 27,7 37,7" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.5" />
          </svg>
        </div>
      );
  }
};
