/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Video,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { resolveLocalMediaUrl } from '../../services/mediaStorage';

interface ResilientVideoProps {
  src?: string;
  poster?: string;
  className?: string;
  containerClassName?: string;
  controls?: boolean;
  compactControls?: boolean;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  playsInline?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onError?: () => void;
  onLoadedData?: () => void;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const ResilientVideo: React.FC<ResilientVideoProps> = ({
  src,
  poster,
  className = 'w-full h-auto max-h-[440px] object-contain',
  containerClassName = '',
  controls = true,
  compactControls = false,
  autoPlay = false,
  loop = false,
  muted = false,
  playsInline = true,
  videoRef,
  onError,
  onLoadedData,
}) => {
  const cleanSrc = typeof src === 'string' ? src.trim() : '';
  const [resolvedSrc, setResolvedSrc] = useState<string>(() =>
    cleanSrc && !cleanSrc.startsWith('idb://') ? cleanSrc : ''
  );
  const [failed, setFailed] = useState(false);

  const internalVideoRef = useRef<HTMLVideoElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(autoPlay);
  const [isMuted, setIsMuted] = useState<boolean>(muted);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const setMergedVideoRef = (el: HTMLVideoElement | null) => {
    internalVideoRef.current = el;
    if (videoRef && 'current' in videoRef) {
      (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
    }
  };

  useEffect(() => {
    let cancelled = false;
    let createdObjectUrl = '';
    setFailed(false);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(autoPlay);

    if (!cleanSrc) {
      setResolvedSrc('');
      return;
    }

    if (!cleanSrc.startsWith('idb://')) {
      setResolvedSrc(cleanSrc);
      return;
    }

    resolveLocalMediaUrl(cleanSrc)
      .then((url) => {
        if (cancelled) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url);
          return;
        }
        if (url.startsWith('blob:')) {
          createdObjectUrl = url;
        }
        if (!url) {
          setFailed(true);
        }
        setResolvedSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (createdObjectUrl) {
        URL.revokeObjectURL(createdObjectUrl);
      }
    };
  }, [cleanSrc, autoPlay]);

  useEffect(() => {
    setIsMuted(muted);
  }, [muted]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement && wrapperRef.current === document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const togglePlay = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const el = internalVideoRef.current;
    if (!el) return;
    if (el.paused || el.ended) {
      try {
        await el.play();
        setIsPlaying(true);
      } catch {
        // Autoplay or playback gesture retry
      }
    } else {
      el.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = internalVideoRef.current;
    if (!el) return;
    const nextMuted = !el.muted;
    el.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const el = internalVideoRef.current;
    if (!el) return;
    const nextTime = Number(e.target.value);
    if (Number.isFinite(nextTime)) {
      el.currentTime = nextTime;
      setCurrentTime(nextTime);
    }
  };

  const toggleFullscreen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const container = wrapperRef.current;
    const videoEl = internalVideoRef.current;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (container?.requestFullscreen) {
        await container.requestFullscreen();
      } else if ((videoEl as any)?.webkitEnterFullscreen) {
        (videoEl as any).webkitEnterFullscreen();
      }
    } catch {
      // Ignore fullscreen denial
    }
  };

  if (failed || !resolvedSrc) {
    return (
      <div
        className={`relative w-full min-h-[180px] flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 p-4 text-center ${containerClassName}`}
      >
        {poster && (
          <img
            src={poster}
            alt="Video preview"
            className="absolute inset-0 w-full h-full object-cover opacity-30"
          />
        )}
        <div className="relative z-10 flex flex-col items-center gap-2 bg-slate-900/75 backdrop-blur-sm px-4 py-3 rounded-2xl border border-white/10">
          <Video className="w-6 h-6 text-blue-400" />
          <p className="text-xs font-semibold text-white">
            {cleanSrc?.startsWith('idb://') && !failed
              ? 'Loading video...'
              : 'Video unavailable or expired'}
          </p>
        </div>
      </div>
    );
  }

  // Raw passthrough mode (used inside ReelsView & small loop thumbnails with external overlays)
  if (!controls) {
    return (
      <video
        ref={setMergedVideoRef}
        src={resolvedSrc}
        poster={poster || undefined}
        controls={false}
        autoPlay={autoPlay}
        loop={loop}
        muted={muted}
        playsInline={playsInline}
        preload="metadata"
        onLoadedData={onLoadedData}
        onError={() => {
          setFailed(true);
          onError?.();
        }}
        className={className}
      />
    );
  }

  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div
      ref={wrapperRef}
      onClick={togglePlay}
      className={`group relative w-full bg-slate-950 overflow-hidden flex flex-col justify-center cursor-pointer select-none ${
        isFullscreen ? 'h-full max-h-none' : ''
      } ${containerClassName}`}
    >
      <video
        ref={setMergedVideoRef}
        src={resolvedSrc}
        poster={poster || undefined}
        controls={false}
        autoPlay={autoPlay}
        loop={loop}
        muted={isMuted}
        playsInline={playsInline}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration || 0);
        }}
        onLoadedData={() => {
          if (internalVideoRef.current?.duration) {
            setDuration(internalVideoRef.current.duration);
          }
          onLoadedData?.();
        }}
        onError={() => {
          setFailed(true);
          onError?.();
        }}
        className={`w-full block mx-auto ${isFullscreen ? 'max-h-[calc(100vh-64px)] object-contain' : className}`}
      />

      {/* Center Play Overlay when paused */}
      {!isPlaying && (
        <div className="pointer-events-none absolute inset-0 bottom-11 flex items-center justify-center bg-slate-950/20 transition-opacity">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-slate-900/75 hover:bg-blue-600/90 backdrop-blur-md text-white flex items-center justify-center border border-white/20 shadow-lg">
            <Play className="w-5 h-5 sm:w-6 sm:h-6 fill-white ml-0.5" />
          </div>
        </div>
      )}

      {/* Custom HTML5 Video Controls Bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full bg-slate-950/92 backdrop-blur-md border-t border-white/10 text-white flex items-center gap-2 shrink-0 ${
          compactControls ? 'px-2.5 py-1.5' : 'px-3 py-2'
        }`}
      >
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause video' : 'Play video'}
          className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg hover:bg-white/15 transition-colors shrink-0"
        >
          {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
        </button>

        {/* Scrubber Track */}
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <input
            type="range"
            min={0}
            max={duration > 0 ? duration : 100}
            step={0.1}
            value={Math.min(currentTime, duration > 0 ? duration : 100)}
            onChange={handleSeek}
            aria-label="Seek video progress"
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-blue-500"
            style={{
              background: `linear-gradient(to right, #3b82f6 ${progressPct}%, rgba(255,255,255,0.22) ${progressPct}%)`,
            }}
          />
        </div>

        {/* Time Display */}
        <span className="text-[11px] font-mono tabular-nums text-slate-300 shrink-0 hidden xs:inline sm:inline">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {/* Mute Toggle */}
        <button
          type="button"
          onClick={toggleMute}
          aria-label={isMuted ? 'Unmute video' : 'Mute video'}
          className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg hover:bg-white/15 transition-colors shrink-0"
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-slate-300" /> : <Volume2 className="w-4 h-4 text-white" />}
        </button>

        {/* Fullscreen Toggle */}
        {!compactControls && (
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg hover:bg-white/15 transition-colors shrink-0"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );
};
