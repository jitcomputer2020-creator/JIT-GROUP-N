/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef } from 'react';
import { NavTab } from '../../types';
import { APP_CONFIG } from '../../constants/branding';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import {
  Sun,
  Moon,
  Search,
  Bell,
  Sparkles,
  User,
} from 'lucide-react';

interface NavbarProps {
  activeTab: NavTab;
  onNavigate: (tab: NavTab) => void;
  onOpenSearch: () => void;
  onOpenNotifications: () => void;
  onOpenAuth: () => void;
  onOpenAdmin?: () => void;
  unreadCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onNavigate,
  onOpenSearch,
  onOpenNotifications,
  onOpenAuth,
  onOpenAdmin,
  unreadCount = 2,
}) => {
  const { currentUser, isAuthenticated } = useAuth();
  const { effectiveTheme, toggleTheme } = useTheme();
  const logoTapTimesRef = useRef<number[]>([]);

  const handleLogoTap = () => {
    const now = Date.now();
    const recentTaps = logoTapTimesRef.current.filter((t) => now - t < 1800);
    recentTaps.push(now);
    logoTapTimesRef.current = recentTaps;

    if (recentTaps.length >= 5) {
      logoTapTimesRef.current = [];
      if (onOpenAdmin) {
        onOpenAdmin();
        return;
      }
    }
    onNavigate('home');
  };

  const navLinks: { id: NavTab; label: string }[] = [
    { id: 'home', label: 'Feed' },
    { id: 'friends', label: 'Friends' },
    { id: 'reels', label: 'Reels' },
    { id: 'games', label: 'Games' },
    { id: 'messages', label: 'Messages' },
    { id: 'tournaments', label: 'Tournaments' },
    { id: 'wallet', label: 'Wallet' },
  ];

  return (
    <header className="sticky top-0 z-40 w-full bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4 md:gap-8">
        {/* Zone 1: Brand Mark & Identity */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={handleLogoTap}
            className="flex items-center gap-2 text-left group focus:outline-none touch-manipulate"
          >
            <img
              src={APP_CONFIG.logoUrl}
              alt="JIT Logo"
              className="w-9 h-9 sm:w-10 sm:h-10 object-contain rounded-xl bg-white p-0.5 shadow-sm border border-slate-200 group-hover:scale-105 transition-transform shrink-0"
            />
            <div className="flex flex-col">
              <span className="text-sm sm:text-base font-extrabold tracking-tight text-slate-900 dark:text-white whitespace-nowrap leading-none">
                {APP_CONFIG.name}
              </span>
              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap mt-0.5 hidden sm:block">
                Jharna Institute of Tech
              </span>
            </div>
          </button>
        </div>

        {/* Zone 2: Navigation Links (Desktop) */}
        <nav className="hidden lg:flex items-center gap-1 xl:gap-2">
          {navLinks.map((link) => {
            const isActive = activeTab === link.id;
            return (
              <button
                key={link.id}
                onClick={() => onNavigate(link.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${
                  isActive
                    ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                {link.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Interactive Affordances & User Controls */}
        <div className="flex items-center gap-1 sm:gap-2.5 shrink-0">
          {/* Quick Search */}
          <button
            onClick={onOpenSearch}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center p-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Search JIT GROUP (Ctrl+K)"
            aria-label="Search"
          >
            <Search className="w-4 h-4" />
          </button>


          {/* Reward Points Pill */}
          {currentUser && (
            <button
              onClick={() => onNavigate('wallet')}
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 min-h-[36px] py-1 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-xl hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
              title="Virtual Reward Points"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="text-xs font-bold text-amber-700 dark:text-amber-400 font-mono tabular-nums">
                {currentUser.stats.rewardPoints}
              </span>
            </button>
          )}

          {/* Theme Switcher Toggle */}
          <button
            onClick={toggleTheme}
            className="min-w-[40px] min-h-[40px] flex items-center justify-center p-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title={`Switch to ${effectiveTheme === 'dark' ? 'Light' : 'Dark'} Theme`}
            aria-label="Toggle Theme"
          >
            {effectiveTheme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-600" />
            )}
          </button>

          {/* Notifications Trigger */}
          <button
            onClick={onOpenNotifications}
            className="relative min-w-[40px] min-h-[40px] flex items-center justify-center p-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-600 ring-2 ring-white dark:ring-slate-900" />
            )}
          </button>

          {/* User Profile or Login Trigger */}
          {isAuthenticated && currentUser ? (
            <button
              onClick={() => onNavigate('profile')}
              className="flex items-center gap-2 pl-1 pr-1.5 sm:pr-2 min-h-[40px] py-1 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title={`${currentUser.fullName} (Active Profile)`}
            >
              <img
                src={currentUser.avatarUrl || APP_CONFIG.logoUrl}
                alt={currentUser.fullName}
                className="w-7 h-7 rounded-full object-cover border border-slate-200 dark:border-slate-700"
              />
              <span className="hidden md:inline text-xs font-semibold text-slate-900 dark:text-white truncate max-w-[100px]">
                {currentUser.fullName.split(' ')[0]}
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-1 sm:gap-1.5">
              <button
                onClick={() => onNavigate('login')}
                className="px-2 sm:px-3 min-h-[38px] py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors whitespace-nowrap"
              >
                Sign In
              </button>
              <button
                onClick={() => onNavigate('register')}
                className="px-2.5 sm:px-3 min-h-[38px] py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition-colors flex items-center gap-1 whitespace-nowrap"
              >
                <User className="w-3.5 h-3.5 hidden sm:inline" />
                <span>Register</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
