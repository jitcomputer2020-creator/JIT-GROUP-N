/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { UserProfile, NavTab } from '../../types';
import { APP_CONFIG } from '../../constants/branding';
import { X, Heart, UserCheck, UserPlus } from 'lucide-react';
import { useSocial } from '../../context/SocialContext';

interface LikedByModalProps {
  isOpen: boolean;
  onClose: () => void;
  likers: UserProfile[];
  onNavigate: (tab: NavTab) => void;
}

export const LikedByModal: React.FC<LikedByModalProps> = ({
  isOpen,
  onClose,
  likers,
  onNavigate,
}) => {
  const { setViewingUserId, isFriend, sendFriendRequest } = useSocial();

  if (!isOpen) return null;

  const handleUserClick = (userId: string) => {
    setViewingUserId(userId);
    onClose();
    onNavigate('profile');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-2xl overflow-hidden max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-red-50 dark:bg-red-950/50 text-red-500 rounded-xl">
              <Heart className="w-4 h-4 fill-current" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Liked By ({likers.length})
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Likers List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80 py-2 no-scrollbar">
          {likers.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              No likes yet. Be the first to like this post!
            </div>
          ) : (
            likers.map((user) => (
              <div
                key={user.id}
                className="py-3 flex items-center justify-between gap-3 group"
              >
                <div
                  onClick={() => handleUserClick(user.id)}
                  className="flex items-center gap-3 cursor-pointer min-w-0 flex-1"
                >
                  <img
                    src={user.avatarUrl || APP_CONFIG.logoUrl}
                    alt={user.fullName}
                    className="w-10 h-10 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shrink-0 group-hover:ring-2 group-hover:ring-blue-500 transition-all"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {user.fullName}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {user.address || 'JIT Campus Member'}
                    </p>
                  </div>
                </div>

                {isFriend(user.id) ? (
                  <span className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 rounded-xl">
                    <UserCheck className="w-3 h-3" />
                    <span>Friend</span>
                  </span>
                ) : (
                  <button
                    onClick={() => sendFriendRequest(user.id)}
                    className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/50 px-2.5 py-1 rounded-xl transition-colors"
                  >
                    <UserPlus className="w-3 h-3" />
                    <span>Connect</span>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
