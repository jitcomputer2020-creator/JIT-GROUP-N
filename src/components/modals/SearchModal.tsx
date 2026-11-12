/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Search, Users, FileText, Video, Gamepad2, Trophy, ArrowRight } from 'lucide-react';
import { NavTab } from '../../types';
import { INITIAL_FRIENDS, INITIAL_POSTS, INITIAL_REELS, INITIAL_TOURNAMENTS } from '../../services/mockData';
import { APP_CONFIG } from '../../constants/branding';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: NavTab) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({ isOpen, onClose, onNavigate }) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | 'users' | 'posts' | 'games' | 'tournaments'>('all');

  if (!isOpen) return null;

  const q = query.toLowerCase().trim();

  const filteredUsers = INITIAL_FRIENDS.filter(
    (u) => !q || u.fullName.toLowerCase().includes(q) || u.bio?.toLowerCase().includes(q)
  );

  const filteredPosts = INITIAL_POSTS.filter(
    (p) => !q || p.content.toLowerCase().includes(q) || p.authorName.toLowerCase().includes(q)
  );

  const filteredGames = APP_CONFIG.games.filter(
    (g) => !q || g.name.toLowerCase().includes(q) || g.category.toLowerCase().includes(q)
  );

  const filteredTournaments = INITIAL_TOURNAMENTS.filter(
    (t) => !q || t.title.toLowerCase().includes(q) || t.gameId.toLowerCase().includes(q)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Search input bar */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input
            type="text"
            autoFocus
            placeholder="Search users, posts, reels, games, tournaments..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full text-sm bg-transparent focus:outline-none text-slate-900 dark:text-white placeholder:text-slate-400"
          />
          <button
            onClick={onClose}
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

          {/* Users */}
          {(category === 'all' || category === 'users') && filteredUsers.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-emerald-500" />
                JIT Members
              </p>
              <div className="space-y-1.5">
                {filteredUsers.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => {
                      onNavigate('friends');
                      onClose();
                    }}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/60 text-left transition-colors flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2.5">
                      <img
                        src={user.avatarUrl || APP_CONFIG.logoUrl}
                        alt={user.fullName}
                        className="w-8 h-8 rounded-full object-cover border border-slate-200"
                      />
                      <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-white">{user.fullName}</p>
                        <p className="text-[11px] text-slate-500 line-clamp-1">{user.bio}</p>
                      </div>
                    </div>
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">View</span>
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
