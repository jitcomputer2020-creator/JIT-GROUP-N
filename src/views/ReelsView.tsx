/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocial } from '../context/SocialContext';
import { NavTab } from '../types';
import { APP_CONFIG } from '../constants/branding';
import { AddReelModal } from '../components/modals/AddReelModal';
import {
  Heart,
  MessageCircle,
  Share2,
  Volume2,
  VolumeX,
  Play,
  ChevronUp,
  ChevronDown,
  Plus,
  Music,
  Check,
  X,
  Video,
} from 'lucide-react';

interface ReelsViewProps {
  onNavigate: (tab: NavTab) => void;
}

export const ReelsView: React.FC<ReelsViewProps> = ({ onNavigate }) => {
  const { currentUser } = useAuth();
  const {
    reels,
    toggleLikeReel,
    addReelComment,
    setViewingUserId,
    isFriend,
    sendFriendRequest,
  } = useSocial();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [showComments, setShowComments] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [isAddReelOpen, setIsAddReelOpen] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);

  const safeIndex = Math.min(currentIndex, Math.max(0, reels.length - 1));
  const currentReel = reels[safeIndex] || reels[0];

  const handleNextReel = () => {
    if (currentIndex < reels.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setCurrentIndex(0); // loop
    }
  };

  const handlePrevReel = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        videoRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleShare = () => {
    if (!currentReel) return;
    setCopied(true);
    navigator.clipboard.writeText(`${window.location.origin}/#reel-${currentReel.id}`);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddComment = () => {
    if (!commentInput.trim() || !currentReel) return;
    addReelComment(currentReel.id, commentInput.trim());
    setCommentInput('');
  };

  const handleCreatorClick = (creatorId: string) => {
    setViewingUserId(creatorId);
    onNavigate('profile');
  };

  if (!currentReel) {
    return (
      <div className="flex flex-col justify-center items-center h-[calc(100vh-140px)] min-h-[500px] text-center p-6">
        <Video className="w-12 h-12 text-slate-400 mb-2" />
        <p className="text-sm font-bold text-slate-700 dark:text-slate-300">No reels found</p>
        <button
          onClick={() => setIsAddReelOpen(true)}
          className="mt-3 px-4 py-2 bg-purple-600 text-white rounded-xl text-xs font-bold"
        >
          Upload First Reel
        </button>
        <AddReelModal isOpen={isAddReelOpen} onClose={() => setIsAddReelOpen(false)} />
      </div>
    );
  }

  const commentsList = currentReel.comments || [];

  return (
    <div className="flex justify-center items-center h-[calc(100dvh-150px)] sm:h-[calc(100vh-140px)] min-h-[460px] px-1 sm:px-0">
      <div className="relative w-full max-w-[min(380px,100%)] h-full max-h-[680px] rounded-3xl overflow-hidden bg-black shadow-2xl border border-slate-800 flex flex-col justify-between">
        {/* Top Floating Bar */}
        <div className="absolute top-4 inset-x-3 sm:inset-x-4 z-20 flex items-center justify-between text-white drop-shadow-md">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-xs font-black uppercase tracking-wider bg-black/40 backdrop-blur-md px-2.5 py-1 rounded-xl">
              JIT Reels
            </span>
            <span className="text-[11px] text-white/80">
              {safeIndex + 1}/{reels.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsAddReelOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-purple-600/90 hover:bg-purple-600 backdrop-blur-md text-white text-[11px] font-bold shadow-sm transition-all"
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" />
              <span>Create</span>
            </button>
            <button
              onClick={toggleMute}
              className="p-2 rounded-full bg-black/40 backdrop-blur-md hover:bg-black/60 transition-colors"
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Video Element */}
        <div className="relative w-full h-full cursor-pointer" onClick={togglePlay}>
          <video
            ref={videoRef}
            src={currentReel.videoUrl}
            autoPlay
            loop
            muted={isMuted}
            playsInline
            className="w-full h-full object-cover"
          />

          {!isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
              <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center">
                <Play className="w-8 h-8 text-white fill-white ml-1" />
              </div>
            </div>
          )}

          {/* Bottom Gradient Scrim */}
          <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none" />
        </div>

        {/* Right Floating Action Rails */}
        <div className="absolute right-3 bottom-20 z-20 flex flex-col items-center gap-4 text-white">
          {/* Creator Avatar (Click to visit profile) */}
          <div
            className="relative cursor-pointer group"
            onClick={() => handleCreatorClick(currentReel.creatorId)}
            title="View creator profile"
          >
            <img
              src={currentReel.creatorAvatar || APP_CONFIG.logoUrl}
              alt={currentReel.creatorName}
              className="w-10 h-10 rounded-full object-cover border-2 border-white group-hover:scale-105 transition-transform"
            />
            {currentReel.creatorId !== currentUser?.id && !isFriend(currentReel.creatorId) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  sendFriendRequest(currentReel.creatorId);
                }}
                className="absolute -bottom-1 -right-1 p-0.5 bg-blue-600 rounded-full text-white"
                title="Connect"
              >
                <Plus className="w-3 h-3 stroke-[3]" />
              </button>
            )}
          </div>

          {/* Like */}
          <button
            onClick={() => toggleLikeReel(currentReel.id)}
            className="flex flex-col items-center gap-1 group"
          >
            <div className={`p-2.5 rounded-full bg-black/40 backdrop-blur-md group-hover:scale-110 transition-transform ${currentReel.isLiked ? 'text-red-500' : 'text-white'}`}>
              <Heart className={`w-5 h-5 ${currentReel.isLiked ? 'fill-current' : ''}`} />
            </div>
            <span className="text-[10px] font-bold font-mono">{currentReel.likesCount}</span>
          </button>

          {/* Comments */}
          <button onClick={() => setShowComments(true)} className="flex flex-col items-center gap-1 group">
            <div className="p-2.5 rounded-full bg-black/40 backdrop-blur-md group-hover:scale-110 transition-transform text-white">
              <MessageCircle className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-bold font-mono">{commentsList.length > 0 ? commentsList.length : currentReel.commentsCount}</span>
          </button>

          {/* Share */}
          <button onClick={handleShare} className="flex flex-col items-center gap-1 group">
            <div className="p-2.5 rounded-full bg-black/40 backdrop-blur-md group-hover:scale-110 transition-transform text-white">
              {copied ? <Check className="w-5 h-5 text-emerald-400" /> : <Share2 className="w-5 h-5" />}
            </div>
            <span className="text-[10px] font-bold font-mono">{copied ? 'Copied' : currentReel.sharesCount}</span>
          </button>
        </div>

        {/* Bottom Caption & Music Details */}
        <div className="absolute left-4 right-16 bottom-4 z-20 text-white pointer-events-auto">
          <div className="flex items-center gap-2 mb-1">
            <span
              onClick={() => handleCreatorClick(currentReel.creatorId)}
              className="text-xs font-bold cursor-pointer hover:underline"
            >
              {currentReel.creatorName}
            </span>
          </div>
          <p className="text-xs leading-snug line-clamp-2 text-white/90 mb-2">
            {currentReel.caption}
          </p>
          <div className="flex items-center gap-1.5 text-[10px] text-white/70">
            <Music className="w-3 h-3 text-emerald-400" />
            <span className="truncate">{currentReel.musicTitle}</span>
          </div>
        </div>

        {/* Up / Down Navigation Controls */}
        <div className="hidden sm:flex absolute -right-14 top-1/2 -translate-y-1/2 flex-col gap-2 z-20">
          <button
            onClick={handlePrevReel}
            disabled={currentIndex === 0}
            className="p-3 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-md text-slate-700 dark:text-slate-200 disabled:opacity-40 hover:scale-105 transition-all"
            title="Previous Reel"
          >
            <ChevronUp className="w-5 h-5" />
          </button>
          <button
            onClick={handleNextReel}
            className="p-3 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-md text-slate-700 dark:text-slate-200 hover:scale-105 transition-all"
            title="Next Reel"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        </div>

        {/* Comments Drawer */}
        {showComments && (
          <div className="absolute inset-x-0 bottom-0 h-3/5 bg-slate-900/95 backdrop-blur-md rounded-t-3xl z-30 p-4 flex flex-col text-white animate-in slide-in-from-bottom">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-3">
              <span className="text-xs font-bold uppercase tracking-wider">
                Comments ({commentsList.length})
              </span>
              <button onClick={() => setShowComments(false)} className="p-1 text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 text-xs text-slate-300 pr-1 no-scrollbar">
              {commentsList.length === 0 ? (
                <p className="text-center text-slate-400 text-xs py-4">No comments yet. Be first to comment!</p>
              ) : (
                commentsList.map((c) => (
                  <div key={c.id} className="p-2 rounded-xl bg-slate-800/60">
                    <div className="flex items-center justify-between">
                      <p
                        onClick={() => handleCreatorClick(c.authorId)}
                        className="font-bold text-white text-[11px] cursor-pointer hover:underline"
                      >
                        {c.authorName}
                      </p>
                      <span className="text-[10px] text-slate-400">{c.createdAt}</span>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-0.5">{c.content}</p>
                  </div>
                ))
              )}
            </div>

            <div className="mt-2 pt-2 border-t border-slate-800 flex gap-2">
              <input
                type="text"
                placeholder="Add a comment..."
                value={commentInput}
                onChange={(e) => setCommentInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                className="flex-1 px-3 py-1.5 text-xs bg-slate-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 text-white placeholder:text-slate-500"
              />
              <button
                onClick={handleAddComment}
                disabled={!commentInput.trim()}
                className="px-3 py-1.5 bg-blue-600 disabled:opacity-40 rounded-xl text-xs font-semibold hover:bg-blue-700"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Upload Reel Modal */}
      <AddReelModal
        isOpen={isAddReelOpen}
        onClose={() => setIsAddReelOpen(false)}
      />
    </div>
  );
};
