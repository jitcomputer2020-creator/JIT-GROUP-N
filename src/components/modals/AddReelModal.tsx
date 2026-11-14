/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { useSocial } from '../../context/SocialContext';
import { saveMediaFile, validateMediaFile } from '../../services/mediaStorage';
import { X, Video, Music, Send, Loader2, Film } from 'lucide-react';

interface AddReelModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AddReelModal: React.FC<AddReelModalProps> = ({ isOpen, onClose }) => {
  const { addReel } = useSocial();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [musicTitle, setMusicTitle] = useState('JIT Campus Beats');
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    const validation = validateMediaFile(file, { allowedCategory: 'video', maxSizeMb: 50 });
    if (!validation.valid) {
      setErrorMsg(validation.error || 'Please select a valid video file.');
      return;
    }

    setSelectedFile(file);
    const tempUrl = URL.createObjectURL(file);
    setPreviewUrl(tempUrl);
  };

  const handleClearMedia = () => {
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setErrorMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setErrorMsg('Please select a video file for your reel.');
      return;
    }
    if (!caption.trim()) {
      setErrorMsg('Please enter a caption for your reel.');
      return;
    }

    try {
      setIsUploading(true);
      setErrorMsg(null);

      // Save permanently to IndexedDB
      const { dataUrl } = await saveMediaFile(selectedFile);

      addReel({
        videoUrl: dataUrl,
        caption: caption.trim(),
        musicTitle: musicTitle.trim() || 'JIT Campus Sound',
      });

      handleClearMedia();
      setCaption('');
      onClose();
    } catch {
      setErrorMsg('Failed to save reel video. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-md max-h-[92dvh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-purple-50 dark:bg-purple-950/50 text-purple-600 rounded-xl">
              <Film className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Create Short Reel</h3>
          </div>
          <button
            onClick={() => {
              handleClearMedia();
              onClose();
            }}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMsg && (
            <div className="p-2.5 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs rounded-xl">
              {errorMsg}
            </div>
          )}

          {/* Media Picker / Preview */}
          {!previewUrl ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-purple-500 rounded-3xl p-8 text-center cursor-pointer transition-all bg-slate-50 dark:bg-slate-800/40 group"
            >
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Video className="w-6 h-6" />
              </div>
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Click to select Reel Video
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Supports MP4, WEBM up to 50MB (9:16 portrait recommended)
              </p>
            </div>
          ) : (
            <div className="relative rounded-2xl overflow-hidden bg-black max-h-64 flex items-center justify-center">
              <video src={previewUrl} controls className="max-h-64 w-auto object-contain" />
              <button
                type="button"
                onClick={handleClearMedia}
                className="absolute top-2 right-2 p-1.5 bg-red-600/90 hover:bg-red-700 text-white rounded-xl backdrop-blur-sm transition-colors"
                title="Cancel Video"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept="video/*"
            className="hidden"
          />

          {/* Caption */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Caption
            </label>
            <textarea
              rows={2}
              required
              placeholder="Write a catchy caption with hashtags #JITGaming #Campus..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900 dark:text-white resize-none"
            />
          </div>

          {/* Audio Track */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Sound / Audio Track
            </label>
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
              <Music className="w-3.5 h-3.5 text-purple-500 shrink-0" />
              <input
                type="text"
                placeholder="Song or sound name"
                value={musicTitle}
                onChange={(e) => setMusicTitle(e.target.value)}
                className="w-full bg-transparent text-xs text-slate-900 dark:text-white focus:outline-none"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                handleClearMedia();
                onClose();
              }}
              className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedFile || !caption.trim() || isUploading}
              className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm transition-all"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Publishing Reel...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Publish Reel</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
