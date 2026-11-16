/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocial } from '../context/SocialContext';
import { UserProfile, NavTab } from '../types';
import { INITIAL_USER, INITIAL_FRIENDS } from '../services/mockData';
import { APP_CONFIG } from '../constants/branding';
import { fetchPublicDirectory, searchCloudUsers, deriveUsername } from '../lib/firebase';
import {
  UserPlus,
  Search,
  MessageSquare,
  Check,
  X,
  UserX,
  Loader2,
} from 'lucide-react';

interface FriendsViewProps {
  onNavigate: (tab: NavTab) => void;
}

export const FriendsView: React.FC<FriendsViewProps> = ({ onNavigate }) => {
  const { currentUser, registeredProfiles } = useAuth();
  const {
    friendIds,
    pendingIncomingRequestIds,
    friendRequestPeers,
    acceptFriendRequest,
    rejectFriendRequest,
    removeFriend,
    sendFriendRequest,
    hasPendingOutgoing,
    setViewingUserId,
    openDirectChat,
  } = useSocial();

  const [tab, setTab] = useState<'all' | 'requests' | 'discover'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [cloudUsers, setCloudUsers] = useState<UserProfile[]>([]);
  const [searchingCloud, setSearchingCloud] = useState(false);

  // Load Firebase public user directory on mount
  useEffect(() => {
    let cancelled = false;
    fetchPublicDirectory(100)
      .then((list) => {
        if (!cancelled) setCloudUsers(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Run case-insensitive Firebase + backend search when typing in Friends search box
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchingCloud(false);
      return;
    }
    let cancelled = false;
    setSearchingCloud(true);
    const timer = window.setTimeout(() => {
      searchCloudUsers(trimmed, 40)
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
            setSearchingCloud(false);
          }
        })
        .catch(() => {
          if (!cancelled) setSearchingCloud(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  // Collect all known campus + Firebase registered profiles + friend request peers
  const allKnownProfiles: UserProfile[] = useMemo(() => {
    return [
      ...cloudUsers,
      ...friendRequestPeers,
      ...(registeredProfiles || []),
      INITIAL_USER,
      ...INITIAL_FRIENDS,
    ].filter(
      (p, index, self) =>
        p?.id &&
        p.status !== 'deleted' &&
        index === self.findIndex((t) => t.id === p.id)
    );
  }, [cloudUsers, friendRequestPeers, registeredProfiles]);

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
    const q = searchQuery.trim().toLowerCase().replace(/^@+/, '');
    const qDigits = searchQuery.replace(/\D/g, '');
    return list.filter((f) => {
      const uname = (f.username || deriveUsername(f.fullName)).toLowerCase();
      const phoneMatch =
        qDigits.length >= 3 && (f.contactNumber || '').replace(/\D/g, '').includes(qDigits);
      return (
        f.fullName.toLowerCase().includes(q) ||
        uname.includes(q) ||
        (f.address || '').toLowerCase().includes(q) ||
        (f.bio || '').toLowerCase().includes(q) ||
        phoneMatch
      );
    });
  };

  const filteredFriends = filterBySearch(friendsList);
  const filteredRequests = filterBySearch(incomingRequests);
  const filteredDiscover = filterBySearch(discoverList);

  return (
    <div className="space-y-6 max-w-4xl mx-auto w-full">
      {/* 1. Header with Search */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              Campus Friends & Community
            </h2>
            <p className="text-xs text-slate-500">
              Search registered Firebase users by name, @username, or phone number
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search name, @username or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-8 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white placeholder:text-slate-400"
            />
            {searchingCloud && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-blue-600" />
            )}
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
                className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 shadow-sm"
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
                    <p className="text-[11px] font-mono text-blue-600 dark:text-blue-400 truncate">
                      @{req.username || deriveUsername(req.fullName)}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{req.bio || req.address || 'JIT Campus Member'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => acceptFriendRequest(req.id)}
                    className="flex-1 sm:flex-initial px-3.5 py-2 min-h-[44px] bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    <span>Confirm</span>
                  </button>
                  <button
                    onClick={() => rejectFriendRequest(req.id)}
                    className="flex-1 sm:flex-initial px-3.5 py-2 min-h-[44px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <X className="w-4 h-4" />
                    <span>Delete</span>
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
              {searchQuery.trim()
                ? 'No current friends matched your search. See Discover matches below!'
                : 'No friends found. Use "Find Peers" to connect with campus members!'}
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
                    <p className="text-[11px] font-mono text-blue-600 dark:text-blue-400 truncate">
                      @{friend.username || deriveUsername(friend.fullName)}
                    </p>
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
                    onClick={() => {
                      openDirectChat({
                        id: friend.id,
                        fullName: friend.fullName,
                        avatarUrl: friend.avatarUrl,
                      });
                      onNavigate('messages');
                    }}
                    className="flex-1 py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors flex items-center justify-center gap-1.5"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Message</span>
                  </button>
                  <button
                    onClick={() => handleUserClick(friend.id)}
                    className="py-1.5 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold transition-colors"
                  >
                    View Profile
                  </button>
                  <button
                    onClick={() => removeFriend(friend.id)}
                    className="py-1.5 px-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1"
                    title="Remove Friend"
                  >
                    <UserX className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 4. Discover Peers Tab (Also shown inline whenever actively searching from Friends/Requests!) */}
      {(tab === 'discover' || (searchQuery.trim().length > 0 && filteredDiscover.length > 0)) && (
        <div className="space-y-3">
          {tab !== 'discover' && (
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider px-1">
              More JIT Members Matching "{searchQuery}" ({filteredDiscover.length})
            </h3>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredDiscover.length === 0 ? (
              <div className="col-span-full p-8 text-center text-xs text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl">
                {searchQuery.trim()
                  ? `No users matched "${searchQuery}". Try another name, @username, or phone.`
                  : 'All peers are already in your network or pending!'}
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
                        <p className="text-[11px] font-mono text-blue-600 dark:text-blue-400 truncate">
                          @{peer.username || deriveUsername(peer.fullName)}
                        </p>
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
                          onClick={() => sendFriendRequest(peer.id, peer)}
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
        </div>
      )}
    </div>
  );
};
