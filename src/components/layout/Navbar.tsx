/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect, useMemo } from 'react';
import { NavTab, UserProfile } from '../../types';
import { APP_CONFIG } from '../../constants/branding';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useSocial } from '../../context/SocialContext';
import { INITIAL_USER, INITIAL_FRIENDS } from '../../services/mockData';
import { searchCloudUsers, deriveUsername } from '../../lib/firebase';
import {
  Sun,
  Moon,
  Search,
  Bell,
  Sparkles,
  User,
  UserPlus,
  UserCheck,
  X,
  Loader2,
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
  onOpenAdmin,
  unreadCount = 2,
}) => {
  const { currentUser, registeredProfiles, isAuthenticated } = useAuth();
  const { effectiveTheme, toggleTheme } = useTheme();
  const {
    setViewingUserId,
    isFriend,
    hasPendingOutgoing,
    sendFriendRequest,
  } = useSocial();

  const logoTapTimesRef = useRef<number[]>([]);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  const [headerQuery, setHeaderQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [cloudHits, setCloudHits] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);

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

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const trimmed = headerQuery.trim();
    if (!trimmed) {
      setCloudHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchCloudUsers(trimmed, 12)
        .then((res) => {
          if (!cancelled) {
            setCloudHits(res);
            setSearching(false);
          }
        })
        .catch(() => {
          if (!cancelled) setSearching(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [headerQuery]);

  const localMatches = useMemo(() => {
    const q = headerQuery.trim().toLowerCase().replace(/^@+/, '');
    if (!q) return [];
    const qDigits = headerQuery.replace(/\D/g, '');
    const pool = [...registeredProfiles, INITIAL_USER, ...INITIAL_FRIENDS].filter(
      (p, idx, arr) =>
        p.id !== currentUser?.id &&
        p.status !== 'deleted' &&
        arr.findIndex((x) => x.id === p.id) === idx
    );

    return pool.filter((u) => {
      const uname = (u.username || deriveUsername(u.fullName)).toLowerCase();
      const nameHit = u.fullName.toLowerCase().includes(q);
      const userHit = uname.includes(q);
      const phoneHit =
        qDigits.length >= 3 && u.contactNumber.replace(/\D/g, '').includes(qDigits);
      return nameHit || userHit || phoneHit;
    });
  }, [headerQuery, registeredProfiles, currentUser?.id]);

  const mergedResults = useMemo(() => {
    const byId = new Map<string, UserProfile>();
    [...cloudHits, ...localMatches].forEach((u) => {
      if (u.id && u.id !== currentUser?.id && !byId.has(u.id)) {
        byId.set(u.id, u);
      }
    });
    return Array.from(byId.values()).slice(0, 8);
  }, [cloudHits, localMatches, currentUser?.id]);

  const handleViewUser = (userId: string) => {
    setViewingUserId(userId);
    setDropdownOpen(false);
    onNavigate('profile');
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
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-3 lg:gap-5">
        {/* Zone 1: Brand Mark & Identity */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={handleLogoTap}
            className="flex items-center gap-2 text-left group focus:outline-none touch-manipulation"
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
        <nav className="hidden lg:flex items-center gap-0.5 xl:gap-1.5">
          {navLinks.map((link) => {
            const isActive = activeTab === link.id;
            return (
              <button
                key={link.id}
                onClick={() => onNavigate(link.id)}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${
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

        {/* Zone 2.5: Live User Search Input (Tablet & Desktop) */}
        <div ref={searchBoxRef} className="hidden md:block relative w-52 xl:w-64 shrink">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={headerQuery}
              onFocus={() => setDropdownOpen(true)}
              onChange={(e) => {
                setHeaderQuery(e.target.value);
                setDropdownOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setDropdownOpen(false);
              }}
              placeholder="Search name, @user or phone..."
              aria-label="Search registered users"
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white placeholder:text-slate-400"
            />
            {headerQuery && (
              <button
                type="button"
                onClick={() => {
                  setHeaderQuery('');
                  setCloudHits([]);
                }}
                aria-label="Clear user search"
                className="absolute right-2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {dropdownOpen && headerQuery.trim().length > 0 && (
            <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden z-50">
              <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] font-bold text-slate-500">
                <span>JIT Members ({mergedResults.length})</span>
                {searching && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />}
              </div>

              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
                {mergedResults.length === 0 && !searching ? (
                  <div className="p-4 text-center text-xs text-slate-400">
                    No users found for "{headerQuery}"
                  </div>
                ) : (
                  mergedResults.map((user) => {
                    const alreadyFriend = isFriend(user.id);
                    const pendingOut = hasPendingOutgoing(user.id);
                    const handle = user.username || deriveUsername(user.fullName);
                    return (
                      <div
                        key={user.id}
                        className="p-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 flex items-center justify-between gap-2 transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => handleViewUser(user.id)}
                          className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                        >
                          <img
                            src={user.avatarUrl || APP_CONFIG.logoUrl}
                            alt={user.fullName}
                            className="w-8 h-8 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {user.fullName}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate font-mono">
                              @{handle}
                            </p>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          {alreadyFriend ? (
                            <span className="px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold flex items-center gap-1">
                              <UserCheck className="w-3 h-3" />
                              Friends
                            </span>
                          ) : pendingOut ? (
                            <span className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-bold">
                              Sent
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => sendFriendRequest(user.id)}
                              className="px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold flex items-center gap-1"
                            >
                              <UserPlus className="w-3 h-3" />
                              Add
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleViewUser(user.id)}
                            className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-bold"
                          >
                            View
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setDropdownOpen(false);
                  onOpenSearch();
                }}
                className="w-full py-2 text-[11px] font-bold text-blue-600 dark:text-blue-400 bg-slate-50 dark:bg-slate-800/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 border-t border-slate-100 dark:border-slate-800 transition-colors"
              >
                Open Full Search (Users, Posts & Games)
              </button>
            </div>
          )}
        </div>

        {/* Zone 3: Interactive Affordances & User Controls */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Mobile / Quick Global Search Trigger */}
          <button
            onClick={onOpenSearch}
            className="md:hidden min-w-[40px] min-h-[40px] flex items-center justify-center p-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
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
              onClick={() => {
                setViewingUserId(null);
                onNavigate('profile');
              }}
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
