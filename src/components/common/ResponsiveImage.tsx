/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { resolveLocalMediaUrl } from '../../services/mediaStorage';
import { isValidImageUrl } from '../../lib/mediaValidation';

// Session-level caches to prevent flickering skeletons on cached URLs and infinite retries on broken URLs
const loadedImageCache = new Set<string>();
const failedImageCache = new Set<string>();

interface ResponsiveImageProps {
  src?: string;
  alt?: string;
  fit?: 'contain' | 'cover';
  priority?: boolean;
  loading?: 'lazy' | 'eager';
  className?: string;
  containerClassName?: string;
  fallbackText?: string;
  onClick?: () => void;
}

export const ResponsiveImage: React.FC<ResponsiveImageProps> = memo(
  ({
    src,
    alt = 'Attachment',
    fit = 'contain',
    priority = false,
    loading,
    className,
    containerClassName = '',
    fallbackText = 'Image unavailable',
    onClick,
  }) => {
    const cleanSrc = typeof src === 'string' ? src.trim() : '';
    const hasValidSrc = isValidImageUrl(cleanSrc);
    const isIdbUri = hasValidSrc && cleanSrc.startsWith('idb://');

    const [resolvedSrc, setResolvedSrc] = useState<string>(() =>
      hasValidSrc && !isIdbUri && !failedImageCache.has(cleanSrc) ? cleanSrc : ''
    );
    const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(() => {
      if (!hasValidSrc || failedImageCache.has(cleanSrc)) return 'error';
      if (loadedImageCache.has(cleanSrc)) return 'loaded';
      return 'loading';
    });

    const imgRef = useRef<HTMLImageElement | null>(null);

    useEffect(() => {
      let cancelled = false;

      if (!hasValidSrc || failedImageCache.has(cleanSrc)) {
        setResolvedSrc('');
        setStatus('error');
        return;
      }

      if (!isIdbUri) {
        setResolvedSrc(cleanSrc);
        setStatus(loadedImageCache.has(cleanSrc) ? 'loaded' : 'loading');
        return;
      }

      if (loadedImageCache.has(cleanSrc)) {
        setStatus('loaded');
      } else {
        setStatus('loading');
      }

      resolveLocalMediaUrl(cleanSrc)
        .then((url) => {
          if (cancelled) return;
          if (!url) {
            failedImageCache.add(cleanSrc);
            setResolvedSrc('');
            setStatus('error');
          } else {
            setResolvedSrc(url);
          }
        })
        .catch(() => {
          if (!cancelled) {
            failedImageCache.add(cleanSrc);
            setResolvedSrc('');
            setStatus('error');
          }
        });

      return () => {
        cancelled = true;
      };
    }, [cleanSrc, hasValidSrc, isIdbUri]);

    // Synchronously promote browser-cached images without waiting for an async onLoad tick
    useLayoutEffect(() => {
      const el = imgRef.current;
      if (el && resolvedSrc && el.complete && el.naturalWidth > 0) {
        loadedImageCache.add(cleanSrc);
        if (status !== 'loaded') {
          setStatus('loaded');
        }
      }
    }, [resolvedSrc, cleanSrc, status]);

    if (status === 'error' || (!resolvedSrc && status !== 'loading')) {
      return (
        <div
          className={`w-full min-h-[120px] flex flex-col items-center justify-center gap-2 bg-slate-100 dark:bg-slate-800/70 text-slate-500 dark:text-slate-400 p-4 text-center ${containerClassName}`}
        >
          <ImageIcon className="w-6 h-6 text-slate-400 dark:text-slate-500 shrink-0" />
          <span className="text-xs font-medium">{fallbackText}</span>
        </div>
      );
    }

    const effectiveLoading: 'lazy' | 'eager' = loading ?? (priority ? 'eager' : 'lazy');
    const defaultImgClass =
      fit === 'cover'
        ? 'w-full h-full object-cover block'
        : 'w-full h-auto max-h-[460px] object-contain mx-auto block';

    return (
      <div
        onClick={onClick}
        className={`relative w-full overflow-hidden bg-slate-100/80 dark:bg-slate-800/50 ${
          onClick ? 'cursor-pointer' : ''
        } ${containerClassName}`}
      >
        {status === 'loading' && (
          <div className="w-full min-h-[180px] flex items-center justify-center animate-pulse bg-slate-200/70 dark:bg-slate-800/80">
            <ImageIcon className="w-6 h-6 text-slate-300 dark:text-slate-600" />
          </div>
        )}
        {resolvedSrc && (
          <img
            ref={imgRef}
            src={resolvedSrc}
            alt={alt}
            loading={effectiveLoading}
            decoding="async"
            fetchPriority={priority ? 'high' : 'auto'}
            onLoad={() => {
              loadedImageCache.add(cleanSrc);
              failedImageCache.delete(cleanSrc);
              setStatus('loaded');
            }}
            onError={() => {
              failedImageCache.add(cleanSrc);
              setStatus('error');
            }}
            className={`${className || defaultImgClass} ${
              status === 'loaded' ? 'opacity-100' : 'opacity-0 absolute inset-0 pointer-events-none'
            } transition-opacity duration-200`}
          />
        )}
      </div>
    );
  }
);
