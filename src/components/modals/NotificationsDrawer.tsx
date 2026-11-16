/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  X,
  Bell,
  Check,
  Award,
  Trophy,
  Users,
  Gamepad2,
  ArrowRight,
  MessageSquare,
  UserCheck,
} from 'lucide-react';
import { InAppNotification, NavTab } from '../../types';
import { useSocial } from '../../context/SocialContext';
import { APP_CONFIG } from '../../constants/branding';

interface NotificationsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: NavTab) => void;
}

export const NotificationsDrawer: React.FC<NotificationsDrawerProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const {
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    pendingIncomingRequestIds,
    isFriend,
    acceptFriendRequest,
    rejectFriendRequest,
    openDirectChat,
    setViewingUserId,
  } = useSocial();

  if (!isOpen) return null;

  const getIcon = (type: string) => {
    switch (type) {
      case 'reward':
      case 'achievement':
        return <Award className="w-4 h-4 text-amber-500" />;
      case 'tournament':
        return <Trophy className="w-4 h-4 text-purple-500" />;
      case 'game_invite':
        return <Gamepad2 className="w-4 h-4 text-blue-500" />;
      case 'friend_request':
        return <Users className="w-4 h-4 text-emerald-500" />;
      case 'friend_accept':
        return <UserCheck className="w-4 h-4 text-emerald-500" />;
      case 'message':
        return <MessageSquare className="w-4 h-4 text-blue-500" />;
      default:
        return <Bell className="w-4 h-4 text-slate-500" />;
    }
  };

  const handleAction = (notif: InAppNotification) => {
    if (!notif.isRead) {
      markNotificationRead(notif.id);
    }

    if (notif.type === 'reward' || notif.type === 'achievement') {
      onNavigate('wallet');
    } else if (notif.type === 'game_invite') {
      onNavigate('games');
    } else if (notif.type === 'tournament') {
      onNavigate('tournaments');
    } else if (notif.type === 'message') {
      if (notif.fromUserId) {
        openDirectChat({
          id: notif.fromUserId,
          fullName: notif.fromUserName,
          avatarUrl: notif.fromUserAvatar,
        });
      }
      onNavigate('messages');
    } else if (notif.type === 'friend_request') {
      onNavigate('friends');
    } else if (notif.type === 'friend_accept' && notif.fromUserId) {
      setViewingUserId(notif.fromUserId);
      onNavigate('profile');
    } else {
      onNavigate('home');
    }
    onClose();
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-4 sm:pl-10">
        <div className="w-screen max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
          {/* Header */}
          <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                <Bell className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Notifications
                </h3>
                <p className="text-[11px] text-slate-500">
                  {unreadCount} unread update{unreadCount === 1 ? '' : 's'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllNotificationsRead}
                  className="px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
                >
                  <Check className="w-3 h-3" />
                  Mark read
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {notifications.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                No notifications right now.
              </div>
            ) : (
              notifications.map((notif) => {
                const isPendingFriendReq =
                  notif.type === 'friend_request' &&
                  !!notif.fromUserId &&
                  pendingIncomingRequestIds.includes(notif.fromUserId) &&
                  !isFriend(notif.fromUserId);
                const alreadyAccepted =
                  notif.type === 'friend_request' &&
                  !!notif.fromUserId &&
                  isFriend(notif.fromUserId);

                return (
                  <div
                    key={notif.id}
                    onClick={() => handleAction(notif)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                      notif.isRead
                        ? 'bg-slate-50/70 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800'
                        : 'bg-white dark:bg-slate-800 border-blue-200 dark:border-blue-900 shadow-sm hover:border-blue-300'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {notif.fromUserAvatar ? (
                        <img
                          src={notif.fromUserAvatar || APP_CONFIG.logoUrl}
                          alt={notif.fromUserName || notif.title}
                          className="w-9 h-9 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                        />
                      ) : (
                        <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700/60 shrink-0">
                          {getIcon(notif.type)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p
                            className={`text-xs font-semibold truncate ${
                              notif.isRead
                                ? 'text-slate-700 dark:text-slate-300'
                                : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            {notif.title}
                          </p>
                          <span className="text-[10px] text-slate-400 shrink-0">
                            {notif.createdAt}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                          {notif.message}
                        </p>

                        {/* Real-time Accept / Decline buttons directly in notification */}
                        {isPendingFriendReq && notif.fromUserId && (
                          <div
                            className="flex items-center gap-2 mt-2.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                acceptFriendRequest(notif.fromUserId!);
                                markNotificationRead(notif.id);
                              }}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[11px] font-bold flex items-center gap-1 shadow-sm"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Accept</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                rejectFriendRequest(notif.fromUserId!);
                                markNotificationRead(notif.id);
                              }}
                              className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-[11px] font-bold flex items-center gap-1"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Decline</span>
                            </button>
                          </div>
                        )}

                        {alreadyAccepted && (
                          <p className="mt-1.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <UserCheck className="w-3 h-3" />
                            Connected as Friends
                          </p>
                        )}
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0 self-center" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
