/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocial } from '../context/SocialContext';
import { UserProfile, NavTab } from '../types';
import { INITIAL_USER, INITIAL_FRIENDS } from '../services/mockData';
import { APP_CONFIG } from '../constants/branding';
import {
  Users,
  UserPlus,
  UserCheck,
  Search,
  MessageSquare,
  Check,
  X,
  UserX,
} from 'lucide-react';

interface FriendsViewProps {
  onNavigate: (tab: NavTab) => void;
}

export const FriendsView: React.FC<FriendsViewProps> = ({ onNavigate }) => {
  const { currentUser, registeredProfiles } = useAuth();
  const {
    friendIds,
    pendingIncomingRequestIds,
    acceptFriendRequest,
    rejectFriendRequest,
    removeFriend,
    sendFriendRequest,
    hasPendingOutgoing,
    setViewingUserId,
  } = useSocial();

  const [tab, setTab] = useState<'all' | 'requests' | 'discover'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Collect all known campus profiles
  const allKnownProfiles: UserProfile[] = [
    INITIAL_USER,
    ...INITIAL_FRIENDS,
    ...(registeredProfiles || []),
  ].filter((p, index, self) => index === self.findIndex((t) => t.id === p.id));

  // Current friends list
  const friendsList = allKnownProfiles.filter(
    (p) => p.id !== currentUser?.id && friendIds.includes(p.id)
  );

  // Incoming friend requests
  const incomingRequests = allKnownProfiles.filter(
    (p) => p.id !== currentUser?.id && pendingIncomingRequestIds.includes(p.id)
  );

  // Discover peers (not self, not friend, not incoming)
  const discoverList = allKnownProfiles.filter(
    (p) =>
      p.id !== currentUser?.id &&
      !friendIds.includes(p.id) &&
      !pendingIncomingRequestIds.includes(p.id)
  );

  const handleUserClick = (userId: string) => {
    setViewingUserId(userId);
    onNavigate('profile');
  };

  const filterBySearch = (list: UserProfile[]) => {
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (f) =>
        f.fullName.toLowerCase().includes(q) ||
        f.address.toLowerCase().includes(q) ||
        f.bio?.toLowerCase().includes(q)
    );
  };

  const filteredFriends = filterBySearch(friendsList);
  const filteredRequests = filterBySearch(incomingRequests);
  const filteredDiscover = filterBySearch(discoverList);

  return (
    <div className="space-y-6 max-w-4xl mx-auto w-full">
      {/* 1. Header with Search */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              Campus Friends & Community
            </h2>
            <p className="text-xs text-slate-500">
              Connect with fellow students, faculty, and tournament rivals
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name or department..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl w-full sm:w-fit overflow-x-auto no-scrollbar">
          <button
            onClick={() => setTab('all')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-xl transition-all whitespace-nowrap ${
              tab === 'all'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            My Friends ({friendsList.length})
          </button>
          <button
            onClick={() => setTab('requests')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5 whitespace-nowrap ${
              tab === 'requests'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <span>Requests</span>
            {incomingRequests.length > 0 && (
              <span className="bg-emerald-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center font-mono">
                {incomingRequests.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('discover')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-xl transition-all whitespace-nowrap ${
              tab === 'discover'
                ? 'bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Find Peers ({discoverList.length})
          </button>
        </div>
      </div>

      {/* 2. Requests Tab */}
      {tab === 'requests' && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider px-1">
            Pending Friend Requests ({filteredRequests.length})
          </h3>
          {filteredRequests.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl">
              No pending friend requests.
            </div>
          ) : (
            filteredRequests.map((req) => (
              <div
                key={req.id}
                className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl flex items-center justify-between gap-4 shadow-sm"
              >
                <div
                  onClick={() => handleUserClick(req.id)}
                  className="flex items-center gap-3 cursor-pointer group flex-1 min-w-0"
                >
                  <img
                    src={req.avatarUrl || APP_CONFIG.logoUrl}
                    alt={req.fullName}
                    className="w-12 h-12 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shrink-0 group-hover:ring-2 group-hover:ring-blue-500 transition-all"
                  />
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-blue-600 transition-colors truncate">
                      {req.fullName}
                    </h4>
                    <p className="text-xs text-slate-500 truncate">{req.bio || 'JIT Campus Member'}</p>
                    <span className="text-[10px] text-slate-400 block truncate">{req.address}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => acceptFriendRequest(req.id)}
                    className="p-2 sm:px-3 sm:py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    <span className="hidden sm:inline">Confirm</span>
                  </button>
                  <button
                    onClick={() => rejectFriendRequest(req.id)}
                    className="p-2 sm:px-3 sm:py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <X className="w-4 h-4" />
                    <span className="hidden sm:inline">Delete</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 3. All Friends Grid */}
      {tab === 'all' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filteredFriends.length === 0 ? (
            <div className="col-span-full p-8 text-center text-xs text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl">
              No friends found. Use "Find Peers" to connect with campus members!
            </div>
          ) : (
            filteredFriends.map((friend) => (
              <div
                key={friend.id}
                className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl flex flex-col justify-between shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-all"
              >
                <div
                  onClick={() => handleUserClick(friend.id)}
                  className="flex items-start gap-3.5 mb-3 cursor-pointer group"
                >
                  <img
                    src={friend.avatarUrl || APP_CONFIG.logoUrl}
                    alt={friend.fullName}
                    className="w-12 h-12 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shrink-0 group-hover:ring-2 group-hover:ring-blue-500 transition-all"
                  />
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-blue-600 transition-colors truncate">
                      {friend.fullName}
                    </h4>
                    <p className="text-xs text-slate-500 line-clamp-1 mb-1">
                      {friend.bio || 'JIT Campus Member'}
                    </p>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      <span>{friend.stats?.gamesWon || 0} wins</span>
                      <span aria-hidden="true">·</span>
                      <span>{friend.stats?.rewardPoints || 100} points</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    onClick={() => onNavigate('messages')}
                    className="flex-1 py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors flex items-center justify-center gap-1.5"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Message</span>
                  </button>
                  <button
                    onClick={() => removeFriend(friend.id)}
                    className="py-1.5 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1"
                    title="Remove Friend"
                  >
                    <UserX className="w-3.5 h-3.5" />
                    <span>Remove</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 4. Discover Peers Tab */}
      {tab === 'discover' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filteredDiscover.length === 0 ? (
            <div className="col-span-full p-8 text-center text-xs text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl">
              All peers are already in your network or pending!
            </div>
          ) : (
            filteredDiscover.map((peer) => {
              const pendingOut = hasPendingOutgoing(peer.id);
              return (
                <div
                  key={peer.id}
                  className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl flex flex-col justify-between shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-all"
                >
                  <div
                    onClick={() => handleUserClick(peer.id)}
                    className="flex items-start gap-3.5 mb-3 cursor-pointer group"
                  >
                    <img
                      src={peer.avatarUrl || APP_CONFIG.logoUrl}
                      alt={peer.fullName}
                      className="w-12 h-12 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shrink-0 group-hover:ring-2 group-hover:ring-blue-500 transition-all"
                    />
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-blue-600 transition-colors truncate">
                        {peer.fullName}
                      </h4>
                      <p className="text-xs text-slate-500 line-clamp-1 mb-1">
                        {peer.bio || peer.address}
                      </p>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <span>{peer.stats?.gamesWon || 0} wins</span>
                        <span aria-hidden="true">·</span>
                        <span>{peer.stats?.rewardPoints || 100} points</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                    {pendingOut ? (
                      <button
                        disabled
                        className="flex-1 py-1.5 px-3 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-xl text-xs font-semibold"
                      >
                        Request Sent
                      </button>
                    ) : (
                      <button
                        onClick={() => sendFriendRequest(peer.id)}
                        className="flex-1 py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors flex items-center justify-center gap-1.5"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Add Friend</span>
                      </button>
                    )}
                    <button
                      onClick={() => handleUserClick(peer.id)}
                      className="py-1.5 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold transition-colors"
                    >
                      View Profile
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
