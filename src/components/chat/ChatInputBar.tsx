/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { validateMediaFile } from '../../services/mediaStorage';
import {
  ChatStickerDef,
  EmojiStickerPicker,
} from './chatStickersAndEmojis';
import { Loader2, Paperclip, Send, Smile, X } from 'lucide-react';

interface ChatInputBarProps {
  activeConvId: string;
  isAiThread: boolean;
  sendingMessage: boolean;
  aiThinking: boolean;
  externalError: string | null;
  onClearExternalError: () => void;
  onSendMessage: (content: string, attachedFile: File | null) => Promise<boolean>;
  onSendSticker: (sticker: ChatStickerDef) => Promise<void>;
  onTypingChange?: (isTyping: boolean) => void;
}

export const ChatInputBar: React.FC<ChatInputBarProps> = React.memo(
  ({
    activeConvId,
    isAiThread,
    sendingMessage,
    aiThinking,
    externalError,
    onClearExternalError,
    onSendMessage,
    onSendSticker,
    onTypingChange,
  }) => {
    const [messageText, setMessageText] = useState('');
    const [attachedFile, setAttachedFile] = useState<File | null>(null);
    const [attachedPreview, setAttachedPreview] = useState<string | null>(null);
    const [attachError, setAttachError] = useState<string | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const textInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const lastTypingPingRef = useRef<number>(0);
    const stopTypingTimerRef = useRef<number | null>(null);
    const wasTypingRef = useRef<boolean>(false);

    const clearTypingSignal = useCallback(
      (forceNotify = false) => {
        if (stopTypingTimerRef.current !== null) {
          window.clearTimeout(stopTypingTimerRef.current);
          stopTypingTimerRef.current = null;
        }
        lastTypingPingRef.current = 0;
        if (wasTypingRef.current || forceNotify) {
          wasTypingRef.current = false;
          onTypingChange?.(false);
        }
      },
      [onTypingChange]
    );

    const notifyTypingActivity = useCallback(
      (nextText: string) => {
        if (isAiThread || !onTypingChange) return;
        if (!nextText.trim()) {
          clearTypingSignal();
          return;
        }
        const now = Date.now();
        if (!wasTypingRef.current || now - lastTypingPingRef.current >= 1500) {
          lastTypingPingRef.current = now;
          wasTypingRef.current = true;
          onTypingChange(true);
        }
        if (stopTypingTimerRef.current !== null) {
          window.clearTimeout(stopTypingTimerRef.current);
        }
        stopTypingTimerRef.current = window.setTimeout(() => {
          clearTypingSignal(true);
        }, 3000);
      },
      [isAiThread, onTypingChange, clearTypingSignal]
    );

    const clearAttachment = useCallback(() => {
      setAttachedPreview((prev) => {
        if (prev && prev.startsWith('blob:')) {
          URL.revokeObjectURL(prev);
        }
        return null;
      });
      setAttachedFile(null);
      setAttachError(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }, []);

    // Close picker & clear draft attachment / typing cleanly when switching conversations
    useEffect(() => {
      setPickerOpen(false);
      clearAttachment();
      clearTypingSignal();
      return () => {
        clearTypingSignal();
      };
    }, [activeConvId, clearAttachment, clearTypingSignal]);

    // Close popup on outside click
    useEffect(() => {
      if (!pickerOpen) return;
      const handlePointerDown = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setPickerOpen(false);
        }
      };
      document.addEventListener('mousedown', handlePointerDown);
      return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [pickerOpen]);

    const handleFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setAttachError(null);
      const validation = validateMediaFile(file, { maxSizeMb: 15 });
      if (!validation.valid) {
        setAttachError(validation.error || 'Invalid file');
        return;
      }

      if (attachedPreview && attachedPreview.startsWith('blob:')) {
        URL.revokeObjectURL(attachedPreview);
      }
      setAttachedFile(file);
      setAttachedPreview(URL.createObjectURL(file));
    };

    const handleInsertEmoji = useCallback((emoji: string) => {
      const inputEl = textInputRef.current;
      if (!inputEl) {
        setMessageText((prev) => prev + emoji);
        return;
      }
      const start = inputEl.selectionStart ?? inputEl.value.length;
      const end = inputEl.selectionEnd ?? inputEl.value.length;
      setMessageText((prev) => {
        const next = prev.slice(0, start) + emoji + prev.slice(end);
        const nextCaret = start + emoji.length;
        window.requestAnimationFrame(() => {
          if (textInputRef.current) {
            textInputRef.current.focus();
            textInputRef.current.setSelectionRange(nextCaret, nextCaret);
          }
        });
        return next;
      });
    }, []);

    const handleBackspace = useCallback(() => {
      const inputEl = textInputRef.current;
      setMessageText((prev) => {
        if (!prev) return prev;
        if (!inputEl) {
          const chars = Array.from(prev);
          chars.pop();
          return chars.join('');
        }
        const start = inputEl.selectionStart ?? prev.length;
        const end = inputEl.selectionEnd ?? prev.length;
        if (start !== end) {
          const next = prev.slice(0, start) + prev.slice(end);
          window.requestAnimationFrame(() => {
            if (textInputRef.current) {
              textInputRef.current.focus();
              textInputRef.current.setSelectionRange(start, start);
            }
          });
          return next;
        }
        if (start === 0) return prev;
        const beforeChars = Array.from(prev.slice(0, start));
        const removed = beforeChars.pop() || '';
        const nextBefore = beforeChars.join('');
        const next = nextBefore + prev.slice(end);
        const nextCaret = start - removed.length;
        window.requestAnimationFrame(() => {
          if (textInputRef.current) {
            textInputRef.current.focus();
            textInputRef.current.setSelectionRange(nextCaret, nextCaret);
          }
        });
        return next;
      });
    }, []);

    const handleClearText = useCallback(() => {
      setMessageText('');
      clearTypingSignal();
      window.requestAnimationFrame(() => {
        textInputRef.current?.focus();
      });
    }, [clearTypingSignal]);

    const handlePickSticker = useCallback(
      async (sticker: ChatStickerDef) => {
        setPickerOpen(false);
        clearTypingSignal();
        await onSendSticker(sticker);
      },
      [onSendSticker, clearTypingSignal]
    );

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = messageText.trim();
      if ((!trimmed && !attachedFile) || sendingMessage || (isAiThread && aiThinking)) return;

      const fileToSend = attachedFile;
      setMessageText('');
      clearAttachment();
      clearTypingSignal(true);
      setPickerOpen(false);

      const ok = await onSendMessage(trimmed, fileToSend);
      if (!ok) {
        setMessageText(trimmed);
      }
    };

    const combinedError = attachError || externalError;

    return (
      <div ref={containerRef} className="relative shrink-0 w-full box-border">
        {pickerOpen && (
          <EmojiStickerPicker
            onSelectEmoji={handleInsertEmoji}
            onBackspace={handleBackspace}
            onClearText={handleClearText}
            onSelectSticker={handlePickSticker}
            onClose={() => setPickerOpen(false)}
          />
        )}

        {attachedPreview && (
          <div className="w-full box-border px-3 sm:px-4 py-2 bg-slate-100 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <img
                src={attachedPreview}
                alt="Upload preview"
                className="w-10 h-10 rounded-lg object-cover border border-slate-300 dark:border-slate-600 shrink-0"
              />
              <span className="text-xs text-slate-700 dark:text-slate-300 truncate max-w-[200px]">
                {attachedFile?.name}
              </span>
            </div>
            <button
              type="button"
              onClick={clearAttachment}
              className="p-1 text-slate-400 hover:text-red-500 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {combinedError && (
          <div className="w-full box-border px-3 sm:px-4 py-1.5 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 flex items-center justify-between gap-2">
            <span className="truncate">{combinedError}</span>
            <button
              type="button"
              onClick={() => {
                setAttachError(null);
                onClearExternalError();
              }}
              className="p-0.5 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="w-full box-border p-2.5 sm:p-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5 sm:gap-2 min-w-0"
        >
          {!isAiThread && (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                title="Attach Image"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileAttach}
                accept="image/*"
                className="hidden"
              />
            </>
          )}

          <button
            type="button"
            onClick={() => setPickerOpen((prev) => !prev)}
            className={`p-2 rounded-xl transition-colors shrink-0 ${
              pickerOpen
                ? 'text-blue-500 bg-blue-50 dark:bg-blue-950/50'
                : 'text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="Emojis & Stickers"
          >
            <Smile className="w-4 h-4" />
          </button>

          <input
            ref={textInputRef}
            type="text"
            placeholder={
              isAiThread
                ? 'Ask JIT AI about studies, CS, code, or anything...'
                : 'Type your message...'
            }
            value={messageText}
            onChange={(e) => {
              const val = e.target.value;
              setMessageText(val);
              notifyTypingActivity(val);
            }}
            className="flex-1 min-w-0 px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white placeholder:text-slate-400"
          />

          <button
            type="submit"
            disabled={
              (!messageText.trim() && !attachedFile) ||
              sendingMessage ||
              (isAiThread && aiThinking)
            }
            className={`p-2 disabled:opacity-40 text-white rounded-xl shadow-sm transition-colors shrink-0 ${
              isAiThread
                ? 'bg-indigo-600 hover:bg-indigo-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {sendingMessage || (isAiThread && aiThinking) ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
      </div>
    );
  }
);

ChatInputBar.displayName = 'ChatInputBar';
