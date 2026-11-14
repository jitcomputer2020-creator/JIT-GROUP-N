/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Tournament, NavTab } from '../types';
import { INITIAL_TOURNAMENTS } from '../services/mockData';
import { APP_CONFIG } from '../constants/branding';
import {
  Trophy,
  Users,
  Calendar,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';

interface TournamentsViewProps {
  onNavigate: (tab: NavTab) => void;
}

export const TournamentsView: React.FC<TournamentsViewProps> = ({ onNavigate }) => {
  const { currentUser, spendRewardPoints } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>(INITIAL_TOURNAMENTS);
  const [registeredIds, setRegisteredIds] = useState<string[]>(['tour_001']);
  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleJoinTournament = (tour: Tournament) => {
    if (!currentUser) return;
    if (registeredIds.includes(tour.id)) return;

    const spendRes = spendRewardPoints(
      tour.entryFeePoints,
      `Tournament Entry: ${tour.title}`,
      'tournament_entry'
    );
    if (!spendRes.success) {
      setJoinError(`Insufficient virtual points! Entry requires ${tour.entryFeePoints} points. Claim daily rewards or play games to earn more.`);
      setTimeout(() => setJoinError(null), 4000);
      return;
    }

    setJoinError(null);
    setRegisteredIds((prev) => [...prev, tour.id]);
    setTournaments((prev) =>
      prev.map((t) => (t.id === tour.id ? { ...t, registeredCount: t.registeredCount + 1 } : t))
    );

    setJoinSuccess(`Successfully registered for "${tour.title}"! New balance: ${spendRes.newTotal} Points.`);
    setTimeout(() => setJoinSuccess(null), 4000);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto w-full">
      {/* 1. Header Banner */}
      <section className="bg-gradient-to-r from-amber-600 via-orange-600 to-red-600 rounded-3xl p-6 sm:p-8 text-white shadow-xl">
        <div className="max-w-xl">
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="w-5 h-5 text-amber-200" />
            <span className="text-xs font-bold uppercase tracking-wider text-amber-200">
              JIT Championship Leagues
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight mb-2">
            Compete, Climb Brackets & Win Virtual Points
          </h2>
          <p className="text-xs sm:text-sm text-amber-100 leading-relaxed mb-4">
            Official campus tournaments for Ludo, Chess, Quiz Battle, and Carrom. Fair play guaranteed with server-authoritative move validation.
          </p>
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-black/20 backdrop-blur-md rounded-xl text-xs font-semibold">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-300" />
            <span>Virtual Points Only · Strictly No Real-Money Gambling</span>
          </div>
        </div>
      </section>

      {joinSuccess && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center gap-2.5 text-xs text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{joinSuccess}</span>
        </div>
      )}

      {joinError && (
        <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-2xl flex items-center gap-2.5 text-xs text-red-800 dark:text-red-300">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{joinError}</span>
        </div>
      )}

      {/* 2. Tournament Listing */}
      <div className="space-y-4">
        {tournaments.map((tour) => {
          const isRegistered = registeredIds.includes(tour.id);
          const game = APP_CONFIG.games.find((g) => g.id === tour.gameId);

          return (
            <div
              key={tour.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col md:flex-row md:items-center justify-between gap-6"
            >
              <div className="space-y-2 max-w-lg">
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                    tour.status === 'live'
                      ? 'bg-red-500 text-white animate-pulse'
                      : 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                  }`}>
                    {tour.status}
                  </span>
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                    {game?.name || 'Board Game'}
                  </span>
                </div>

                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {tour.title}
                </h3>

                {/* Clean unboxed tournament metadata with dot separators */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {tour.registeredCount} / {tour.totalSlots} Players
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="flex items-center gap-1 font-mono">
                    Entry: {tour.entryFeePoints} Pts
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold font-mono">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    Pool: {tour.prizePoolPoints} Pts
                  </span>
                </div>
              </div>

              {/* Action */}
              <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                {isRegistered ? (
                  <div className="flex items-center gap-2 px-4 py-2.5 min-h-[44px] bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl text-xs font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Registered</span>
                  </div>
                ) : (
                  <button
                    onClick={() => handleJoinTournament(tour)}
                    className="px-5 py-2.5 min-h-[44px] bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/20 active:scale-[0.98] transition-all flex items-center gap-1.5"
                  >
                    <span>Register Slot</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => onNavigate('games')}
                  className="px-3.5 py-2.5 min-h-[44px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold transition-colors"
                >
                  Practice Game
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
