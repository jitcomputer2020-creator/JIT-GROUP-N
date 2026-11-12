/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { NavTab } from '../../types';
import { INITIAL_FRIENDS, INITIAL_TOURNAMENTS } from '../../services/mockData';
import { APP_CONFIG } from '../../constants/branding';
import { Trophy, UserPlus, Gamepad2, ArrowRight } from 'lucide-react';

interface RightWidgetPanelProps {
  onNavigate: (tab: NavTab) => void;
}

export const RightWidgetPanel: React.FC<RightWidgetPanelProps> = ({ onNavigate }) => {
  return (
    <aside className="w-80 shrink-0 hidden xl:flex flex-col gap-5 py-6">
      {/* Active Tournaments Widget */}
      <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Live Tournaments
            </h3>
          </div>
          <button
            onClick={() => onNavigate('tournaments')}
            className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
          >
            View all
          </button>
        </div>

        <div className="space-y-2.5">
          {INITIAL_TOURNAMENTS.slice(0, 2).map((tour) => (
            <div
              key={tour.id}
              onClick={() => onNavigate('tournaments')}
              className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 hover:border-amber-300 dark:hover:border-amber-700/60 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-blue-600 transition-colors truncate">
                  {tour.title}
                </span>
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 font-mono shrink-0">
                  {tour.prizePoolPoints} Pts
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Slots: {tour.registeredCount}/{tour.totalSlots}</span>
                <span className="capitalize text-amber-600 dark:text-amber-400 font-medium">{tour.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Suggested Campus Friends Widget */}
      <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-emerald-500" />
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Suggested Friends
            </h3>
          </div>
          <button
            onClick={() => onNavigate('friends')}
            className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
          >
            Explore
          </button>
        </div>

        <div className="space-y-2.5">
          {INITIAL_FRIENDS.slice(0, 3).map((friend) => (
            <div
              key={friend.id}
              className="flex items-center justify-between gap-2 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src={friend.avatarUrl || APP_CONFIG.logoUrl}
                  alt={friend.fullName}
                  className="w-9 h-9 rounded-xl object-cover border border-slate-200 dark:border-slate-700"
                />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {friend.fullName}
                  </p>
                  <p className="text-[10px] text-slate-500 truncate">
                    {friend.bio}
                  </p>
                </div>
              </div>

              <button
                onClick={() => onNavigate('friends')}
                className="px-2.5 py-1 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-600 hover:text-white text-blue-600 dark:text-blue-400 rounded-lg text-[11px] font-semibold transition-all shrink-0"
              >
                Add
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Play 6 Games Shortcut */}
      <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Gamepad2 className="w-4 h-4 text-purple-500" />
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Multiplayer Games
            </h3>
          </div>
          <button
            onClick={() => onNavigate('games')}
            className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
          >
            All 6
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {APP_CONFIG.games.slice(0, 4).map((game) => (
            <button
              key={game.id}
              onClick={() => onNavigate('games')}
              className="p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-slate-100 dark:border-slate-800 text-left transition-all group"
            >
              <p className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-blue-600 transition-colors">
                {game.name}
              </p>
              <p className="text-[10px] text-slate-500 truncate">
                {game.players}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Campus Trust Footer */}
      <div className="px-2 text-[11px] text-slate-400 leading-relaxed">
        <p className="font-semibold text-slate-500 dark:text-slate-400">
          Jharna Institute of Technology
        </p>
        <p className="mt-0.5">
          JIT GROUP Unified Community Engine v{APP_CONFIG.version}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => onNavigate('settings')}
            className="hover:underline hover:text-slate-600 dark:hover:text-slate-300"
          >
            Privacy Policy
          </button>
          <span>·</span>
          <button
            onClick={() => onNavigate('settings')}
            className="hover:underline hover:text-slate-600 dark:hover:text-slate-300"
          >
            180-Day Rule
          </button>
          <span>·</span>
          <button
            onClick={() => onNavigate('settings')}
            className="hover:underline hover:text-slate-600 dark:hover:text-slate-300"
          >
            Help
          </button>
        </div>
      </div>
    </aside>
  );
};
