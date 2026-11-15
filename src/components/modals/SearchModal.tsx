/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Search,
  Users,
  FileText,
  Gamepad2,
  Trophy,
  ArrowRight,
  UserPlus,
  UserCheck,
  Loader2,
} from 'lucide-react';
import { NavTab, UserProfile } from '../../types';
import { INITIAL_USER, INITIAL_FRIENDS, INITIAL_TOURNAMENTS } from '../../services/mockData';
import { APP_CONFIG } from '../../constants/branding';
import { useAuth } from '../../context/AuthContext';
import { useSocial } from '../../context/SocialContext';
import { fetchPublicDirectory, searchCloudUsers, deriveUsername } from '../../lib/firebase';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: NavTab) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose, onNavigate }) => {
  const { currentUser, registeredProfiles } = useAuth();
  const {
    posts,
    setViewingUserId,
    isFriend,
    hasPendingOutgoing,
    sendFriendRequest,
  } = useSocial();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | 'users' | 'posts' | 'games' | 'tournaments'>('all');
  const [cloudUsers, setCloudUsers] = useState<UserProfile[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);

  // Load initial public directory when modal opens
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchPublicDirectory(60)
      .then((list) => {
        if (!cancelled) setCloudUsers(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Run live case-insensitive Firebase + API search on query updates
  useEffect(() => {
    if (!isOpen) return;
    const trimmed = query.trim();
    if (!trimmed) return;

    let cancelled = false;
    setIsSearchingUsers(true);
    const timer = window.setTimeout(() => {
      searchCloudUsers(trimmed, 30)
        .then((res) => {
          if (!cancelled) {
            setCloudUsers((prev) => {
              const map = new Map<string, UserProfile>();
              res.forEach((u) => map.set(u.id, u));
              prev.forEach((u) => {
                if (!map.has(u.id)) map.set(u.id, u);
              });
              return Array.from(map.values());
            });
            setIsSearchingUsers(false);
          }
        })
        .catch(() => {
          if (!cancelled) setIsSearchingUsers(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, query]);

  const filteredUsers = useMemo(() => {
    const raw = query.trim();
    const q = raw.toLowerCase().replace(/^@+/, '');
    const qDigits = raw.replace(/\D/g, '');

    const allUsers = [
      ...cloudUsers,
      ...registeredProfiles,
      INITIAL_USER,
      ...INITIAL_FRIENDS,
    ].filter(
      (u, idx, arr) =>
        u?.id &&
        u.id !== currentUser?.id &&
        u.status !== 'deleted' &&
        arr.findIndex((x) => x.id === u.id) === idx
    );

    if (!q) return allUsers.slice(0, 12);

    return allUsers.filter((u) => {
      const uname = (u.username || deriveUsername(u.fullName)).toLowerCase();
      const nameMatch = u.fullName.toLowerCase().includes(q);
      const userMatch = uname.includes(q);
      const bioMatch = (u.bio || '').toLowerCase().includes(q);
      const addrMatch = (u.address || '').toLowerCase().includes(q);
      const phoneMatch =
        qDigits.length >= 3 && (u.contactNumber || '').replace(/\D/g, '').includes(qDigits);
      return nameMatch || userMatch || bioMatch || addrMatch || phoneMatch;
    });
  }, [cloudUsers, registeredProfiles, currentUser?.id, query]);

  if (!isOpen) return null;

  const q = query.toLowerCase().trim();

  const filteredPosts = posts.filter(
    (p) => !q || p.content.toLowerCase().includes(q) || p.authorName.toLowerCase().includes(q)
  );

  const filteredGames = APP_CONFIG.games.filter(
    (g) => !q || g.name.toLowerCase().includes(q) || g.category.toLowerCase().includes(q)
  );

  const filteredTournaments = INITIAL_TOURNAMENTS.filter(
    (t) => !q || t.title.toLowerCase().includes(q) || t.gameId.toLowerCase().includes(q)
  );

  const handleOpenUserProfile = (userId: string) => {
    setViewingUserId(userId);
    onNavigate('profile');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 sm:pt-20 p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85dvh]">
        {/* Search input bar */}
        <div className="p-3.5 sm:p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input
            type="text"
            autoFocus
            placeholder="Search by name, @username, phone, posts, games..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full text-sm bg-transparent focus:outline-none text-slate-900 dark:text-white placeholder:text-slate-400"
          />
          {isSearchingUsers && <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />}
          <button
            onClick={onClose}
            aria-label="Close search"
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Categories Bar */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 overflow-x-auto no-scrollbar">
          {(['all', 'users', 'posts', 'games', 'tournaments'] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3 py-1 text-xs font-semibold rounded-lg capitalize whitespace-nowrap transition-colors ${
                category === cat
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Results List */}
        <div className="p-4 overflow-y-auto space-y-4">
          {/* Users */}
          {(category === 'all' || category === 'users') && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-emerald-500" />
                JIT Members ({filteredUsers.length})
              </p>
              {filteredUsers.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-center text-xs text-slate-400">
                  {isSearchingUsers
                    ? 'Searching Firebase user directory...'
                    : `No members matched "${query}". Try searching by name, @username, or phone.`}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredUsers.map((user) => {
                    const handle = user.username || deriveUsername(user.fullName);
                    const friendAlready = isFriend(user.id);
                    const pendingOut = hasPendingOutgoing(user.id);
                    return (
                      <div
                        key={user.id}
                        className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors flex items-center justify-between gap-2.5"
                      >
                        <button
                          type="button"
                          onClick={() => handleOpenUserProfile(user.id)}
                          className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
                        >
                          <img
                            src={user.avatarUrl || APP_CONFIG.logoUrl}
                            alt={user.fullName}
                            className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {user.fullName}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">
                              <span className="font-mono text-blue-600 dark:text-blue-400">@{handle}</span>
                              {user.bio ? ` · ${user.bio}` : ''}
                            </p>
                          </div>
                        </button>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {friendAlready ? (
                            <span className="px-2.5 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold flex items-center gap-1">
                              <UserCheck className="w-3.5 h-3.5" />
                              <span>Friends</span>
                            </span>
                          ) : pendingOut ? (
                            <span className="px-2.5 py-1.5 rounded-xl bg-slate-200/70 dark:bg-slate-700 text-slate-500 dark:text-slate-300 text-[11px] font-bold">
                              Sent
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => sendFriendRequest(user.id)}
                              className="px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold flex items-center gap-1 shadow-sm"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              <span>Add Friend</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleOpenUserProfile(user.id)}
                            className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-blue-400 text-slate-700 dark:text-slate-200 text-[11px] font-bold"
                          >
                            View Profile
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Games */}
          {(category === 'all' || category === 'games') && filteredGames.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                <Gamepad2 className="w-3.5 h-3.5 text-blue-500" />
                Multiplayer Games
              </p>
              <div className="grid grid-cols-2 gap-2">
                {filteredGames.map((game) => (
                  <button
                    key={game.id}
                    onClick={() => {
                      onNavigate('games');
                      onClose();
                    }}
                    className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-slate-200 dark:border-slate-700 text-left transition-colors flex items-center justify-between"
                  >
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white">{game.name}</p>
                      <p className="text-[10px] text-slate-500">{game.category} · {game.players}</p>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tournaments */}
          {(category === 'all' || category === 'tournaments') && filteredTournaments.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5 text-amber-500" />
                Active Tournaments
              </p>
              <div className="space-y-1.5">
                {filteredTournaments.map((tour) => (
                  <button
                    key={tour.id}
                    onClick={() => {
                      onNavigate('tournaments');
                      onClose();
                    }}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-amber-50/50 dark:hover:bg-amber-900/20 text-left transition-colors flex items-center justify-between"
                  >
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white">{tour.title}</p>
                      <p className="text-[10px] text-slate-500">Prize: {tour.prizePoolPoints} Points · {tour.registeredCount}/{tour.totalSlots} Slots</p>
                    </div>
                    <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase">Join</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Posts */}
          {(category === 'all' || category === 'posts') && filteredPosts.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-purple-500" />
                Campus Posts
              </p>
              <div className="space-y-1.5">
                {filteredPosts.map((post) => (
                  <button
                    key={post.id}
                    onClick={() => {
                      onNavigate('home');
                      onClose();
                    }}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/60 text-left transition-colors"
                  >
                    <p className="text-xs font-semibold text-slate-900 dark:text-white line-clamp-1">
                      {post.authorName}: {post.content}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{post.likesCount} likes · {post.commentsCount} comments</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
