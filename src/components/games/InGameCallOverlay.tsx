/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { InGameCallState } from '../../types/multiplayer';
import { APP_CONFIG } from '../../constants/branding';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  SwitchCamera,
  Maximize2,
  Minimize2,
  Phone,
  AlertCircle,
  Users,
} from 'lucide-react';

interface InGameCallOverlayProps {
  callType: 'voice' | 'video';
  isActive: boolean;
  onEndCall: () => void;
  callerName?: string;
  callerAvatar?: string;
}

export const InGameCallOverlay: React.FC<InGameCallOverlayProps> = ({
  callType,
  isActive,
  onEndCall,
  callerName = 'Room Opponent',
  callerAvatar,
}) => {
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [isMinimized, setIsMinimized] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Acquire camera & microphone media stream with real browser getUserMedia
  useEffect(() => {
    if (!isActive) {
      cleanupStream();
      setCallDuration(0);
      return;
    }

    let isMounted = true;
    setPermissionError(null);

    const initMedia = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Media devices (Microphone/Camera) not supported in this browser environment.');
        }

        const constraints: MediaStreamConstraints = {
          audio: true,
          video:
            callType === 'video'
              ? {
                  facingMode: { ideal: facingMode },
                  width: { ideal: 640 },
                  height: { ideal: 480 },
                }
              : false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err: unknown) {
        const errorMsg =
          err instanceof Error
            ? err.message
            : 'Permission denied or media hardware unavailable.';
        setPermissionError(errorMsg);
      }
    };

    initMedia();

    // Call timer
    const interval = setInterval(() => {
      setCallDuration((d) => d + 1);
    }, 1000);

    return () => {
      isMounted = false;
      clearInterval(interval);
      cleanupStream();
    };
  }, [isActive, callType, facingMode]);

  const cleanupStream = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = isMicMuted;
      });
      setIsMicMuted(!isMicMuted);
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current && callType === 'video') {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = isVideoMuted;
      });
      setIsVideoMuted(!isVideoMuted);
    }
  };

  const switchCamera = async () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  };

  if (!isActive) return null;

  // Minimized Floating Pill View (Keeps game 100% accessible)
  if (isMinimized) {
    return (
      <div className="fixed bottom-20 right-4 z-50 bg-slate-900/95 text-white border border-slate-700 rounded-2xl p-2.5 shadow-2xl backdrop-blur-md flex items-center gap-3 animate-in fade-in">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-mono font-bold">{formatTime(callDuration)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleMic}
            className={`p-1.5 rounded-lg ${isMicMuted ? 'bg-red-500' : 'bg-slate-800'}`}
          >
            {isMicMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700"
            title="Expand Call"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onEndCall}
            className="p-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white"
            title="End Call"
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // Expanded Docked View
  return (
    <div className="fixed top-16 right-3 sm:right-6 z-50 w-72 sm:w-80 bg-slate-900/95 text-white border border-slate-700 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-md flex flex-col animate-in zoom-in-95">
      {/* Call Header */}
      <div className="p-3 bg-slate-800/80 flex items-center justify-between border-b border-slate-700">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold capitalize">
            Live {callType} Call ({formatTime(callDuration)})
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsMinimized(true)}
            className="p-1 text-slate-400 hover:text-white rounded-lg"
            title="Dock to corner"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Permission Warning */}
      {permissionError && (
        <div className="p-2.5 bg-red-950/80 text-red-300 text-[11px] flex items-start gap-2 border-b border-red-900/50">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{permissionError} (Simulated audio channel enabled).</span>
        </div>
      )}

      {/* Video Screens or Audio Avatar Display */}
      {callType === 'video' ? (
        <div className="relative aspect-[4/3] bg-black flex items-center justify-center overflow-hidden">
          {/* Local user camera feed */}
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${isVideoMuted ? 'hidden' : 'block'}`}
          />

          {isVideoMuted && (
            <div className="flex flex-col items-center justify-center text-slate-400 p-4">
              <VideoOff className="w-10 h-10 mb-2" />
              <p className="text-xs">Your camera is turned off</p>
            </div>
          )}

          {/* Opponent PIP feed / avatar badge */}
          <div className="absolute top-2.5 right-2.5 w-20 h-20 rounded-2xl overflow-hidden border-2 border-white/50 bg-slate-800 shadow-lg flex flex-col items-center justify-center p-1 text-center">
            <img
              src={callerAvatar || APP_CONFIG.logoUrl}
              alt="Opponent"
              className="w-10 h-10 rounded-full object-cover border border-white mb-0.5"
            />
            <span className="text-[9px] font-bold text-white truncate max-w-[70px]">
              {callerName}
            </span>
          </div>

          <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 rounded-md text-[10px] text-white/80">
            You ({facingMode})
          </div>
        </div>
      ) : (
        <div className="p-6 flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800 space-y-3">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-blue-600 to-emerald-500 p-1 flex items-center justify-center animate-pulse">
              <img
                src={callerAvatar || APP_CONFIG.logoUrl}
                alt={callerName}
                className="w-full h-full rounded-full object-cover"
              />
            </div>
          </div>
          <div className="text-center">
            <h4 className="text-sm font-bold text-white">{callerName}</h4>
            <p className="text-[11px] text-emerald-400 font-medium">Voice Connected</p>
          </div>
        </div>
      )}

      {/* Control Buttons Bar */}
      <div className="p-3 bg-slate-900 flex items-center justify-around border-t border-slate-800">
        {/* Mic Toggle */}
        <button
          type="button"
          onClick={toggleMic}
          className={`p-3 rounded-2xl transition-colors ${
            isMicMuted ? 'bg-red-500 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
          title={isMicMuted ? 'Unmute Mic' : 'Mute Mic'}
        >
          {isMicMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        {/* Video Toggle (Video Calls only) */}
        {callType === 'video' && (
          <>
            <button
              type="button"
              onClick={toggleVideo}
              className={`p-3 rounded-2xl transition-colors ${
                isVideoMuted ? 'bg-red-500 text-white' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
              title={isVideoMuted ? 'Turn Camera On' : 'Turn Camera Off'}
            >
              {isVideoMuted ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={switchCamera}
              className="p-3 rounded-2xl bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors"
              title="Switch Front/Back Camera"
            >
              <SwitchCamera className="w-4 h-4" />
            </button>
          </>
        )}

        {/* End Call */}
        <button
          type="button"
          onClick={onEndCall}
          className="p-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/30 transition-colors"
          title="End Call"
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
