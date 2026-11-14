/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
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
  Sparkles,
} from 'lucide-react';

interface RoomLobbyModalProps {
  isOpen: boolean;
  room: MultiplayerRoom | null;
  currentUserId: string;
  onStartGame: () => void;
  onKickPlayer: (playerId: string) => void;
  onLeaveRoom: () => void;
  onClose: () => void;
}

export const RoomLobbyModal: React.FC<RoomLobbyModalProps> = ({
  isOpen,
  room,
  currentUserId,
  onStartGame,
  onKickPlayer,
  onLeaveRoom,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);

  if (!isOpen || !room) return null;

  const isHost = room.hostId === currentUserId;
  const canStart = isHost && room.players.length >= 2;
  const gameInfo = APP_CONFIG.games.find((g) => g.id === room.gameId);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(room.roomCode);
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
    navigator.clipboard.writeText(`${inviteText} - ${window.location.origin}/#room-${room.roomCode}`);
    setShareSuccess(true);
    setTimeout(() => setShareSuccess(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md animate-in fade-in">
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

            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleCopyCode}
                className="px-4 py-2 bg-white/20 hover:bg-white/30 active:scale-95 text-white font-bold text-xs rounded-xl backdrop-blur-md flex items-center gap-1.5 transition-all"
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
            <button
              type="button"
              onClick={onStartGame}
              disabled={!canStart}
              className="flex-1 py-2.5 text-xs font-bold rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-40 text-white shadow-md flex items-center justify-center gap-2 transition-all"
            >
              {room.players.length < 2 ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Waiting for Opponent</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  <span>Start Game Now</span>
                </>
              )}
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
