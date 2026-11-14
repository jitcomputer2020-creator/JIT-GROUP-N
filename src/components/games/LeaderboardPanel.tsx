/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global Campus Leaderboard & Match History Panel
 * Reads live rankings from Firestore (/leaderboard & /match_history)
 * with REST & local fallback so top players and recent matches stay synced.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { LeaderboardEntry, MatchHistoryRecord } from '../../types';
import { useAuth, LS_MATCH_HISTORY } from '../../context/AuthContext';
import { fetchGlobalLeaderboard, fetchMatchHistory } from '../../lib/firebase';
import { APP_CONFIG } from '../../constants/branding';
import { Trophy, History, RefreshCw, Flame, Medal } from 'lucide-react';

export const LeaderboardPanel: React.FC = () => {
  const { currentUser, registeredProfiles } = useAuth();
  const [subTab, setSubTab] = useState<'leaderboard' | 'history'>('leaderboard');
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [history, setHistory] = useState<MatchHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cloudLeaders, cloudHistory] = await Promise.all([
        fetchGlobalLeaderboard(25),
        fetchMatchHistory(undefined, 25),
      ]);

      // Merge cloud leaderboard with active registered profiles so current points are always reflected
      const map = new Map<string, LeaderboardEntry>();
      cloudLeaders.forEach((e) => map.set(e.profileId, e));

      registeredProfiles.forEach((p) => {
        const existing = map.get(p.id);
        const pts = Math.max(existing?.rewardPoints ?? 0, p.stats?.rewardPoints ?? 0);
        map.set(p.id, {
          profileId: p.id,
          fullName: p.fullName,
          avatarUrl: p.avatarUrl,
          rewardPoints: pts,
          gamesPlayed: Math.max(existing?.gamesPlayed ?? 0, p.stats?.gamesPlayed ?? 0),
          gamesWon: Math.max(existing?.gamesWon ?? 0, p.stats?.gamesWon ?? 0),
          streakDays: Math.max(existing?.streakDays ?? 1, p.stats?.streakDays ?? 1),
          lastGameId: existing?.lastGameId,
        });
      });

      if (currentUser) {
        const existing = map.get(currentUser.id);
        map.set(currentUser.id, {
          profileId: currentUser.id,
          fullName: currentUser.fullName,
          avatarUrl: currentUser.avatarUrl,
          rewardPoints: Math.max(existing?.rewardPoints ?? 0, currentUser.stats.rewardPoints),
          gamesPlayed: Math.max(existing?.gamesPlayed ?? 0, currentUser.stats.gamesPlayed),
          gamesWon: Math.max(existing?.gamesWon ?? 0, currentUser.stats.gamesWon),
          streakDays: Math.max(existing?.streakDays ?? 1, currentUser.stats.streakDays),
          lastGameId: existing?.lastGameId,
        });
      }

      // If Firestore list returned empty offline, also try backend /api/games/leaderboard
      if (map.size === 0) {
        try {
          const res = await fetch('/api/games/leaderboard');
          if (res.ok) {
            const data = await res.json();
            (data.leaderboard || []).forEach((e: LeaderboardEntry) => map.set(e.profileId, e));
          }
        } catch {
          // Non-fatal
        }
      }

      const sortedLeaders = Array.from(map.values()).sort((a, b) => b.rewardPoints - a.rewardPoints);
      setLeaders(sortedLeaders);

      // Merge cloud history with local recent matches
      const histMap = new Map<string, MatchHistoryRecord>();
      cloudHistory.forEach((h) => histMap.set(h.id, h));
      if (typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem(LS_MATCH_HISTORY);
          const localHist: MatchHistoryRecord[] = raw ? JSON.parse(raw) : [];
          if (Array.isArray(localHist)) {
            localHist.forEach((h) => histMap.set(h.id, h));
          }
        } catch {
          // ignore
        }
      }
      const sortedHist = Array.from(histMap.values())
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 25);
      setHistory(sortedHist);
    } finally {
      setLoading(false);
    }
  }, [currentUser, registeredProfiles]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
          <button
            type="button"
            onClick={() => setSubTab('leaderboard')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 ${
              subTab === 'leaderboard'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <Trophy className="w-3.5 h-3.5" />
            <span>Global Leaderboard</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('history')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 ${
              subTab === 'history'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Match History</span>
          </button>
        </div>

        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {subTab === 'leaderboard' ? (
        <div className="space-y-2">
          {leaders.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">
              Play matches or claim daily rewards to appear on the campus leaderboard.
            </p>
          ) : (
            leaders.map((entry, idx) => {
              const isMe = currentUser?.id === entry.profileId;
              const rank = idx + 1;
              return (
                <div
                  key={entry.profileId}
                  className={`p-3 rounded-2xl border flex items-center justify-between gap-3 ${
                    isMe
                      ? 'bg-blue-50/80 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800'
                      : 'bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${
                        rank === 1
                          ? 'bg-amber-400 text-slate-950'
                          : rank === 2
                          ? 'bg-slate-300 text-slate-900'
                          : rank === 3
                          ? 'bg-orange-400 text-white'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {rank <= 3 ? <Medal className="w-4 h-4" /> : rank}
                    </div>

                    <img
                      src={entry.avatarUrl || APP_CONFIG.logoUrl}
                      alt={entry.fullName}
                      referrerPolicy="no-referrer"
                      className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                    />

                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {entry.fullName} {isMe ? '(You)' : ''}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                        <span className="tabular-nums">{entry.gamesWon} wins / {entry.gamesPlayed} played</span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-0.5 text-orange-600 dark:text-orange-400">
                          <Flame className="w-3 h-3" />
                          {entry.streakDays}d
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-sm font-black font-mono tabular-nums text-amber-600 dark:text-amber-400">
                      {entry.rewardPoints}
                    </span>
                    <span className="block text-[10px] text-slate-400 font-semibold">JIT Pts</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {history.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">
              No completed matches yet. Finish a game or spin the Lucky Wheel to record history!
            </p>
          ) : (
            history.map((item) => (
              <div
                key={item.id}
                className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                    <span>{item.gameName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-500 dark:text-slate-400 font-medium capitalize">
                      {item.mode}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        item.outcome === 'win' || item.outcome === 'spin'
                          ? 'text-emerald-600 dark:text-emerald-400 uppercase'
                          : item.outcome === 'draw'
                          ? 'text-amber-600 uppercase'
                          : 'text-slate-500 uppercase'
                      }
                    >
                      {item.outcome}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {item.playerName} · {item.scoreSummary} · {new Date(item.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>

                <span className="text-xs font-black font-mono tabular-nums text-emerald-600 dark:text-emerald-400 shrink-0">
                  +{item.pointsEarned} Pts
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
};
