/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth, LS_WALLET_TX } from '../context/AuthContext';
import { WalletTransaction, NavTab } from '../types';
import {
  Sparkles,
  Flame,
  ArrowUpRight,
  ArrowDownLeft,
  CheckCircle2,
  ShieldCheck,
  Gamepad2,
} from 'lucide-react';

interface WalletViewProps {
  onNavigate: (tab: NavTab) => void;
}

export const WalletView: React.FC<WalletViewProps> = ({ onNavigate }) => {
  const { currentUser, claimDailyReward } = useAuth();
  const [claimStatus, setClaimStatus] = useState<string | null>(null);

  const loadTransactions = useCallback((): WalletTransaction[] => {
    const defaultSeeds: WalletTransaction[] = [
      {
        id: 'tx_001',
        userId: currentUser?.id || 'usr_jit_primary_001',
        amount: 50,
        type: 'daily_reward',
        description: 'Daily Streak Login Bonus (Day 7)',
        createdAt: 'Today, 08:30 AM',
      },
      {
        id: 'tx_002',
        userId: currentUser?.id || 'usr_jit_primary_001',
        amount: 250,
        type: 'quiz_reward',
        description: 'First Place Victory in JIT Tech Quiz Battle',
        createdAt: 'Yesterday, 06:15 PM',
      },
      {
        id: 'tx_003',
        userId: currentUser?.id || 'usr_jit_primary_001',
        amount: -50,
        type: 'tournament_entry',
        description: 'Entry Fee: JIT Grand Ludo Championship 2026',
        createdAt: '2 days ago',
      },
      {
        id: 'tx_004',
        userId: currentUser?.id || 'usr_jit_primary_001',
        amount: 100,
        type: 'achievement',
        description: 'Achievement Unlocked: "First Victory" in Gaming Hub',
        createdAt: '3 days ago',
      },
    ];

    if (typeof window === 'undefined') return defaultSeeds;
    try {
      const raw = localStorage.getItem(LS_WALLET_TX);
      const saved: WalletTransaction[] = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(saved) || saved.length === 0) return defaultSeeds;
      const seen = new Set(saved.map((t) => t.id));
      return [...saved, ...defaultSeeds.filter((d) => !seen.has(d.id))];
    } catch {
      return defaultSeeds;
    }
  }, [currentUser?.id]);

  const [transactions, setTransactions] = useState<WalletTransaction[]>(loadTransactions);

  useEffect(() => {
    setTransactions(loadTransactions());
  }, [loadTransactions, currentUser?.stats.rewardPoints]);

  const handleClaimDaily = () => {
    const res = claimDailyReward();
    if (res.success) {
      setTransactions(loadTransactions());
      setClaimStatus(`Claimed +${res.pointsAdded} Points! Total balance is now ${res.newTotal}.`);
      setTimeout(() => setClaimStatus(null), 3500);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto w-full">
      {/* 1. Wallet Balance Hero Card */}
      <section className="bg-gradient-to-br from-blue-700 via-indigo-700 to-emerald-700 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-1.5 text-blue-200">
              <Sparkles className="w-4 h-4 text-amber-300" />
              <span className="text-xs font-bold uppercase tracking-wider">
                JIT Campus Virtual Rewards
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl sm:text-4xl font-black font-mono tracking-tight tabular-nums">
                {currentUser?.stats.rewardPoints || 0}
              </span>
              <span className="text-sm font-bold text-blue-200">Points</span>
            </div>
            <div className="flex items-center gap-3 mt-3 text-xs text-blue-100">
              <span className="flex items-center gap-1 font-semibold text-amber-300">
                <Flame className="w-4 h-4 text-orange-400" />
                {currentUser?.stats.streakDays || 1} Day Streak
              </span>
              <span>·</span>
              <span>Rank #14 on Campus Leaderboard</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleClaimDaily}
              className="px-5 py-3 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded-2xl text-xs shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              <span>Claim Today (+50 Pts)</span>
            </button>
            <button
              onClick={() => onNavigate('games')}
              className="px-4 py-3 bg-white/20 hover:bg-white/30 text-white font-semibold rounded-2xl text-xs backdrop-blur-md transition-colors flex items-center justify-center gap-2"
            >
              <Gamepad2 className="w-4 h-4" />
              <span>Play to Earn</span>
            </button>
          </div>
        </div>
      </section>

      {claimStatus && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center gap-2.5 text-xs text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{claimStatus}</span>
        </div>
      )}

      {/* 2. Security & Virtual Disclosure Notice */}
      <div className="p-4 rounded-3xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-start gap-3 text-xs text-slate-600 dark:text-slate-300">
        <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-slate-900 dark:text-white">
            Auditable Virtual Ledger & Fair Play Guarantee
          </p>
          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            Points are purely virtual in-app awards earned through gameplay, quizzes, tournaments, and attendance. No real-money deposit, withdrawal, or betting is supported. All rewards are recorded in an immutable ledger and checked server-side.
          </p>
        </div>
      </div>

      {/* 3. Transaction History */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 mb-4">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            Points Ledger & Activity
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            {transactions.length} Records
          </span>
        </div>

        <div className="space-y-3">
          {transactions.map((tx) => {
            const isCredit = tx.amount > 0;
            return (
              <div
                key={tx.id}
                className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl shrink-0 ${isCredit ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400' : 'bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400'}`}>
                    {isCredit ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                      {tx.description}
                    </h4>
                    <span className="text-[10px] text-slate-400">
                      {tx.createdAt} · {tx.type.replace('_', ' ')}
                    </span>
                  </div>
                </div>

                <span className={`text-sm font-black font-mono tabular-nums shrink-0 ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                  {isCredit ? `+${tx.amount}` : tx.amount} Pts
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
