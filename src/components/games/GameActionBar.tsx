/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { GameMode } from '../../types/multiplayer';
import {
  MessageSquare,
  Phone,
  Video,
  Users,
  Share2,
  LogOut,
  Copy,
  Check,
  Bot,
  Shuffle,
  KeyRound,
} from 'lucide-react';

interface GameActionBarProps {
  gameMode: GameMode;
  roomCode?: string;
  unreadChatCount?: number;
  isCallActive?: boolean;
  onOpenChat: () => void;
  onStartVoiceCall: () => void;
  onStartVideoCall: () => void;
  onOpenMembers: () => void;
  onInviteFriend: () => void;
  onLeaveRoom: () => void;
  aiDifficulty?: string;
}

export const GameActionBar: React.FC<GameActionBarProps> = ({
  gameMode,
  roomCode,
  unreadChatCount = 0,
  isCallActive = false,
  onOpenChat,
  onStartVoiceCall,
  onStartVideoCall,
  onOpenMembers,
  onInviteFriend,
  onLeaveRoom,
  aiDifficulty,
}) => {
  const [copiedCode, setCopiedCode] = useState(false);

  const handleCopy = () => {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-2.5 sm:p-3 mb-4 flex flex-wrap items-center justify-between gap-2.5 shadow-sm">
      {/* Mode Status Pill */}
      <div className="flex items-center gap-2">
        {gameMode === 'friend' && roomCode && (
          <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/70 border border-blue-200 dark:border-blue-800 px-2.5 py-1 rounded-xl">
            <KeyRound className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span className="text-xs font-bold text-blue-700 dark:text-blue-300">
              Room #{roomCode}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="text-blue-500 hover:text-blue-700 p-0.5 ml-0.5"
              title="Copy 4-digit code"
            >
              {copiedCode ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        )}

        {gameMode === 'random' && (
          <div className="flex items-center gap-1.5 bg-purple-50 dark:bg-purple-950/70 border border-purple-200 dark:border-purple-800 px-2.5 py-1 rounded-xl">
            <Shuffle className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            <span className="text-xs font-bold text-purple-700 dark:text-purple-300">
              Random Match
            </span>
          </div>
        )}

        {gameMode === 'ai' && (
          <div className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1 rounded-xl">
            <Bot className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300 capitalize">
              vs {aiDifficulty || 'Medium'} AI
            </span>
          </div>
        )}
      </div>

      {/* Communications & Room Controls Bar */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Live Chat */}
        <button
          type="button"
          onClick={onOpenChat}
          className="relative px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs"
          title="Open In-Game Live Chat"
        >
          <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
          <span className="hidden sm:inline">Chat</span>
          {unreadChatCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
              {unreadChatCount}
            </span>
          )}
        </button>

        {/* Voice Call */}
        <button
          type="button"
          onClick={onStartVoiceCall}
          className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs"
          title="Start In-Game Voice Call"
        >
          <Phone className="w-3.5 h-3.5 text-emerald-500" />
          <span className="hidden sm:inline">Voice</span>
        </button>

        {/* Video Call */}
        <button
          type="button"
          onClick={onStartVideoCall}
          className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs"
          title="Start In-Game Video Call"
        >
          <Video className="w-3.5 h-3.5 text-purple-500" />
          <span className="hidden sm:inline">Video</span>
        </button>

        {/* Room Members */}
        {gameMode !== 'ai' && (
          <button
            type="button"
            onClick={onOpenMembers}
            className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs"
            title="View Room Members"
          >
            <Users className="w-3.5 h-3.5 text-amber-500" />
            <span className="hidden sm:inline">Members</span>
          </button>
        )}

        {/* Invite Friend */}
        {gameMode === 'friend' && (
          <button
            type="button"
            onClick={onInviteFriend}
            className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs"
            title="Invite Friend"
          >
            <Share2 className="w-3.5 h-3.5 text-blue-500" />
            <span className="hidden sm:inline">Invite</span>
          </button>
        )}

        {/* Leave Room / Resign */}
        <button
          type="button"
          onClick={onLeaveRoom}
          className="px-2.5 py-1.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl hover:bg-red-100 dark:hover:bg-red-900/60 text-red-600 dark:text-red-400 text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs"
          title="Leave Game / Resign"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Exit</span>
        </button>
      </div>
    </div>
  );
};
