/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocial } from '../context/SocialContext';
import { Post, Story, NavTab, Comment } from '../types';
import { APP_CONFIG } from '../constants/branding';
import { saveMediaFile, validateMediaFile } from '../services/mediaStorage';
import { LikedByModal } from '../components/modals/LikedByModal';
import { EditPostModal } from '../components/modals/EditPostModal';
import { AddStoryModal } from '../components/modals/AddStoryModal';
import {
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  Image as ImageIcon,
  Send,
  Plus,
  Gamepad2,
  MoreHorizontal,
  Check,
  Trash2,
  Edit3,
  X,
  CornerDownRight,
  Loader2,
} from 'lucide-react';

interface HomeViewProps {
  onNavigate: (tab: NavTab) => void;
  onOpenStoryViewer: (story: Story) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onNavigate, onOpenStoryViewer }) => {
  const { currentUser } = useAuth();
  const {
    posts,
    stories,
    createPost,
    deletePost,
    toggleLikePost,
    getPostLikers,
    addComment,
    toggleSavePost,
    setViewingUserId,
  } = useSocial();

  const [activeCategory, setActiveCategory] = useState<'all' | 'friends' | 'following' | 'popular'>('all');

  // New post state
  const [newContent, setNewContent] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'none'>('none');
  const [isPosting, setIsPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  // Comments state
  const [activeCommentsPostId, setActiveCommentsPostId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [replyingToCommentId, setReplyingToCommentId] = useState<string | null>(null);

  // Modals state
  const [likedByPostId, setLikedByPostId] = useState<string | null>(null);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [isAddStoryOpen, setIsAddStoryOpen] = useState(false);
  const [activeMenuPostId, setActiveMenuPostId] = useState<string | null>(null);
  const [copiedPostId, setCopiedPostId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle Media Selection
  const handleMediaSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPostError(null);
    const validation = validateMediaFile(file, { maxSizeMb: 30 });
    if (!validation.valid) {
      setPostError(validation.error || 'Invalid file');
      return;
    }

    const isVid = file.type.startsWith('video/');
    setMediaFile(file);
    setMediaType(isVid ? 'video' : 'image');
    setMediaPreviewUrl(URL.createObjectURL(file));
  };

  const handleClearMedia = () => {
    if (mediaPreviewUrl && mediaPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(mediaPreviewUrl);
    }
    setMediaFile(null);
    setMediaPreviewUrl(null);
    setMediaType('none');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Submit Post
  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim() && !mediaFile) return;
    if (!currentUser) return;

    setIsPosting(true);
    setPostError(null);

    try {
      let savedMediaUrls: string[] | undefined;
      let finalMediaType: 'image' | 'video' | 'none' = 'none';

      if (mediaFile) {
        const { dataUrl } = await saveMediaFile(mediaFile);
        savedMediaUrls = [dataUrl];
        finalMediaType = mediaType;
      }

      createPost({
        content: newContent.trim(),
        mediaUrls: savedMediaUrls,
        mediaType: finalMediaType,
        category: activeCategory,
      });

      setNewContent('');
      handleClearMedia();
    } catch {
      setPostError('Failed to upload media. Please try again.');
    } finally {
      setIsPosting(false);
    }
  };

  // Comments submission
  const handleAddComment = (postId: string) => {
    if (!commentText.trim()) return;
    addComment(postId, commentText.trim(), replyingToCommentId || undefined);
    setCommentText('');
    setReplyingToCommentId(null);
  };

  // Share post
  const handleShare = (postId: string) => {
    setCopiedPostId(postId);
    navigator.clipboard.writeText(`${window.location.origin}/#post-${postId}`);
    setTimeout(() => setCopiedPostId(null), 2000);
  };

  // View Author Profile
  const handleAuthorClick = (authorId: string) => {
    setViewingUserId(authorId);
    onNavigate('profile');
  };

  const filteredPosts = posts.filter((p) => {
    if (activeCategory === 'all') return true;
    return p.category === activeCategory;
  });

  const likersList = likedByPostId ? getPostLikers(likedByPostId) : [];

  return (
    <div className="space-y-6 max-w-2xl mx-auto w-full">
      {/* 1. Stories Carousel */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 shadow-sm">
        <div className="flex items-center gap-3 overflow-x-auto no-scrollbar pb-1">
          {/* Add story item */}
          <div
            onClick={() => setIsAddStoryOpen(true)}
            className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer group"
          >
            <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-emerald-500 p-0.5 transition-transform group-hover:scale-105">
              <div className="w-full h-full rounded-[14px] bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden">
                <img
                  src={currentUser?.avatarUrl || APP_CONFIG.logoUrl}
                  alt="My Profile"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute -bottom-1 -right-1 p-1 bg-blue-600 text-white rounded-full ring-2 ring-white dark:ring-slate-900">
                <Plus className="w-3 h-3 stroke-[3]" />
              </div>
            </div>
            <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[64px]">
              Add Story
            </span>
          </div>

          {/* Stories list */}
          {stories.map((story) => (
            <div
              key={story.id}
              onClick={() => onOpenStoryViewer(story)}
              className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer group"
            >
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 via-emerald-500 to-amber-500 p-0.5 transition-transform group-hover:scale-105 shadow-sm">
                <div className="w-full h-full rounded-[14px] bg-slate-100 overflow-hidden relative">
                  <img
                    src={story.mediaUrl}
                    alt={story.authorName}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-black/20" />
                  <img
                    src={story.authorAvatar || APP_CONFIG.logoUrl}
                    alt={story.authorName}
                    className="absolute bottom-1 left-1 w-5 h-5 rounded-full object-cover border border-white"
                  />
                </div>
              </div>
              <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[64px]">
                {story.authorName.split(' ')[0]}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Create Post Bar */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-sm">
        <form onSubmit={handleCreatePost}>
          <div className="flex gap-3">
            <img
              src={currentUser?.avatarUrl || APP_CONFIG.logoUrl}
              alt={currentUser?.fullName || 'User'}
              onClick={() => currentUser && handleAuthorClick(currentUser.id)}
              className="w-10 h-10 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shrink-0 cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all"
            />
            <div className="flex-1">
              <textarea
                rows={2}
                placeholder="Share campus news, gaming achievements, or research thoughts..."
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                className="w-full p-2.5 text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white placeholder:text-slate-400 resize-none"
              />

              {postError && (
                <p className="text-xs text-red-500 mt-1">{postError}</p>
              )}

              {/* Media Preview Box */}
              {mediaPreviewUrl && (
                <div className="relative mt-2 rounded-2xl overflow-hidden bg-black max-h-56 flex items-center justify-center border border-slate-200 dark:border-slate-700">
                  {mediaType === 'video' ? (
                    <video src={mediaPreviewUrl} controls className="max-h-56 w-auto object-contain" />
                  ) : (
                    <img src={mediaPreviewUrl} alt="Preview" className="max-h-56 w-auto object-contain" />
                  )}
                  <button
                    type="button"
                    onClick={handleClearMedia}
                    className="absolute top-2 right-2 p-1.5 bg-red-600/90 hover:bg-red-700 text-white rounded-xl backdrop-blur-sm transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Hidden file input */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleMediaSelect}
                accept="image/*,video/*"
                className="hidden"
              />

              <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-slate-600 dark:text-slate-300"
                  >
                    <ImageIcon className="w-4 h-4 text-emerald-500" />
                    <span>{mediaFile ? 'Change Media' : 'Media'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('games')}
                    className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-slate-600 dark:text-slate-300"
                  >
                    <Gamepad2 className="w-4 h-4 text-blue-500" />
                    <span>Tag Game</span>
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={(!newContent.trim() && !mediaFile) || isPosting}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5"
                >
                  {isPosting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Posting...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Post</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>
      </section>

      {/* 3. Feed Category Filter Tabs */}
      <div className="flex items-center justify-between p-1 bg-slate-200/60 dark:bg-slate-800/70 rounded-2xl">
        {(['all', 'friends', 'following', 'popular'] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`flex-1 py-2 px-1 text-[11px] sm:text-xs font-semibold rounded-xl capitalize transition-all text-center truncate ${
              activeCategory === cat
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {cat === 'all' ? 'All Updates' : cat}
          </button>
        ))}
      </div>

      {/* 4. Social Feed Posts List */}
      <div className="space-y-4">
        {filteredPosts.map((post) => {
          const isOwnPost = currentUser?.id === post.authorId;
          const commentsList = post.comments || [];

          return (
            <article
              key={post.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-all relative"
            >
              {/* Author lockup */}
              <div className="flex items-start justify-between mb-3">
                <div
                  onClick={() => handleAuthorClick(post.authorId)}
                  className="flex items-center gap-3 cursor-pointer group"
                >
                  <img
                    src={post.authorAvatar || APP_CONFIG.logoUrl}
                    alt={post.authorName}
                    className="w-10 h-10 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 group-hover:ring-2 group-hover:ring-blue-500 transition-all"
                  />
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {post.authorName}
                    </h4>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <span>{post.authorHandle || '@jit_member'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{post.createdAt}</span>
                    </div>
                  </div>
                </div>

                <div className="relative">
                  <button
                    onClick={() => setActiveMenuPostId(activeMenuPostId === post.id ? null : post.id)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>

                  {/* Dropdown Menu for Post actions */}
                  {activeMenuPostId === post.id && (
                    <div className="absolute right-0 top-8 z-20 w-44 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl py-1.5 text-xs">
                      {isOwnPost ? (
                        <>
                          <button
                            onClick={() => {
                              setEditingPost(post);
                              setActiveMenuPostId(null);
                            }}
                            className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-blue-500" />
                            <span>Edit Post</span>
                          </button>
                          <button
                            onClick={() => {
                              deletePost(post.id);
                              setActiveMenuPostId(null);
                            }}
                            className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete Post</span>
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            handleAuthorClick(post.authorId);
                            setActiveMenuPostId(null);
                          }}
                          className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                        >
                          <span>View Author Profile</span>
                        </button>
                      )}
                      <button
                        onClick={() => {
                          handleShare(post.id);
                          setActiveMenuPostId(null);
                        }}
                        className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border-t border-slate-100 dark:border-slate-800"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Copy Post Link</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Content text */}
              <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed mb-4 whitespace-pre-line break-words">
                {post.content}
              </p>

              {/* Post Attached Media (if any) */}
              {post.mediaUrls && post.mediaUrls.length > 0 && (
                <div className="mb-4 rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-800 bg-black max-h-80 flex items-center justify-center">
                  {post.mediaType === 'video' ? (
                    <video src={post.mediaUrls[0]} controls className="max-h-80 w-auto object-contain" />
                  ) : (
                    <img src={post.mediaUrls[0]} alt="Post media" className="max-h-80 w-auto object-contain" />
                  )}
                </div>
              )}

              {/* Interactive Action Bar */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-1">
                  {/* Like Button */}
                  <button
                    onClick={() => toggleLikePost(post.id)}
                    className={`flex items-center justify-center gap-1.5 min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-xl transition-all touch-manipulate ${
                      post.isLiked
                        ? 'text-red-500 bg-red-50 dark:bg-red-950/40'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${post.isLiked ? 'fill-current' : ''}`} />
                  </button>

                  {/* Likes Count (Clickable to open LikedByModal) */}
                  <button
                    onClick={() => setLikedByPostId(post.id)}
                    className="text-xs font-semibold font-mono tabular-nums px-1.5 py-1 min-h-[40px] flex items-center hover:underline hover:text-red-500 transition-colors touch-manipulate"
                    title="View people who liked this post"
                  >
                    {post.likesCount} {post.likesCount === 1 ? 'like' : 'likes'}
                  </button>
                </div>

                <button
                  onClick={() =>
                    setActiveCommentsPostId(activeCommentsPostId === post.id ? null : post.id)
                  }
                  className="flex items-center justify-center gap-1.5 min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors touch-manipulate"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span className="text-xs font-semibold font-mono tabular-nums">
                    {commentsList.length > 0 ? commentsList.length : post.commentsCount}
                  </span>
                </button>

                <button
                  onClick={() => handleShare(post.id)}
                  className="flex items-center justify-center gap-1.5 min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors touch-manipulate"
                >
                  {copiedPostId === post.id ? (
                    <Check className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Share2 className="w-4 h-4" />
                  )}
                  <span className="text-xs font-semibold">
                    {copiedPostId === post.id ? 'Copied' : post.sharesCount}
                  </span>
                </button>

                <button
                  onClick={() => toggleSavePost(post.id)}
                  className={`min-h-[40px] min-w-[40px] flex items-center justify-center p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors touch-manipulate ${
                    post.isSaved ? 'text-blue-600 dark:text-blue-400' : ''
                  }`}
                  title={post.isSaved ? 'Remove from Saved' : 'Save Post'}
                >
                  <Bookmark className={`w-4 h-4 ${post.isSaved ? 'fill-current' : ''}`} />
                </button>
              </div>

              {/* Comment Section (Collapsible) */}
              {activeCommentsPostId === post.id && (
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                  {/* Add comment input */}
                  <div>
                    {replyingToCommentId && (
                      <div className="flex items-center justify-between text-[11px] text-blue-600 mb-1 px-1">
                        <span>Replying to comment...</span>
                        <button
                          onClick={() => setReplyingToCommentId(null)}
                          className="hover:underline text-slate-400"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder={replyingToCommentId ? 'Write your reply...' : 'Write a comment...'}
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddComment(post.id)}
                        className="flex-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
                      />
                      <button
                        onClick={() => handleAddComment(post.id)}
                        disabled={!commentText.trim()}
                        className="px-3.5 py-2 bg-blue-600 disabled:opacity-40 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition-colors"
                      >
                        {replyingToCommentId ? 'Reply' : 'Comment'}
                      </button>
                    </div>
                  </div>

                  {/* Comments & Nested Replies List */}
                  {commentsList.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-2">
                      No comments yet. Start the conversation!
                    </p>
                  ) : (
                    <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1 no-scrollbar">
                      {commentsList.map((comm) => (
                        <div key={comm.id} className="space-y-1.5">
                          {/* Top-level comment */}
                          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl text-xs">
                            <div className="flex items-center justify-between mb-1">
                              <div
                                onClick={() => handleAuthorClick(comm.authorId)}
                                className="flex items-center gap-2 cursor-pointer"
                              >
                                <img
                                  src={comm.authorAvatar || APP_CONFIG.logoUrl}
                                  alt={comm.authorName}
                                  className="w-5 h-5 rounded-full object-cover"
                                />
                                <span className="font-bold text-slate-900 dark:text-white hover:underline">
                                  {comm.authorName}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-400">{comm.createdAt}</span>
                            </div>
                            <p className="text-slate-700 dark:text-slate-300 pl-7">{comm.content}</p>
                            <div className="pl-7 mt-1.5 flex items-center gap-3 text-[11px] text-slate-500">
                              <button
                                onClick={() => setReplyingToCommentId(comm.id)}
                                className="font-semibold hover:text-blue-600 transition-colors"
                              >
                                Reply
                              </button>
                            </div>
                          </div>

                          {/* Nested Replies */}
                          {comm.replies && comm.replies.length > 0 && (
                            <div className="pl-6 space-y-1.5">
                              {comm.replies.map((reply) => (
                                <div
                                  key={reply.id}
                                  className="p-2.5 bg-slate-100/70 dark:bg-slate-800/40 rounded-xl text-xs border-l-2 border-blue-500"
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <div
                                      onClick={() => handleAuthorClick(reply.authorId)}
                                      className="flex items-center gap-1.5 cursor-pointer"
                                    >
                                      <CornerDownRight className="w-3 h-3 text-slate-400" />
                                      <img
                                        src={reply.authorAvatar || APP_CONFIG.logoUrl}
                                        alt={reply.authorName}
                                        className="w-4 h-4 rounded-full object-cover"
                                      />
                                      <span className="font-bold text-slate-900 dark:text-white hover:underline">
                                        {reply.authorName}
                                      </span>
                                    </div>
                                    <span className="text-[10px] text-slate-400">{reply.createdAt}</span>
                                  </div>
                                  <p className="text-slate-700 dark:text-slate-300 pl-5">{reply.content}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* Global Modals */}
      <LikedByModal
        isOpen={!!likedByPostId}
        onClose={() => setLikedByPostId(null)}
        likers={likersList}
        onNavigate={onNavigate}
      />

      <EditPostModal
        post={editingPost}
        onClose={() => setEditingPost(null)}
      />

      <AddStoryModal
        isOpen={isAddStoryOpen}
        onClose={() => setIsAddStoryOpen(false)}
      />
    </div>
  );
};
