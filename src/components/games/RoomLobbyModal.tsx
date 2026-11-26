/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { UserProfile } from '../../types';
import { MultiplayerRoom } from '../../types/multiplayer';
import { APP_CONFIG } from '../../constants/branding';
import {
  Copy,
  Check,
  Share2,
  Users,
  Play,
  UserX,
  X,
  Shield,
  Loader2,
  Bot,
  RefreshCw,
  Search,
  Send,
} from 'lucide-react';

interface RoomLobbyModalProps {
  isOpen: boolean;
  room: MultiplayerRoom | null;
  currentUserId: string;
  friendsList?: UserProfile[];
  onSendDirectInvite?: (friend: UserProfile) => Promise<boolean>;
  onStartGame: () => void;
  onKickPlayer: (playerId: string) => void;
  onLeaveRoom: () => void;
  onFallbackToAI?: () => void;
  onResetRoomCode?: () => void;
  isResettingCode?: boolean;
  onClose: () => void;
}

export const RoomLobbyModal: React.FC<RoomLobbyModalProps> = ({
  isOpen,
  room,
  currentUserId,
  friendsList = [],
  onSendDirectInvite,
  onStartGame,
  onKickPlayer,
  onLeaveRoom,
  onFallbackToAI,
  onResetRoomCode,
  isResettingCode = false,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);
  const [inviteSearch, setInviteSearch] = useState('');
  const [sendingInviteId, setSendingInviteId] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<Record<string, boolean>>({});
  const [inviteError, setInviteError] = useState<string | null>(null);

  const filteredInvitees = useMemo(() => {
    const seatedIds = new Set((room?.players || []).map((p) => p.id));
    const q = inviteSearch.trim().toLowerCase();
    return friendsList
      .filter((f) => !seatedIds.has(f.id))
      .filter(
        (f) =>
          !q ||
          f.fullName.toLowerCase().includes(q) ||
          (f.username || '').toLowerCase().includes(q)
      )
      .slice(0, 10);
  }, [friendsList, inviteSearch, room?.players]);

  if (!isOpen || !room) return null;

  const isHost = room.hostId === currentUserId;
  const canStart = isHost && room.players.length >= 2;
  const isMatchActive =
    room.status === 'active' || room.status === 'playing' || room.status === 'in_game';
  const gameInfo = APP_CONFIG.games.find((g) => g.id === room.gameId);

  const copyTextSafe = async (value: string) => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      // Fallback below
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  };

  const handleCopyCode = async () => {
    await copyTextSafe(room.roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareInvite = async () => {
    const inviteText = `Join my JIT GROUP ${gameInfo?.name || 'game'} room! Room code: ${room.roomCode}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Play ${gameInfo?.name} on JIT GROUP`,
          text: inviteText,
          url: `${window.location.origin}/#room-${room.roomCode}`,
        });
        setShareSuccess(true);
        setTimeout(() => setShareSuccess(false), 2000);
        return;
      } catch {
        // Fallback to clipboard
      }
    }
    await copyTextSafe(`${inviteText} - ${window.location.origin}/#room-${room.roomCode}`);
    setShareSuccess(true);
    setTimeout(() => setShareSuccess(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 animate-in fade-in">
      <div className="w-full max-w-md max-h-[92dvh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 dark:bg-blue-950/60 text-blue-600 rounded-2xl">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                {gameInfo?.name || 'Game'} Room Lobby
              </h3>
              <p className="text-xs text-slate-500">
                Waiting for players ({room.players.length}/{room.maxPlayers})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 4-Digit Room Code Card */}
        <div className="p-5 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 rounded-3xl text-white text-center shadow-lg relative overflow-hidden">
          <div className="relative z-10 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-100">
              Your 4-Digit Room Code
            </p>
            <div className="text-4xl sm:text-5xl font-black font-mono tracking-widest my-2 select-all drop-shadow-md">
              {room.roomCode}
            </div>
            <p className="text-xs text-blue-100/90 max-w-xs mx-auto">
              Share this code with friends so they can join this match
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleCopyCode}
                className="px-4 py-2 bg-white/25 hover:bg-white/35 active:scale-95 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy Code'}</span>
              </button>
              <button
                type="button"
                onClick={handleShareInvite}
                className="px-4 py-2 bg-white text-slate-900 hover:bg-slate-100 active:scale-95 font-bold text-xs rounded-xl shadow-md flex items-center gap-1.5 transition-all"
              >
                {shareSuccess ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5" />}
                <span>{shareSuccess ? 'Shared!' : 'Share Invite'}</span>
              </button>
              {isHost && onResetRoomCode && room.players.length <= 1 && (
                <button
                  type="button"
                  disabled={isResettingCode}
                  onClick={onResetRoomCode}
                  className="px-3.5 py-2 bg-white/20 hover:bg-white/30 active:scale-95 disabled:opacity-60 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all"
                  title="Recycle this room and generate a fresh 4-digit code"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isResettingCode ? 'animate-spin' : ''}`} />
                  <span>{isResettingCode ? 'Resetting...' : 'New Code'}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Room Members List */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300 px-1">
            <span>Room Members</span>
            <span className="text-[11px] text-slate-400">
              {room.players.length >= 2 ? 'Ready to Start' : 'Waiting for opponent...'}
            </span>
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {room.players.map((player) => {
              const isMe = player.id === currentUserId;
              return (
                <div
                  key={player.id}
                  className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={player.avatar || APP_CONFIG.logoUrl}
                      alt={player.name}
                      className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-slate-700"
                    />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          {player.name}
                        </span>
                        {isMe && (
                          <span className="text-[10px] bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-bold px-1.5 py-0.2 rounded-md">
                            You
                          </span>
                        )}
                        {player.isHost && (
                          <span className="text-[10px] bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 font-bold px-1.5 py-0.2 rounded-md flex items-center gap-0.5">
                            <Shield className="w-2.5 h-2.5" />
                            Host
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Online & Ready
                      </p>
                    </div>
                  </div>

                  {isHost && !player.isHost && (
                    <button
                      type="button"
                      onClick={() => onKickPlayer(player.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                      title="Kick Player"
                    >
                      <UserX className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Direct Friend Invite List */}
        {onSendDirectInvite && friendsList.length > 0 && room.players.length < room.maxPlayers && (
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Invite a Friend Directly
              </span>
              <div className="relative flex-1 max-w-[160px]">
                <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={inviteSearch}
                  onChange={(e) => setInviteSearch(e.target.value)}
                  placeholder="Search name..."
                  className="w-full pl-7 pr-2 py-1 text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-900 dark:text-white"
                />
              </div>
            </div>
            {inviteError && (
              <p className="text-[11px] text-rose-500 font-semibold">{inviteError}</p>
            )}
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {filteredInvitees.length === 0 ? (
                <p className="text-[11px] text-slate-400 text-center py-2">
                  No matching friends to invite.
                </p>
              ) : (
                filteredInvitees.map((friend) => {
                  const alreadySent = Boolean(invitedIds[friend.id]);
                  const isBusy = sendingInviteId === friend.id;
                  return (
                    <div
                      key={friend.id}
                      className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/70 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <img
                          src={friend.avatarUrl || APP_CONFIG.logoUrl}
                          alt={friend.fullName}
                          className="w-7 h-7 rounded-full object-cover shrink-0"
                        />
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {friend.fullName}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={isBusy || alreadySent}
                        onClick={async () => {
                          setInviteError(null);
                          setSendingInviteId(friend.id);
                          try {
                            const ok = await onSendDirectInvite(friend);
                            if (ok) {
                              setInvitedIds((prev) => ({ ...prev, [friend.id]: true }));
                            } else {
                              setInviteError('Could not deliver invite right now.');
                            }
                          } finally {
                            setSendingInviteId(null);
                          }
                        }}
                        className={`px-3 py-1 rounded-xl text-[11px] font-bold flex items-center gap-1 shrink-0 transition-colors ${
                          alreadySent
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }`}
                      >
                        {isBusy ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : alreadySent ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <Send className="w-3 h-3" />
                        )}
                        <span>{isBusy ? 'Sending...' : alreadySent ? 'Invited ✓' : 'Send Invite'}</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Live Waiting Status + Optional Manual AI Switch */}
        {room.players.length < 2 && onFallbackToAI && (
          <div className="p-3.5 rounded-2xl border bg-blue-50/70 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/70 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-blue-900 dark:text-blue-200">
              <Loader2 className="w-4 h-4 shrink-0 animate-spin text-blue-600" />
              <span>Share Room #{room.roomCode} — waiting for your friend to join...</span>
            </div>
            <button
              type="button"
              onClick={onFallbackToAI}
              className="px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-blue-200 dark:border-blue-700 text-slate-700 dark:text-slate-200 font-semibold text-[11px] rounded-xl flex items-center gap-1.5 transition-colors"
            >
              <Bot className="w-3.5 h-3.5" />
              <span>Play vs AI Instead</span>
            </button>
          </div>
        )}

        {/* Footer Actions */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-3">
          <button
            type="button"
            onClick={onLeaveRoom}
            className="flex-1 py-2.5 text-xs font-bold rounded-2xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {isHost ? 'Close Room' : 'Leave Room'}
          </button>

          {isHost ? (
            isMatchActive ? (
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 text-xs font-bold rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white shadow-md flex items-center justify-center gap-2 transition-all"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>Resume Active Match</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onStartGame}
                disabled={!canStart}
                className="flex-1 py-2.5 text-xs font-bold rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-40 text-white shadow-md flex items-center justify-center gap-2 transition-all"
              >
                {room.players.length < 2 ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Waiting for Player</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    <span>Start Game Now</span>
                  </>
                )}
              </button>
            )
          ) : isMatchActive ? (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-xs font-bold rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md flex items-center justify-center gap-2 transition-all"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Match Active · Play</span>
            </button>
          ) : (
            <div className="flex-1 py-2.5 text-xs font-bold text-center text-slate-500 bg-slate-50 dark:bg-slate-800/60 rounded-2xl">
              Waiting for Host to start...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
