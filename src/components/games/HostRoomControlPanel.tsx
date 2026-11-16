/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { MultiplayerRoom, RoomPlayer } from '../../types/multiplayer';
import { APP_CONFIG } from '../../constants/branding';
import {
  X,
  Crown,
  Mic,
  MicOff,
  MessageSquare,
  MessageSquareOff,
  UserMinus,
  Users,
  ArrowRightLeft,
  Check,
  Clock,
  Shield,
} from 'lucide-react';

interface HostRoomControlPanelProps {
  isOpen: boolean;
  onClose: () => void;
  room: MultiplayerRoom | null;
  currentUserId: string;
  onToggleVoiceMute: (playerId: string) => void;
  onToggleChatMute: (playerId: string) => void;
  onKickPlayer: (playerId: string) => void;
  onRotatePlayers: (nextActiveIds: string[]) => void;
}

export const HostRoomControlPanel: React.FC<HostRoomControlPanelProps> = ({
  isOpen,
  onClose,
  room,
  currentUserId,
  onToggleVoiceMute,
  onToggleChatMute,
  onKickPlayer,
  onRotatePlayers,
}) => {
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);

  const allParticipants = useMemo<RoomPlayer[]>(() => {
    if (!room) return [];
    const seen = new Set<string>();
    const list: RoomPlayer[] = [];
    for (const p of [...room.players, ...(room.waitingPlayers || [])]) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        list.push(p);
      }
    }
    return list;
  }, [room]);

  const seatLimit = useMemo(() => {
    if (!room) return 2;
    if (room.isOpenGroup) {
      return Math.max(2, Math.min(8, room.activeSeatLimit || (room.gameId === 'truth_dare' ? 6 : room.gameId === 'ludo' ? 4 : 2)));
    }
    return Math.max(2, room.maxPlayers || 2);
  }, [room]);

  useEffect(() => {
    if (isOpen && room) {
      setSelectedSeatIds(room.players.map((p) => p.id));
    }
  }, [isOpen, room?.roomCode, room?.players]);

  if (!isOpen || !room) return null;

  const isHost = room.hostId === currentUserId;
  const mutedVoiceIds = room.mutedVoiceIds || [];
  const mutedChatIds = room.mutedChatIds || [];
  const waitingPlayers = room.waitingPlayers || [];

  const toggleSeatSelection = (playerId: string) => {
    if (!isHost) return;
    setSelectedSeatIds((prev) => {
      if (prev.includes(playerId)) {
        if (prev.length <= 1) return prev; // Keep at least 1 active player
        return prev.filter((id) => id !== playerId);
      }
      if (prev.length >= seatLimit) {
        // Replace the last non-host seat cleanly if full
        const next = [...prev];
        const replaceIdx = next.findIndex((id) => id !== room.hostId);
        if (replaceIdx >= 0) {
          next.splice(replaceIdx, 1);
        } else {
          next.shift();
        }
        return [...next, playerId];
      }
      return [...prev, playerId];
    });
  };

  const handleQuickSwapWaiting = () => {
    if (!isHost || waitingPlayers.length === 0) return;
    const hostKeep = [room.hostId];
    const waitingIds = waitingPlayers.map((w) => w.id);
    const fillerActive = room.players.map((p) => p.id).filter((id) => id !== room.hostId);
    const combined = Array.from(new Set([...hostKeep, ...waitingIds, ...fillerActive])).slice(0, seatLimit);
    setSelectedSeatIds(combined);
  };

  const handleConfirmRotation = () => {
    if (!isHost || selectedSeatIds.length === 0) return;
    onRotatePlayers(selectedSeatIds);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/65 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-lg max-h-[90dvh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
                {isHost ? 'Host Room Controls & Seats' : `Room #${room.roomCode} Roster & Queue`}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {room.players.length}/{seatLimit} Active Seats · {waitingPlayers.length} in Waiting Seat
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close room panel"
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {isHost && (
            <div className="p-3.5 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 flex flex-wrap items-center justify-between gap-2.5">
              <div className="min-w-0">
                <p className="text-xs font-bold text-indigo-950 dark:text-indigo-200">
                  Next Match Seat Rotation
                </p>
                <p className="text-[11px] text-indigo-700 dark:text-indigo-300">
                  Select up to {seatLimit} players to take active seats for the next match.
                </p>
              </div>
              {waitingPlayers.length > 0 && (
                <button
                  type="button"
                  onClick={handleQuickSwapWaiting}
                  className="px-3 py-1.5 min-h-[36px] rounded-xl bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 text-[11px] font-bold text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5 hover:bg-indigo-100/60 transition-colors whitespace-nowrap"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  <span>Swap Waiting In</span>
                </button>
              )}
            </div>
          )}

          {/* Active Players */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-emerald-500" />
                <span>Active Seats ({room.players.length})</span>
              </h4>
              {isHost && (
                <span className="text-[11px] font-semibold text-slate-400">
                  Selected for next round: {selectedSeatIds.length}/{seatLimit}
                </span>
              )}
            </div>

            {room.players.map((p) => {
              const isPlayerHost = p.id === room.hostId;
              const isMe = p.id === currentUserId;
              const isVoiceMuted = mutedVoiceIds.includes(p.id);
              const isChatMuted = mutedChatIds.includes(p.id);
              const isPickedForNext = selectedSeatIds.includes(p.id);

              return (
                <div
                  key={p.id}
                  className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2.5"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {isHost && (
                      <button
                        type="button"
                        onClick={() => toggleSeatSelection(p.id)}
                        aria-label={`Select ${p.name} for next match`}
                        className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                          isPickedForNext
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {isPickedForNext && <Check className="w-3.5 h-3.5" />}
                      </button>
                    )}

                    <img
                      src={p.avatar || APP_CONFIG.logoUrl}
                      alt={p.name}
                      className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                    />

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {p.name} {isMe ? '(You)' : ''}
                        </p>
                        {isPlayerHost && (
                          <span className="px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-[10px] font-bold flex items-center gap-0.5 shrink-0">
                            <Crown className="w-2.5 h-2.5" /> Host
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                        Active Player {p.color ? `· ${p.color}` : ''}
                      </p>
                    </div>
                  </div>

                  {/* Moderation buttons (Host can mute voice/chat or kick non-host members) */}
                  {isHost && !isPlayerHost && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onToggleVoiceMute(p.id)}
                        title={isVoiceMuted ? 'Unmute Player Mic' : 'Mute Player Mic'}
                        className={`min-w-[38px] min-h-[38px] px-2.5 rounded-xl text-[11px] font-bold flex items-center gap-1 border transition-colors ${
                          isVoiceMuted
                            ? 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {isVoiceMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                        <span className="hidden sm:inline">{isVoiceMuted ? 'Mic Muted' : 'Mic'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onToggleChatMute(p.id)}
                        title={isChatMuted ? 'Allow Chat Messages' : 'Restrict Chat Messages'}
                        className={`min-w-[38px] min-h-[38px] px-2.5 rounded-xl text-[11px] font-bold flex items-center gap-1 border transition-colors ${
                          isChatMuted
                            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {isChatMuted ? (
                          <MessageSquareOff className="w-3.5 h-3.5" />
                        ) : (
                          <MessageSquare className="w-3.5 h-3.5" />
                        )}
                        <span className="hidden sm:inline">{isChatMuted ? 'Chat Off' : 'Chat'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onKickPlayer(p.id)}
                        title="Remove from Room"
                        aria-label={`Remove ${p.name} from room`}
                        className="min-w-[38px] min-h-[38px] p-2 rounded-xl bg-white dark:bg-slate-900 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 border border-slate-200 dark:border-slate-700 transition-colors"
                      >
                        <UserMinus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Waiting Seat Queue */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-500" />
              <span>Waiting Seat Queue ({waitingPlayers.length})</span>
            </h4>

            {waitingPlayers.length === 0 ? (
              <div className="p-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-center text-xs text-slate-400">
                No participants waiting right now. Extra players joining after seats fill enter the Waiting Seat automatically.
              </div>
            ) : (
              waitingPlayers.map((w, idx) => {
                const isMe = w.id === currentUserId;
                const isVoiceMuted = mutedVoiceIds.includes(w.id);
                const isChatMuted = mutedChatIds.includes(w.id);
                const isPickedForNext = selectedSeatIds.includes(w.id);

                return (
                  <div
                    key={w.id}
                    className="p-3 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-800/60 flex flex-wrap items-center justify-between gap-2.5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {isHost && (
                        <button
                          type="button"
                          onClick={() => toggleSeatSelection(w.id)}
                          aria-label={`Select ${w.name} for next match`}
                          className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                            isPickedForNext
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600'
                          }`}
                        >
                          {isPickedForNext && <Check className="w-3.5 h-3.5" />}
                        </button>
                      )}

                      <span className="text-[11px] font-mono font-bold text-amber-700 dark:text-amber-300 w-5 text-center shrink-0">
                        #{idx + 1}
                      </span>

                      <img
                        src={w.avatar || APP_CONFIG.logoUrl}
                        alt={w.name}
                        className="w-9 h-9 rounded-full object-cover border border-amber-200 dark:border-amber-700 shrink-0"
                      />

                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {w.name} {isMe ? '(You)' : ''}
                        </p>
                        <p className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold">
                          Waiting Seat · Can Talk & Chat
                        </p>
                      </div>
                    </div>

                    {isHost && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onToggleVoiceMute(w.id)}
                          title={isVoiceMuted ? 'Unmute Mic' : 'Mute Mic'}
                          className={`min-w-[38px] min-h-[38px] px-2.5 rounded-xl text-[11px] font-bold flex items-center gap-1 border transition-colors ${
                            isVoiceMuted
                              ? 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800'
                              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {isVoiceMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                        </button>

                        <button
                          type="button"
                          onClick={() => onToggleChatMute(w.id)}
                          title={isChatMuted ? 'Allow Chat' : 'Restrict Chat'}
                          className={`min-w-[38px] min-h-[38px] px-2.5 rounded-xl text-[11px] font-bold flex items-center gap-1 border transition-colors ${
                            isChatMuted
                              ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {isChatMuted ? (
                            <MessageSquareOff className="w-3.5 h-3.5" />
                          ) : (
                            <MessageSquare className="w-3.5 h-3.5" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => onKickPlayer(w.id)}
                          title="Remove from Room"
                          aria-label={`Remove ${w.name} from room`}
                          className="min-w-[38px] min-h-[38px] p-2 rounded-xl bg-white dark:bg-slate-900 text-red-500 hover:bg-red-50 border border-slate-200 dark:border-slate-700"
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2.5 shrink-0 bg-slate-50/70 dark:bg-slate-900">
          {isHost && allParticipants.length > 1 && (
            <button
              type="button"
              onClick={handleConfirmRotation}
              disabled={selectedSeatIds.length === 0}
              className="flex-1 sm:flex-none px-4 py-2.5 min-h-[44px] bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-md transition-colors whitespace-nowrap"
            >
              <ArrowRightLeft className="w-4 h-4" />
              <span>Assign Seats & Reset Match</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 min-h-[44px] bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold transition-colors whitespace-nowrap"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
