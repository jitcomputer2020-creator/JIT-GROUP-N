/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { NavTab } from '../../types';
import { Home, Users, Video, Gamepad2, MessageSquare, User } from 'lucide-react';

interface BottomNavProps {
  activeTab: NavTab;
  onNavigate: (tab: NavTab) => void;
  unreadMessagesCount?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onNavigate,
  unreadMessagesCount = 0,
}) => {
  const tabs: { id: NavTab; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: 'home', label: 'Feed', icon: Home },
    { id: 'friends', label: 'Friends', icon: Users },
    { id: 'reels', label: 'Reels', icon: Video },
    { id: 'games', label: 'Games', icon: Gamepad2 },
    { id: 'messages', label: 'Chat', icon: MessageSquare, badge: unreadMessagesCount },
    { id: 'profile', label: 'Profile', icon: User },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-lg border-t border-slate-200 dark:border-slate-800 pb-safe">
      <div className="grid grid-cols-6 items-center h-16 max-w-lg mx-auto px-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onNavigate(tab.id)}
              className="relative flex flex-col items-center justify-center min-h-[44px] min-w-[44px] py-1 text-center transition-colors group"
              aria-label={tab.label}
            >
              <div className="relative">
                <Icon
                  className={`w-5 h-5 transition-transform group-active:scale-95 ${
                    isActive
                      ? 'text-blue-600 dark:text-blue-400 stroke-[2.5]'
                      : 'text-slate-500 dark:text-slate-400 stroke-[1.75]'
                  }`}
                />
                {tab.badge && tab.badge > 0 ? (
                  <span className="absolute -top-1 -right-2 bg-blue-600 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center font-mono">
                    {tab.badge}
                  </span>
                ) : null}
              </div>
              <span
                className={`text-[10px] font-semibold mt-1 transition-colors leading-none ${
                  isActive
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {tab.label}
              </span>
              {isActive && (
                <span className="absolute bottom-1 w-1 h-1 rounded-full bg-blue-600 dark:bg-blue-400" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
