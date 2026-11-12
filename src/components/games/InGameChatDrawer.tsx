/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { InGameChatMessage } from '../../types/multiplayer';
import { saveMediaFile, validateMediaFile } from '../../services/mediaStorage';
import { APP_CONFIG } from '../../constants/branding';
import {
  Send,
  Image as ImageIcon,
  Smile,
  X,
  VolumeX,
  Volume2,
  Trash2,
  AlertCircle,
  Loader2,
  Check,
} from 'lucide-react';

interface InGameChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  messages: InGameChatMessage[];
  currentUserId: string;
  onSendMessage: (text?: string, imageUrl?: string) => void;
  mutedPlayerIds: string[];
  onToggleMutePlayer: (playerId: string) => void;
}

const QUICK_EMOJIS = ['🔥', '👏', '😂', '🏆', '🎯', '🚀', '❤️', '👑', '👍', '😱', '🎲', '♟️'];

export const InGameChatDrawer: React.FC<InGameChatDrawerProps> = ({
  isOpen,
  onClose,
  messages,
  currentUserId,
  onSendMessage,
  mutedPlayerIds,
  onToggleMutePlayer,
}) => {
  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    const validation = validateMediaFile(file, {
      allowedCategory: 'image',
      maxSizeMb: 15,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    });

    if (!validation.valid) {
      setErrorMessage(validation.error || 'Invalid image file.');
      return;
    }

    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
  };

  const handleClearImage = () => {
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
    setErrorMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() && !selectedFile) return;

    setErrorMessage(null);

    let uploadedDataUrl: string | undefined;
    if (selectedFile) {
      try {
        setIsUploadingImage(true);
        const { dataUrl } = await saveMediaFile(selectedFile);
        uploadedDataUrl = dataUrl;
      } catch (err: unknown) {
        setErrorMessage('Failed to save image.');
        setIsUploadingImage(false);
        return;
      } finally {
        setIsUploadingImage(false);
      }
    }

    onSendMessage(inputText.trim() || undefined, uploadedDataUrl);
    setInputText('');
    handleClearImage();
    setShowEmojiPicker(false);
  };

  const handleEmojiClick = (emoji: string) => {
    setInputText((prev) => prev + emoji);
  };

  // Filter out muted players
  const visibleMessages = messages.filter(
    (m) => !mutedPlayerIds.includes(m.senderId)
  );

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-96 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-black text-slate-900 dark:text-white">In-Game Chat</span>
          <span className="text-[10px] bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-bold px-2 py-0.5 rounded-full">
            Live
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Minimize Chat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Error Callout */}
      {errorMessage && (
        <div className="p-2.5 mx-3 mt-2 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs rounded-xl flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 no-scrollbar">
        {visibleMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 p-4 space-y-2">
            <Smile className="w-8 h-8 stroke-1 text-slate-300" />
            <p className="text-xs font-semibold">Game Chat is Ready</p>
            <p className="text-[11px] text-slate-400 max-w-[200px]">
              Chat, share emojis, or send images without leaving your game board!
            </p>
          </div>
        ) : (
          visibleMessages.map((msg) => {
            const isMe = msg.senderId === currentUserId;
            const isMuted = mutedPlayerIds.includes(msg.senderId);

            return (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
              >
                {!isMe && (
                  <img
                    src={msg.senderAvatar || APP_CONFIG.logoUrl}
                    alt={msg.senderName}
                    className="w-8 h-8 rounded-full object-cover shrink-0 border border-slate-200 dark:border-slate-700"
                  />
                )}

                <div className={`max-w-[80%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  {!isMe && (
                    <div className="flex items-center gap-2 mb-1 px-1">
                      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                        {msg.senderName}
                      </span>
                      <button
                        type="button"
                        onClick={() => onToggleMutePlayer(msg.senderId)}
                        className="text-[10px] text-slate-400 hover:text-red-500"
                        title={isMuted ? 'Unmute Player' : 'Mute Player'}
                      >
                        {isMuted ? <Volume2 className="w-3 h-3 text-red-500" /> : <VolumeX className="w-3 h-3" />}
                      </button>
                    </div>
                  )}

                  {msg.imageUrl && (
                    <div className="mb-1.5 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm bg-black/5">
                      <img
                        src={msg.imageUrl}
                        alt="Shared in-game"
                        className="max-h-52 w-auto object-cover cursor-pointer hover:opacity-95"
                      />
                    </div>
                  )}

                  {msg.text && (
                    <div
                      className={`px-3.5 py-2 rounded-2xl text-xs leading-relaxed shadow-sm break-words ${
                        isMe
                          ? 'bg-blue-600 text-white rounded-tr-none'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white rounded-tl-none'
                      }`}
                    >
                      {msg.text}
                    </div>
                  )}

                  <span className="text-[9px] text-slate-400 mt-0.5 px-1 font-mono">
                    {msg.timestamp}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Image Preview Box Before Sending */}
      {previewUrl && (
        <div className="p-3 bg-slate-50 dark:bg-slate-800 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl overflow-hidden bg-black/10 border border-slate-200 dark:border-slate-700">
              <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Image Attached
              </p>
              <p className="text-[10px] text-slate-400">
                Ready to send to all room members
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClearImage}
            className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg"
            title="Cancel Image"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Emoji Picker Tray */}
      {showEmojiPicker && (
        <div className="p-2.5 bg-slate-50 dark:bg-slate-800/90 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleEmojiClick(emoji)}
              className="text-lg p-1.5 hover:scale-125 transition-transform"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Input Form */}
      <form onSubmit={handleSend} className="p-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2 shrink-0">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*"
          className="hidden"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-2 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Select Image from Gallery"
        >
          <ImageIcon className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          className={`p-2 rounded-xl transition-colors ${
            showEmojiPicker
              ? 'text-amber-500 bg-amber-50 dark:bg-amber-950/40'
              : 'text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
          title="Emoji Tray"
        >
          <Smile className="w-4 h-4" />
        </button>

        <input
          type="text"
          placeholder="Message room..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          className="flex-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
        />

        <button
          type="submit"
          disabled={(!inputText.trim() && !selectedFile) || isUploadingImage}
          className="p-2 bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-40 text-white rounded-xl shadow-md transition-all shrink-0"
          title="Send"
        >
          {isUploadingImage ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </form>
    </div>
  );
};
