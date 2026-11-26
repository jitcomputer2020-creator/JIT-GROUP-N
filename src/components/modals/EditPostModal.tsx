/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { Post } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useSocial } from '../../context/SocialContext';
import {
  saveMediaFile,
  validateMediaFile,
  generateVideoThumbnail,
  VIDEO_EXPIRY_MS,
} from '../../services/mediaStorage';
import { uploadVideoAssetToCloud } from '../../lib/firebase';
import { isValidImageUrl, isValidVideoUrl } from '../../lib/mediaValidation';
import { ResilientVideo } from '../common/ResilientVideo';
import { ResponsiveImage } from '../common/ResponsiveImage';
import { X, Image as ImageIcon, Trash2, Check } from 'lucide-react';

interface EditPostModalProps {
  post: Post | null;
  onClose: () => void;
}

export const EditPostModal: React.FC<EditPostModalProps> = ({ post, onClose }) => {
  const { currentUser } = useAuth();
  const { editPost } = useSocial();
  const [content, setContent] = useState(post?.content || '');
  const [mediaUrls, setMediaUrls] = useState<string[]>(post?.mediaUrls || []);
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'none'>(post?.mediaType || 'none');
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!post) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    const isVid = file.type.startsWith('video/');
    const validation = validateMediaFile(file, { maxSizeMb: isVid ? 50 : 15 });
    if (!validation.valid) {
      setErrorMsg(validation.error || 'Invalid file');
      return;
    }

    try {
      setIsUploading(true);
      if (isVid && currentUser) {
        const thumb = await generateVideoThumbnail(file);
        const uploaded = await uploadVideoAssetToCloud(
          currentUser.id,
          file,
          thumb,
          Date.now() + VIDEO_EXPIRY_MS
        );
        setMediaUrls([uploaded.videoUrl]);
        setMediaType('video');
      } else {
        const { dataUrl } = await saveMediaFile(file);
        setMediaUrls([dataUrl]);
        setMediaType(isVid ? 'video' : 'image');
      }
    } catch {
      setErrorMsg('Failed to process media file. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveMedia = () => {
    setMediaUrls([]);
    setMediaType('none');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    editPost(post.id, content.trim(), mediaUrls, mediaType);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Edit Post</h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-y-auto pt-4 space-y-4">
          <textarea
            rows={4}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Edit your post content..."
            className="w-full p-3 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white resize-none"
            required
          />

          {errorMsg && (
            <div className="p-2.5 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs rounded-xl">
              {errorMsg}
            </div>
          )}

          {/* Media Preview */}
          {(() => {
            const firstUrl = mediaUrls.find((u) => u && u.trim());
            if (!firstUrl || mediaType === 'none') return null;
            const valid = mediaType === 'video' ? isValidVideoUrl(firstUrl) : isValidImageUrl(firstUrl);
            if (!valid) return null;
            return (
              <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 w-full">
                {mediaType === 'video' ? (
                  <ResilientVideo
                    src={firstUrl}
                    poster={post.thumbnailUrl}
                    controls
                    hideOnInvalid
                    className="w-full h-auto max-h-64 object-contain"
                  />
                ) : (
                  <ResponsiveImage
                    src={firstUrl}
                    alt="Edited post image"
                    fit="contain"
                    className="w-full h-auto max-h-64 object-contain mx-auto block"
                  />
                )}
                <button
                  type="button"
                  onClick={handleRemoveMedia}
                  className="absolute top-2 right-2 z-20 p-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors"
                  title="Remove Media"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })()}

          {/* Hidden File Picker */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*,video/*"
            className="hidden"
          />

          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-xl transition-colors"
            >
              <ImageIcon className="w-4 h-4 text-emerald-500" />
              <span>{mediaUrls.length > 0 ? 'Replace Media' : 'Add Media'}</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!content.trim() || isUploading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save Changes</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
