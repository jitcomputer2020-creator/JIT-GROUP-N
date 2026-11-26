/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { memo, useEffect, useRef, useState } from 'react';
import { Video, RotateCcw, Loader2 } from 'lucide-react';
import { resolveLocalMediaUrl } from '../../services/mediaStorage';
import { fetchCloudChunkedVideoBlobUrl } from '../../lib/firebase';
import { isValidImageUrl, isValidVideoUrl } from '../../lib/mediaValidation';

// Session cache of broken video URLs so failed cards never loop network requests on re-renders
const failedVideoCache = new Set<string>();

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
  priority?: boolean;
  hideOnInvalid?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onError?: () => void;
  onLoadedData?: () => void;
}

export const ResilientVideo: React.FC<ResilientVideoProps> = memo(
  ({
    src,
    poster,
    className = 'w-full h-auto max-h-[440px] object-contain',
    containerClassName = '',
    controls = true,
    autoPlay = false,
    loop = false,
    muted = false,
    playsInline = true,
    priority = false,
    hideOnInvalid = false,
    videoRef,
    onError,
    onLoadedData,
  }) => {
    const cleanSrc = typeof src === 'string' ? src.trim() : '';
    const hasValidSrc = isValidVideoUrl(cleanSrc);
    const safePoster = isValidImageUrl(poster) ? poster.trim() : undefined;
    const isAsyncUri =
      hasValidSrc && (cleanSrc.startsWith('idb://') || cleanSrc.startsWith('fschunk://'));

    const [resolvedSrc, setResolvedSrc] = useState<string>(() =>
      hasValidSrc && !isAsyncUri && !failedVideoCache.has(cleanSrc) ? cleanSrc : ''
    );
    const [resolvingMedia, setResolvingMedia] = useState<boolean>(
      () => isAsyncUri && !failedVideoCache.has(cleanSrc)
    );
    const [isVideoReady, setIsVideoReady] = useState<boolean>(false);
    const [mediaMissing, setMediaMissing] = useState<boolean>(() =>
      Boolean(cleanSrc && hasValidSrc && failedVideoCache.has(cleanSrc))
    );
    const [retrySeed, setRetrySeed] = useState(0);

    const internalVideoRef = useRef<HTMLVideoElement | null>(null);

    const setMergedVideoRef = (el: HTMLVideoElement | null) => {
      internalVideoRef.current = el;
      if (videoRef && 'current' in videoRef) {
        (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
      }
      if (el && el.readyState >= 1) {
        setIsVideoReady(true);
      }
    };

    useEffect(() => {
      let cancelled = false;
      setIsVideoReady(false);

      if (!cleanSrc || !hasValidSrc) {
        setMediaMissing(false);
        setResolvingMedia(false);
        setResolvedSrc('');
        return;
      }

      if (failedVideoCache.has(cleanSrc)) {
        setResolvingMedia(false);
        setMediaMissing(true);
        setResolvedSrc('');
        return;
      }

      setMediaMissing(false);

      if (cleanSrc.startsWith('fschunk://')) {
        setResolvingMedia(true);
        fetchCloudChunkedVideoBlobUrl(cleanSrc)
          .then((url) => {
            if (cancelled) return;
            setResolvingMedia(false);
            if (!url) {
              failedVideoCache.add(cleanSrc);
              setMediaMissing(true);
            }
            setResolvedSrc(url);
          })
          .catch(() => {
            if (!cancelled) {
              failedVideoCache.add(cleanSrc);
              setResolvingMedia(false);
              setMediaMissing(true);
            }
          });
        return () => {
          cancelled = true;
        };
      }

      if (cleanSrc.startsWith('idb://')) {
        setResolvingMedia(true);
        resolveLocalMediaUrl(cleanSrc)
          .then((url) => {
            if (cancelled) return;
            setResolvingMedia(false);
            if (!url) {
              failedVideoCache.add(cleanSrc);
              setMediaMissing(true);
            }
            setResolvedSrc(url);
          })
          .catch(() => {
            if (!cancelled) {
              failedVideoCache.add(cleanSrc);
              setResolvingMedia(false);
              setMediaMissing(true);
            }
          });
        return () => {
          cancelled = true;
        };
      }

      setResolvingMedia(false);
      setResolvedSrc(cleanSrc);
      return () => {
        cancelled = true;
      };
    }, [cleanSrc, hasValidSrc, retrySeed]);

    const handleVideoReady = () => {
      failedVideoCache.delete(cleanSrc);
      setIsVideoReady(true);
      onLoadedData?.();
    };

    const handleVideoError = () => {
      if (cleanSrc) {
        failedVideoCache.add(cleanSrc);
      }
      setMediaMissing(true);
      onError?.();
    };

    const handleRetryVideo = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (cleanSrc) {
        failedVideoCache.delete(cleanSrc);
      }
      setMediaMissing(false);
      setIsVideoReady(false);
      setRetrySeed((n) => n + 1);
    };

    if (!cleanSrc) {
      return null;
    }

    // Invalid or placeholder video URL (e.g., `/sample_post.mp4`): never mount <video> or fetch network
    if (!hasValidSrc) {
      if (hideOnInvalid) {
        return null;
      }
      return (
        <div
          className={`relative w-full min-h-[160px] flex flex-col items-center justify-center bg-slate-900 text-slate-200 p-4 text-center ${containerClassName}`}
        >
          {safePoster && (
            <img
              src={safePoster}
              alt="Video poster"
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover opacity-55"
            />
          )}
          <div className="relative z-10 flex flex-col items-center gap-2 bg-slate-900/90 px-4 py-3 rounded-2xl border border-white/15">
            <Video className="w-6 h-6 text-slate-400" />
            <p className="text-xs font-semibold text-white">Video preview unavailable</p>
          </div>
        </div>
      );
    }

    if (resolvingMedia || mediaMissing || !resolvedSrc) {
      if (mediaMissing && hideOnInvalid && !resolvingMedia) {
        return null;
      }
      return (
        <div
          className={`relative w-full min-h-[190px] flex flex-col items-center justify-center bg-slate-900 text-slate-200 p-4 text-center ${containerClassName}`}
        >
          {safePoster && (
            <img
              src={safePoster}
              alt="Video poster"
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover opacity-55"
            />
          )}
          <div className="relative z-10 flex flex-col items-center gap-2 bg-slate-900/90 px-4 py-3 rounded-2xl border border-white/15">
            {resolvingMedia ? (
              <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
            ) : (
              <Video className="w-6 h-6 text-blue-400" />
            )}
            <p className="text-xs font-semibold text-white">
              {resolvingMedia ? 'Loading video...' : 'Video unavailable — tap reload'}
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

    const preloadStrategy = priority || autoPlay ? 'auto' : 'metadata';

    if (!controls) {
      return (
        <video
          key={`${resolvedSrc}_${retrySeed}`}
          ref={setMergedVideoRef}
          src={resolvedSrc}
          poster={safePoster}
          controls={false}
          autoPlay={autoPlay}
          loop={loop}
          muted={muted}
          playsInline={playsInline}
          preload={preloadStrategy}
          onLoadedMetadata={handleVideoReady}
          onLoadedData={handleVideoReady}
          onCanPlay={handleVideoReady}
          onError={handleVideoError}
          className={className}
        />
      );
    }

    return (
      <div
        className={`relative w-full bg-slate-950 overflow-hidden flex items-center justify-center ${containerClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {!isVideoReady && (
          <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center bg-slate-900/60 animate-pulse">
            {safePoster ? (
              <img
                src={safePoster}
                alt="Video poster"
                loading={priority ? 'eager' : 'lazy'}
                decoding="async"
                className="w-full h-full object-cover opacity-80"
              />
            ) : (
              <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
            )}
          </div>
        )}
        <video
          key={`${resolvedSrc}_${retrySeed}`}
          ref={setMergedVideoRef}
          src={resolvedSrc}
          poster={safePoster}
          controls
          autoPlay={autoPlay}
          loop={loop}
          muted={muted}
          playsInline={playsInline}
          preload={preloadStrategy}
          onLoadedMetadata={handleVideoReady}
          onLoadedData={handleVideoReady}
          onCanPlay={handleVideoReady}
          onError={handleVideoError}
          className={`w-full block mx-auto transition-opacity duration-200 ${
            isVideoReady ? 'opacity-100' : 'opacity-90'
          } ${className}`}
        />
      </div>
    );
  }
);
