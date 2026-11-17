/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Video, RotateCcw, Loader2 } from 'lucide-react';
import { resolveLocalMediaUrl } from '../../services/mediaStorage';
import { fetchCloudChunkedVideoBlobUrl } from '../../lib/firebase';

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

function inferVideoMimeType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.startsWith('data:video/')) {
    const match = lower.match(/^data:(video\/[a-z0-9.+-]+);/);
    return match?.[1] || 'video/mp4';
  }
  const cleanPath = lower.split('?')[0].split('#')[0];
  if (cleanPath.endsWith('.webm')) return 'video/webm';
  if (cleanPath.endsWith('.ogv') || cleanPath.endsWith('.ogg')) return 'video/ogg';
  if (cleanPath.endsWith('.mov')) return 'video/quicktime';
  return 'video/mp4';
}

export const ResilientVideo: React.FC<ResilientVideoProps> = ({
  src,
  poster,
  className = 'w-full h-auto max-h-[440px] object-contain',
  containerClassName = '',
  controls = true,
  autoPlay = false,
  loop = false,
  muted = false,
  playsInline = true,
  videoRef,
  onError,
  onLoadedData,
}) => {
  const cleanSrc = typeof src === 'string' ? src.trim() : '';
  const isAsyncUri = cleanSrc.startsWith('idb://') || cleanSrc.startsWith('fschunk://');

  const [resolvedSrc, setResolvedSrc] = useState<string>(() =>
    cleanSrc && !isAsyncUri ? cleanSrc : ''
  );
  const [resolvingMedia, setResolvingMedia] = useState<boolean>(() => isAsyncUri);
  const [mediaMissing, setMediaMissing] = useState<boolean>(false);
  // First try CORS-enabled native playback (<source type="video/mp4"> + crossOrigin="anonymous").
  // If remote storage lacks Access-Control-Allow-Origin, transparently fall back to direct src without crossOrigin.
  const [playbackMode, setPlaybackMode] = useState<'cors_source' | 'direct_no_cors'>('cors_source');
  const [retrySeed, setRetrySeed] = useState(0);

  const internalVideoRef = useRef<HTMLVideoElement | null>(null);

  const setMergedVideoRef = (el: HTMLVideoElement | null) => {
    internalVideoRef.current = el;
    if (videoRef && 'current' in videoRef) {
      (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
    }
  };

  useEffect(() => {
    let cancelled = false;
    let createdLegacyIdbObjectUrl = '';
    setMediaMissing(false);
    setPlaybackMode('cors_source');

    if (!cleanSrc) {
      setResolvingMedia(false);
      setResolvedSrc('');
      return;
    }

    if (cleanSrc.startsWith('fschunk://')) {
      setResolvingMedia(true);
      fetchCloudChunkedVideoBlobUrl(cleanSrc)
        .then((url) => {
          if (cancelled) return;
          setResolvingMedia(false);
          if (!url) {
            setMediaMissing(true);
          }
          setResolvedSrc(url);
        })
        .catch(() => {
          if (!cancelled) {
            setResolvingMedia(false);
            setMediaMissing(true);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    if (!cleanSrc.startsWith('idb://')) {
      setResolvingMedia(false);
      setResolvedSrc(cleanSrc);
      return;
    }

    setResolvingMedia(true);
    resolveLocalMediaUrl(cleanSrc)
      .then((url) => {
        if (cancelled) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url);
          return;
        }
        setResolvingMedia(false);
        if (url.startsWith('blob:')) {
          createdLegacyIdbObjectUrl = url;
        }
        if (!url) {
          setMediaMissing(true);
        }
        setResolvedSrc(url);
      })
      .catch(() => {
        if (!cancelled) {
          setResolvingMedia(false);
          setMediaMissing(true);
        }
      });

    return () => {
      cancelled = true;
      if (createdLegacyIdbObjectUrl) {
        URL.revokeObjectURL(createdLegacyIdbObjectUrl);
      }
    };
  }, [cleanSrc, retrySeed]);

  useEffect(() => {
    const el = internalVideoRef.current;
    if (el && resolvedSrc) {
      try {
        el.load();
      } catch {
        // Ignore load errors
      }
    }
  }, [resolvedSrc, playbackMode]);

  const handleVideoError = () => {
    if (playbackMode === 'cors_source' && resolvedSrc) {
      setPlaybackMode('direct_no_cors');
      return;
    }
    onError?.();
  };

  const handleRetryVideo = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMediaMissing(false);
    setPlaybackMode('cors_source');
    setRetrySeed((n) => n + 1);
  };

  if (!cleanSrc) {
    return null;
  }

  if (resolvingMedia || mediaMissing || !resolvedSrc) {
    return (
      <div
        className={`relative w-full min-h-[190px] flex flex-col items-center justify-center bg-slate-900 text-slate-200 p-4 text-center ${containerClassName}`}
      >
        {poster && (
          <img
            src={poster}
            alt="Video poster"
            className="absolute inset-0 w-full h-full object-cover opacity-55"
          />
        )}
        <div className="relative z-10 flex flex-col items-center gap-2 bg-slate-900/75 backdrop-blur-sm px-4 py-3 rounded-2xl border border-white/15">
          {resolvingMedia ? (
            <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
          ) : (
            <Video className="w-6 h-6 text-blue-400" />
          )}
          <p className="text-xs font-semibold text-white">
            {resolvingMedia
              ? 'Loading video...'
              : 'Video unavailable on cloud — tap reload'}
          </p>
          {!resolvingMedia && (
            <button
              type="button"
              onClick={handleRetryVideo}
              className="mt-0.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-[11px] font-semibold text-white transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Reload
            </button>
          )}
        </div>
      </div>
    );
  }

  const videoMimeType = inferVideoMimeType(resolvedSrc);
  const useCors = playbackMode === 'cors_source' && !resolvedSrc.startsWith('blob:') && !resolvedSrc.startsWith('data:');

  if (!controls) {
    return (
      <video
        key={`${resolvedSrc}_${playbackMode}`}
        ref={setMergedVideoRef}
        src={playbackMode === 'direct_no_cors' ? resolvedSrc : undefined}
        poster={poster || undefined}
        controls={false}
        autoPlay={autoPlay}
        loop={loop}
        muted={muted}
        playsInline={playsInline}
        preload="metadata"
        crossOrigin={useCors ? 'anonymous' : undefined}
        onLoadedData={onLoadedData}
        onError={handleVideoError}
        className={className}
      >
        {playbackMode === 'cors_source' && (
          <source src={resolvedSrc} type={videoMimeType} />
        )}
      </video>
    );
  }

  return (
    <div
      className={`relative w-full bg-slate-950 overflow-hidden flex items-center justify-center ${containerClassName}`}
      onClick={(e) => e.stopPropagation()}
    >
      <video
        key={`${resolvedSrc}_${playbackMode}`}
        ref={setMergedVideoRef}
        src={playbackMode === 'direct_no_cors' ? resolvedSrc : undefined}
        poster={poster || undefined}
        controls
        autoPlay={autoPlay}
        loop={loop}
        muted={muted}
        playsInline={playsInline}
        preload="metadata"
        crossOrigin={useCors ? 'anonymous' : undefined}
        onLoadedData={onLoadedData}
        onError={handleVideoError}
        className={`w-full block mx-auto ${className}`}
      >
        <source src={resolvedSrc} type={videoMimeType} />
      </video>
    </div>
  );
};
