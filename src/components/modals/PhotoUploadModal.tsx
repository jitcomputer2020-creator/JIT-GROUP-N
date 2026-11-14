/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Camera, Image as ImageIcon, X, Check, Trash2, AlertCircle, Loader2, Upload } from 'lucide-react';
import { saveCompressedProfileMediaFile, validateMediaFile } from '../../services/mediaStorage';
import { APP_CONFIG } from '../../constants/branding';

interface PhotoUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'avatar' | 'cover';
  currentPhotoUrl?: string;
  onSavePhoto: (photoDataUrl: string) => Promise<void>;
  onRemovePhoto?: () => Promise<void>;
}

export const PhotoUploadModal: React.FC<PhotoUploadModalProps> = ({
  isOpen,
  onClose,
  mode,
  currentPhotoUrl,
  onSavePhoto,
  onRemovePhoto,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedFile(null);
      setPreviewUrl(null);
      setIsRemoving(false);
      setErrorMessage(null);
      setSuccessMessage(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isAvatar = mode === 'avatar';
  const defaultDisplayUrl = isAvatar ? APP_CONFIG.logoUrl : '';
  const activeDisplayUrl = isRemoving
    ? defaultDisplayUrl
    : previewUrl || currentPhotoUrl || defaultDisplayUrl;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    const validation = validateMediaFile(file, {
      allowedCategory: 'image',
      maxSizeMb: isAvatar ? 15 : 20,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    });

    if (!validation.valid) {
      setErrorMessage(validation.error || 'Invalid image file.');
      return;
    }

    setSelectedFile(file);
    setIsRemoving(false);

    // Create instant local preview
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
  };

  const handleTriggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleMarkRemove = () => {
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setIsRemoving(true);
    setErrorMessage(null);
  };

  const handleCancel = () => {
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setIsRemoving(false);
    setErrorMessage(null);
    onClose();
  };

  const handleSave = async () => {
    setErrorMessage(null);
    setIsSaving(true);

    try {
      if (isRemoving) {
        if (onRemovePhoto) {
          await onRemovePhoto();
        } else {
          await onSavePhoto(defaultDisplayUrl);
        }
        setSuccessMessage('Photo removed successfully.');
        setTimeout(() => {
          onClose();
        }, 600);
        return;
      }

      if (selectedFile) {
        // Compress & save persistently to IndexedDB + pass cloud-ready Data URL to Firebase
        const { dataUrl } = await saveCompressedProfileMediaFile(selectedFile, mode);
        await onSavePhoto(dataUrl);
        setSuccessMessage('Photo saved to Firebase & browser storage.');
        setTimeout(() => {
          onClose();
        }, 600);
        return;
      }

      // No changes
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save photo to cloud storage.';
      setErrorMessage(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges = selectedFile !== null || isRemoving;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-lg max-h-[92dvh] overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl flex flex-col space-y-4 sm:space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {isAvatar ? 'Update Profile Photo' : 'Update Cover Photo'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isAvatar
                  ? 'Personalize your JIT campus profile photo'
                  : 'Customize your campus profile header banner'}
              </p>
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error / Success Notifications */}
        {errorMessage && (
          <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-2xl flex items-start gap-2.5 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-2xl flex items-center gap-2.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <Check className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Hidden File Picker */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
        />

        {/* Interactive Preview Canvas */}
        <div className="flex flex-col items-center justify-center p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-200/80 dark:border-slate-800">
          {isAvatar ? (
            <div className="relative group">
              <div className="w-36 h-36 sm:w-40 sm:h-40 rounded-full overflow-hidden border-4 border-white dark:border-slate-800 shadow-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                {activeDisplayUrl ? (
                  <img
                    src={activeDisplayUrl}
                    alt="Profile Preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImageIcon className="w-12 h-12 text-slate-400" />
                )}
              </div>
              <button
                type="button"
                onClick={handleTriggerFileInput}
                className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center text-white text-xs font-semibold transition-opacity"
              >
                <Camera className="w-6 h-6 mb-1" />
                <span>Change</span>
              </button>
              <button
                type="button"
                onClick={handleTriggerFileInput}
                className="sm:hidden absolute bottom-1 right-1 p-2.5 rounded-full bg-blue-600 text-white shadow-lg border-2 border-white dark:border-slate-900 min-h-[40px] min-w-[40px] flex items-center justify-center"
                aria-label="Choose profile photo"
              >
                <Camera className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="w-full relative group">
              <div className="w-full h-36 sm:h-44 rounded-2xl overflow-hidden border-2 border-white dark:border-slate-800 shadow-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                {activeDisplayUrl ? (
                  <img
                    src={activeDisplayUrl}
                    alt="Cover Preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center text-slate-400 text-xs">
                    <ImageIcon className="w-10 h-10 mb-1" />
                    <span>No cover photo set</span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleTriggerFileInput}
                className="absolute inset-0 rounded-2xl bg-black/40 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center text-white text-xs font-semibold transition-opacity"
              >
                <Camera className="w-6 h-6 mb-1" />
                <span>Change Cover</span>
              </button>
              <button
                type="button"
                onClick={handleTriggerFileInput}
                className="sm:hidden absolute bottom-2 right-2 px-3 py-1.5 rounded-xl bg-black/70 text-white text-[11px] font-semibold flex items-center gap-1.5 shadow-md"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Tap to pick</span>
              </button>
            </div>
          )}

          {isRemoving && (
            <p className="mt-3 text-xs font-medium text-amber-600 dark:text-amber-400">
              {isAvatar ? 'Photo will be reset to default logo upon saving.' : 'Cover photo will be removed upon saving.'}
            </p>
          )}

          {selectedFile && (
            <p className="mt-3 text-xs text-slate-600 dark:text-slate-300 text-center break-all">
              Selected: <span className="font-semibold text-slate-900 dark:text-white">{selectedFile.name}</span> ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
            </p>
          )}
        </div>

        {/* Change / Remove Controls */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleTriggerFileInput}
            className="flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] text-xs font-bold rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors shadow-sm"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{selectedFile ? 'Choose Different Image' : 'Select From Device'}</span>
          </button>

          {(currentPhotoUrl || selectedFile) && !isRemoving && (
            <button
              type="button"
              onClick={handleMarkRemove}
              className="flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] text-xs font-bold rounded-2xl bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 transition-colors shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isAvatar ? 'Reset to Default' : 'Remove Photo'}</span>
            </button>
          )}
        </div>

        {/* Guidance Notice */}
        <div className="text-[11px] text-slate-400 dark:text-slate-500 text-center leading-relaxed">
          Supports JPG, PNG, WEBP, and GIF up to {isAvatar ? '15MB' : '20MB'}. Images are automatically optimized and synced to your Firebase profile so they persist across refreshes and devices.
        </div>

        {/* Footer Actions: Cancel and Save */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSaving}
            className="px-5 py-2.5 min-h-[44px] text-xs font-bold rounded-2xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="flex items-center justify-center gap-2 px-6 py-2.5 min-h-[44px] text-xs font-bold rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white transition-all shadow-md shadow-blue-500/20 disabled:opacity-50 disabled:pointer-events-none"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Save Photo</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
