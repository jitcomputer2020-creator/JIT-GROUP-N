/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Video } from 'lucide-react';
import { resolveLocalMediaUrl } from '../../services/mediaStorage';

interface ResilientVideoProps {
  src?: string;
  poster?: string;
  className?: string;
  controls?: boolean;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  playsInline?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onError?: () => void;
  onLoadedData?: () => void;
}

export const ResilientVideo: React.FC<ResilientVideoProps> = ({
  src,
  poster,
  className = 'w-full h-full object-contain',
  controls = true,
  autoPlay = false,
  loop = false,
  muted = false,
  playsInline = true,
  videoRef,
  onError,
  onLoadedData,
}) => {
  const [resolvedSrc, setResolvedSrc] = useState<string>(() =>
    src && !src.startsWith('idb://') ? src : ''
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let createdObjectUrl = '';
    setFailed(false);

    if (!src) {
      setResolvedSrc('');
      return;
    }

    if (!src.startsWith('idb://')) {
      setResolvedSrc(src);
      return;
    }

    resolveLocalMediaUrl(src)
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
  }, [src]);

  if (failed || !resolvedSrc) {
    return (
      <div className="relative w-full h-full min-h-[180px] flex flex-col items-center justify-center bg-slate-950 text-slate-300 p-4 text-center">
        {poster && (
          <img
            src={poster}
            alt="Video preview"
            className="absolute inset-0 w-full h-full object-cover opacity-35"
          />
        )}
        <div className="relative z-10 flex flex-col items-center gap-2 bg-black/55 backdrop-blur-sm px-4 py-3 rounded-2xl border border-white/10">
          <Video className="w-6 h-6 text-purple-400" />
          <p className="text-xs font-semibold text-white">
            {src?.startsWith('idb://') && !failed
              ? 'Loading video...'
              : 'Video unavailable or expired'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <video
      ref={videoRef as React.RefObject<HTMLVideoElement>}
      src={resolvedSrc}
      poster={poster || undefined}
      controls={controls}
      autoPlay={autoPlay}
      loop={loop}
      muted={muted}
      playsInline={playsInline}
      onLoadedData={onLoadedData}
      onError={() => {
        setFailed(true);
        onError?.();
      }}
      className={className}
    />
  );
};
