/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { GameId } from '../../types';
import { APP_CONFIG } from '../../constants/branding';
import { GameLogo } from './GameLogo';
import { Bot, Loader2, Users, X, Clock } from 'lucide-react';

interface MatchmakingQueueModalProps {
  isOpen: boolean;
  gameId: GameId;
  roomCode?: string;
  onCancel: () => void;
  onFallbackToAI: () => void;
}

export const MatchmakingQueueModal: React.FC<MatchmakingQueueModalProps> = ({
  isOpen,
  gameId,
  roomCode,
  onCancel,
  onFallbackToAI,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setElapsedSeconds(0);
      return;
    }
    setElapsedSeconds(0);
    const interval = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const gameMeta = APP_CONFIG.games.find((g) => g.id === gameId);
  const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
  const secs = String(elapsedSeconds % 60).padStart(2, '0');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 animate-in fade-in">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl text-center">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <GameLogo gameId={gameId} size="sm" />
            <div className="text-left">
              <p className="text-sm font-black text-slate-900 dark:text-white leading-tight">
                {gameMeta?.name || 'Game'} Queue
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Auto-Matchmaking Active
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel matchmaking"
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Radar Animation + Queue Timer */}
        <div className="my-5 flex flex-col items-center">
          <div className="relative w-20 h-20 flex items-center justify-center">
            <span className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping" />
            <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Loader2 className="w-7 h-7 animate-spin" />
            </div>
          </div>

          <h4 className="mt-4 text-base font-black text-slate-900 dark:text-white">
            Searching for Player...
          </h4>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-xs">
            Pairing you automatically into a shared live room as soon as the next online player joins.
          </p>

          <div className="mt-4 flex items-center gap-3">
            <div className="px-3.5 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span className="font-mono text-sm font-black text-slate-900 dark:text-white">
                {mins}:{secs}
              </span>
            </div>

            {roomCode && (
              <div className="px-3.5 py-2 rounded-2xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span className="font-mono text-sm font-black text-blue-700 dark:text-blue-300">
                  #{roomCode.length > 6 ? roomCode.slice(0, 6).toUpperCase() : roomCode}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2.5">
          <button
            type="button"
            onClick={onFallbackToAI}
            className="w-full py-2.5 min-h-[44px] bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            <Bot className="w-4 h-4" />
            <span>Play vs AI Bot Instead</span>
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="w-full py-2.5 min-h-[44px] bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-colors whitespace-nowrap"
          >
            Cancel Search
          </button>
        </div>
      </div>
    </div>
  );
};
