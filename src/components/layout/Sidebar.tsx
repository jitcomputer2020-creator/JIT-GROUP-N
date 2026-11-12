/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { NavTab } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { APP_CONFIG } from '../../constants/branding';
import {
  Home,
  Users,
  Video,
  Gamepad2,
  MessageSquare,
  Trophy,
  Wallet,
  Settings,
  Sparkles,
  ShieldCheck,
  Flame,
  PlusCircle,
} from 'lucide-react';

interface SidebarProps {
  activeTab: NavTab;
  onNavigate: (tab: NavTab) => void;
  onOpenCreatePost: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onNavigate,
  onOpenCreatePost,
}) => {
  const { currentUser, claimDailyReward } = useAuth();

  const mainLinks: { id: NavTab; label: string; icon: React.ElementType }[] = [
    { id: 'home', label: 'News Feed', icon: Home },
    { id: 'friends', label: 'Friends & Follow', icon: Users },
    { id: 'reels', label: 'Short Reels', icon: Video },
    { id: 'games', label: 'Gaming Hub', icon: Gamepad2 },
    { id: 'messages', label: 'Messages & Chat', icon: MessageSquare },
    { id: 'tournaments', label: 'Tournaments', icon: Trophy },
    { id: 'wallet', label: 'Rewards & Wallet', icon: Wallet },
    { id: 'settings', label: 'Settings & Privacy', icon: Settings },
  ];

  const handleClaim = () => {
    claimDailyReward();
  };

  return (
    <aside className="w-64 shrink-0 flex flex-col gap-5 py-6">
      {/* Profile Overview Card */}
      {currentUser ? (
        <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div
            onClick={() => onNavigate('profile')}
            className="flex items-center gap-3 cursor-pointer group"
          >
            <img
              src={currentUser.avatarUrl || APP_CONFIG.logoUrl}
              alt={currentUser.fullName}
              className="w-11 h-11 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shadow-sm group-hover:scale-105 transition-transform"
            />
            <div className="min-w-0 flex-1">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white truncate group-hover:text-blue-600 transition-colors">
                {currentUser.fullName}
              </h3>
              <p className="text-[10px] text-slate-500 truncate font-mono">
                {currentUser.contactNumber}
              </p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="flex items-center gap-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 font-mono">
                  <Sparkles className="w-3 h-3 text-amber-500" />
                  {currentUser.stats.rewardPoints} Pts
                </span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span className="flex items-center gap-0.5 text-[10px] font-medium text-orange-600 dark:text-orange-400">
                  <Flame className="w-3 h-3 text-orange-500" />
                  {currentUser.stats.streakDays}d streak
                </span>
              </div>
            </div>
          </div>

          {/* Quick Post Button */}
          <button
            onClick={onOpenCreatePost}
            className="w-full mt-3 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all flex items-center justify-center gap-1.5"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Create New Post</span>
          </button>
        </div>
      ) : (
        <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2.5">
          <div className="flex items-center gap-2.5">
            <img
              src={APP_CONFIG.logoUrl}
              alt="JIT"
              className="w-8 h-8 rounded-xl object-contain bg-white p-0.5 border"
            />
            <div>
              <p className="text-xs font-bold text-slate-900 dark:text-white">Join {APP_CONFIG.name}</p>
              <p className="text-[10px] text-slate-500">Contact Number Profile Access</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onNavigate('login')}
              className="flex-1 py-1.5 px-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors"
            >
              Sign In
            </button>
            <button
              onClick={() => onNavigate('register')}
              className="flex-1 py-1.5 px-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold transition-colors"
            >
              Register
            </button>
          </div>
        </div>
      )}

      {/* Main Navigation Menu */}
      <div className="p-2 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-1">
        {mainLinks.map((link) => {
          const Icon = link.icon;
          const isActive = activeTab === link.id;
          return (
            <button
              key={link.id}
              onClick={() => onNavigate(link.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition-all ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/60'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              <span>{link.label}</span>
            </button>
          );
        })}
      </div>

      {/* Daily Reward Booster */}
      <div className="p-4 rounded-3xl bg-gradient-to-br from-amber-500/10 via-orange-500/10 to-transparent border border-amber-200 dark:border-amber-900/40">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <h4 className="text-xs font-bold text-slate-900 dark:text-white">
            Daily Login Reward
          </h4>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2.5 leading-relaxed">
          Log in daily to build your streak and unlock tournament points.
        </p>
        <button
          onClick={handleClaim}
          className="w-full py-1.5 px-3 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-xl shadow-sm transition-colors"
        >
          Claim +50 JIT Points
        </button>
      </div>

      {/* 180-Day Automated Policy Card */}
      <div className="p-3.5 rounded-3xl bg-slate-100/70 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200 mb-1">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span className="text-[11px]">180-Day Inactivity Rule</span>
        </div>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
          Accounts without login for 180 consecutive days are purged automatically by scheduled server jobs.
        </p>
      </div>
    </aside>
  );
};
