/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Mic, MicOff, Volume2, VolumeX, Radio, Loader2, AlertCircle, X } from 'lucide-react';
import { GameMode } from '../../types/multiplayer';
import { FirestoreVoicePeer } from '../../lib/firebase';
import { APP_CONFIG } from '../../constants/branding';

interface InGameVoiceHudProps {
  gameMode: GameMode;
  roomCode?: string;
  isMicEnabled: boolean;
  isSpeakerEnabled: boolean;
  isConnectingMic: boolean;
  isSpeaking: boolean;
  isHostMutedMic?: boolean;
  hostMutedVoiceIds?: string[];
  voiceError: string | null;
  voicePeers: FirestoreVoicePeer[];
  localPlayerId: string;
  onToggleMic: () => void;
  onToggleSpeaker: () => void;
  onClearError: () => void;
}

export const InGameVoiceHud: React.FC<InGameVoiceHudProps> = ({
  gameMode,
  roomCode,
  isMicEnabled,
  isSpeakerEnabled,
  isConnectingMic,
  isSpeaking,
  isHostMutedMic = false,
  hostMutedVoiceIds = [],
  voiceError,
  voicePeers,
  localPlayerId,
  onToggleMic,
  onToggleSpeaker,
  onClearError,
}) => {
  const sanitizedLocalId = (localPlayerId || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 72);
  const remotePeers = voicePeers.filter(
    (p) => p.peerId !== localPlayerId && p.peerId !== sanitizedLocalId
  );
  const activeTalkingPeers = remotePeers.filter(
    (p) => p.micEnabled && !hostMutedVoiceIds.includes(p.peerId)
  );

  return (
    <div className="w-full mb-4 space-y-2">
      <div className="w-full bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white border border-slate-700/80 rounded-2xl px-3 py-2.5 shadow-md flex flex-wrap items-center justify-between gap-2.5">
        {/* Left: Channel Status & Live Peers */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
              isMicEnabled
                ? isSpeaking
                  ? 'bg-emerald-500 text-white ring-4 ring-emerald-400/30 animate-pulse'
                  : 'bg-emerald-600/80 text-white'
                : 'bg-slate-700/80 text-slate-300'
            }`}
          >
            <Radio className="w-4 h-4" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white truncate">
                {roomCode
                  ? `Live Voice · Room #${roomCode.length > 8 ? roomCode.slice(0, 6).toUpperCase() : roomCode}`
                  : 'Voice Chat HUD'}
              </span>
              {gameMode !== 'ai' && roomCode && (
                <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                  WebRTC Sync
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-300 truncate">
              {isHostMutedMic
                ? 'Host muted your mic — you can still listen'
                : roomCode
                ? remotePeers.length > 0
                  ? activeTalkingPeers.length > 0
                    ? `${activeTalkingPeers.map((p) => p.name.split(' ')[0]).join(', ')} mic live`
                    : `${remotePeers.length} peer${remotePeers.length > 1 ? 's' : ''} connected`
                  : 'Waiting for room peers to connect audio...'
                : isMicEnabled
                ? isSpeaking
                  ? 'Mic active — voice detected'
                  : 'Mic live (Solo / AI mode)'
                : 'Tap Mic to talk or Speaker to mute audio'}
            </p>
          </div>

          {/* Connected peer avatars on wider screens */}
          {remotePeers.length > 0 && (
            <div className="hidden sm:flex items-center -space-x-1.5 pl-1">
              {remotePeers.slice(0, 3).map((peer) => {
                const peerHostMuted = hostMutedVoiceIds.includes(peer.peerId);
                return (
                  <div
                    key={peer.peerId}
                    className="relative"
                    title={`${peer.name} (${peerHostMuted ? 'Host Muted' : peer.micEnabled ? 'Mic On' : 'Muted'})`}
                  >
                    <img
                      src={peer.avatar || APP_CONFIG.logoUrl}
                      alt={peer.name}
                      className={`w-6 h-6 rounded-full object-cover border-2 ${
                        peerHostMuted
                          ? 'border-red-500'
                          : peer.micEnabled
                          ? 'border-emerald-400'
                          : 'border-slate-600'
                      }`}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Interactive Mic & Speaker Toggle Controls */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <button
            type="button"
            onClick={onToggleMic}
            disabled={isConnectingMic || isHostMutedMic}
            aria-pressed={isMicEnabled}
            aria-label={isHostMutedMic ? 'Microphone muted by host' : isMicEnabled ? 'Mute Microphone' : 'Unmute Microphone'}
            className={`px-3 py-1.5 min-h-[38px] rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 whitespace-nowrap ${
              isHostMutedMic
                ? 'bg-red-950/60 text-red-300 border border-red-700/60 cursor-not-allowed'
                : isMicEnabled
                ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm shadow-emerald-500/30'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600'
            }`}
          >
            {isConnectingMic ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : isMicEnabled && !isHostMutedMic ? (
              <Mic className="w-3.5 h-3.5" />
            ) : (
              <MicOff className="w-3.5 h-3.5 text-red-400" />
            )}
            <span>{isHostMutedMic ? 'Host Muted' : isMicEnabled ? 'Mic On' : 'Mic Off'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleSpeaker}
            aria-pressed={isSpeakerEnabled}
            aria-label={isSpeakerEnabled ? 'Turn Speaker Off' : 'Turn Speaker On'}
            className={`px-3 py-1.5 min-h-[38px] rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 ${
              isSpeakerEnabled
                ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-600/30'
                : 'bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40'
            }`}
          >
            {isSpeakerEnabled ? (
              <Volume2 className="w-3.5 h-3.5" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
            <span>{isSpeakerEnabled ? 'Speaker On' : 'Speaker Off'}</span>
          </button>
        </div>
      </div>

      {voiceError && (
        <div className="px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl flex items-center justify-between gap-2 text-[11px] text-amber-800 dark:text-amber-300">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{voiceError}</span>
          </div>
          <button
            type="button"
            onClick={onClearError}
            aria-label="Dismiss voice notice"
            className="p-0.5 hover:opacity-70 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
