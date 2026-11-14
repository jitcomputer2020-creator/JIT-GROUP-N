/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { useSocial } from '../../context/SocialContext';
import { saveMediaFile, validateMediaFile } from '../../services/mediaStorage';
import { X, UploadCloud, Image as ImageIcon, Video, Send, Loader2 } from 'lucide-react';

interface AddStoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AddStoryModal: React.FC<AddStoryModalProps> = ({ isOpen, onClose }) => {
  const { addStory } = useSocial();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [caption, setCaption] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    const validation = validateMediaFile(file, { maxSizeMb: 30 });
    if (!validation.valid) {
      setErrorMsg(validation.error || 'Invalid file');
      return;
    }

    const isVideo = file.type.startsWith('video/');
    setMediaType(isVideo ? 'video' : 'image');
    setSelectedFile(file);

    // Create immediate temporary preview for UX
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
      setErrorMsg('Please select an image or video for your story.');
      return;
    }

    try {
      setIsUploading(true);
      setErrorMsg(null);

      // Save permanently to IndexedDB
      const { dataUrl } = await saveMediaFile(selectedFile);

      addStory({
        mediaUrl: dataUrl,
        mediaType,
        caption: caption.trim() || undefined,
      });

      handleClearMedia();
      setCaption('');
      onClose();
    } catch {
      setErrorMsg('Failed to save story media. Please try again.');
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
            <div className="p-1.5 bg-blue-50 dark:bg-blue-950/50 text-blue-600 rounded-xl">
              <UploadCloud className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add Campus Story</h3>
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
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 rounded-3xl p-8 text-center cursor-pointer transition-all bg-slate-50 dark:bg-slate-800/40 group"
            >
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                <ImageIcon className="w-6 h-6" />
              </div>
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Click to upload Photo or Video
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                Supports JPG, PNG, MP4 up to 30MB (Expires in 24 hours)
              </p>
            </div>
          ) : (
            <div className="relative rounded-2xl overflow-hidden bg-black max-h-72 flex items-center justify-center">
              {mediaType === 'video' ? (
                <video src={previewUrl} controls className="max-h-72 w-auto object-contain" />
              ) : (
                <img src={previewUrl} alt="Story preview" className="max-h-72 w-auto object-contain" />
              )}
              <button
                type="button"
                onClick={handleClearMedia}
                className="absolute top-2 right-2 p-1.5 bg-red-600/90 hover:bg-red-700 text-white rounded-xl backdrop-blur-sm transition-colors"
                title="Cancel Media"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept="image/*,video/*"
            className="hidden"
          />

          {/* Caption */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Story Caption (Optional)
            </label>
            <input
              type="text"
              placeholder="What are you doing on campus today?..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
            />
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
              disabled={!selectedFile || isUploading}
              className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm transition-all"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Story...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Share Story</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
