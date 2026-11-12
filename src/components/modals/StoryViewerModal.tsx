/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef } from 'react';
import { Story } from '../../types';
import { APP_CONFIG } from '../../constants/branding';
import { useAuth } from '../../context/AuthContext';
import { useSocial } from '../../context/SocialContext';
import { X, Eye, Trash2 } from 'lucide-react';

interface StoryViewerModalProps {
  story: Story | null;
  onClose: () => void;
}

export const StoryViewerModal: React.FC<StoryViewerModalProps> = ({ story, onClose }) => {
  const { currentUser } = useAuth();
  const { deleteStory } = useSocial();
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const isOwner = currentUser?.id === story?.authorId;

  useEffect(() => {
    if (!story) return;
    setProgress(0);
    const interval = setInterval(() => {
      if (isPaused) return;
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          onClose();
          return 100;
        }
        return prev + 1.5;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [story, isPaused, onClose]);

  if (!story) return null;

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this story?')) {
      deleteStory(story.id);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in"
      onMouseDown={() => setIsPaused(true)}
      onMouseUp={() => setIsPaused(false)}
      onTouchStart={() => setIsPaused(true)}
      onTouchEnd={() => setIsPaused(false)}
    >
      <div className="relative w-full max-w-sm aspect-[9/16] rounded-3xl overflow-hidden bg-black border border-slate-800 shadow-2xl flex flex-col justify-between">
        {/* Progress Bar */}
        <div className="absolute top-3 inset-x-3 z-30 flex gap-1">
          <div className="h-1 flex-1 bg-white/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-white transition-all duration-100 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Top Header */}
        <div className="absolute top-6 inset-x-4 z-30 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <img
              src={story.authorAvatar || APP_CONFIG.logoUrl}
              alt={story.authorName}
              className="w-9 h-9 rounded-full object-cover border border-white bg-slate-900"
            />
            <div>
              <p className="text-xs font-bold leading-tight">{story.authorName}</p>
              <p className="text-[10px] text-white/70">{story.createdAt}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isOwner && (
              <button
                type="button"
                onClick={handleDelete}
                className="p-1.5 rounded-full bg-black/40 hover:bg-red-600 text-white transition-colors"
                title="Delete Story"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content: Image or Video */}
        {story.mediaType === 'video' ? (
          <video
            ref={videoRef}
            src={story.mediaUrl}
            autoPlay
            playsInline
            muted={false}
            className="w-full h-full object-cover"
          />
        ) : (
          <img
            src={story.mediaUrl}
            alt={story.caption || 'Story'}
            className="w-full h-full object-cover"
          />
        )}

        {/* Bottom Caption & View Count */}
        <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/90 via-black/40 to-transparent text-white z-30">
          {story.caption && (
            <p className="text-xs font-medium mb-2 leading-relaxed">{story.caption}</p>
          )}
          <div className="flex items-center gap-1.5 text-[10px] text-white/70">
            <Eye className="w-3.5 h-3.5" />
            <span>{story.viewCount} views · Expires in 24 hours</span>
          </div>
        </div>
      </div>
    </div>
  );
};
