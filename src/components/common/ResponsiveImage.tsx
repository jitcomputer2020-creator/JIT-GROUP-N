/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { resolveLocalMediaUrl } from '../../services/mediaStorage';

interface ResponsiveImageProps {
  src?: string;
  alt?: string;
  fit?: 'contain' | 'cover';
  className?: string;
  containerClassName?: string;
  fallbackText?: string;
  onClick?: () => void;
}

export const ResponsiveImage: React.FC<ResponsiveImageProps> = ({
  src,
  alt = 'Attachment',
  fit = 'contain',
  className,
  containerClassName = '',
  fallbackText = 'Image unavailable',
  onClick,
}) => {
  const cleanSrc = typeof src === 'string' ? src.trim() : '';
  const [resolvedSrc, setResolvedSrc] = useState<string>(() =>
    cleanSrc && !cleanSrc.startsWith('idb://') ? cleanSrc : ''
  );
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(() =>
    !cleanSrc ? 'error' : cleanSrc.startsWith('idb://') ? 'loading' : 'loading'
  );

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';

    if (!cleanSrc) {
      setResolvedSrc('');
      setStatus('error');
      return;
    }

    if (!cleanSrc.startsWith('idb://')) {
      setResolvedSrc(cleanSrc);
      setStatus('loading');
      return;
    }

    setStatus('loading');
    resolveLocalMediaUrl(cleanSrc)
      .then((url) => {
        if (cancelled) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url);
          return;
        }
        if (url.startsWith('blob:')) objectUrl = url;
        if (!url) {
          setResolvedSrc('');
          setStatus('error');
        } else {
          setResolvedSrc(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedSrc('');
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cleanSrc]);

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
        <div className="w-full min-h-[160px] flex items-center justify-center animate-pulse bg-slate-100 dark:bg-slate-800/80">
          <ImageIcon className="w-6 h-6 text-slate-300 dark:text-slate-600" />
        </div>
      )}
      {resolvedSrc && (
        <img
          src={resolvedSrc}
          alt={alt}
          loading="lazy"
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          className={`${className || defaultImgClass} ${
            status === 'loaded' ? 'opacity-100' : 'opacity-0 absolute inset-0 pointer-events-none'
          } transition-opacity duration-200`}
        />
      )}
    </div>
  );
};
