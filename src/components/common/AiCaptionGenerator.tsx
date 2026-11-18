/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { generateAiCaptions } from '../../services/aiClient';
import { Sparkles, Loader2, Hash, Check, Plus, AlertCircle } from 'lucide-react';

interface AiCaptionGeneratorProps {
  contentType: 'post' | 'reel';
  currentText: string;
  onSelectCaption: (caption: string) => void;
  onAppendHashtags: (tagsText: string) => void;
  compact?: boolean;
}

const TONES = [
  { id: 'engaging', label: 'Engaging' },
  { id: 'study', label: 'Study & Tech' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'campus', label: 'Campus Vibe' },
] as const;

export const AiCaptionGenerator: React.FC<AiCaptionGeneratorProps> = ({
  contentType,
  currentText,
  onSelectCaption,
  onAppendHashtags,
  compact = false,
}) => {
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState<string>('engaging');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [source, setSource] = useState<'ai' | 'template' | null>(null);
  const [captions, setCaptions] = useState<string[]>([]);
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [appliedTag, setAppliedTag] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setNotice(null);
    try {
      const res = await generateAiCaptions({
        topic:
          topic.trim() ||
          currentText.trim() ||
          (contentType === 'reel' ? 'Campus highlight reel' : 'Campus & tech moment'),
        existingText: currentText,
        contentType,
        tone,
      });
      setCaptions(Array.isArray(res.captions) ? res.captions : []);
      setHashtags(Array.isArray(res.hashtags) ? res.hashtags : []);
      setSource(res.source);
      if (res.notice) {
        setNotice(res.notice);
      }
    } catch (err: any) {
      setNotice(
        err?.message || 'AI caption suggestion could not be loaded right now. You can still write your own caption.'
      );
      setSource('template');
    } finally {
      setLoading(false);
    }
  };

  const handlePickHashtag = (tag: string) => {
    onAppendHashtags(tag);
    setAppliedTag(tag);
    setTimeout(() => setAppliedTag(null), 1200);
  };

  return (
    <div
      className={`rounded-2xl border border-indigo-200/80 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/25 ${
        compact ? 'p-3' : 'p-3.5'
      } space-y-2.5`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 dark:text-indigo-300">
          <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
          <span>AI Smart Caption &amp; Hashtags</span>
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {TONES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTone(t.id)}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold transition-colors ${
                tone === t.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-100 dark:hover:bg-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Topic or vibe (optional — uses draft if empty)..."
          className="flex-1 min-w-0 px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-indigo-200/70 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-white placeholder:text-slate-400"
        />
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors"
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Writing...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              <span>Suggest</span>
            </>
          )}
        </button>
      </div>

      {notice && (
        <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/50 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}

      {captions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {source === 'template' ? 'Starter templates (click to apply)' : 'Click an AI caption to apply'}
          </p>
          <div className="space-y-1.5">
            {captions.map((cap, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onSelectCaption(cap)}
                className="w-full text-left p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500 text-xs text-slate-800 dark:text-slate-200 leading-snug transition-all flex items-start justify-between gap-2 group"
              >
                <span>{cap}</span>
                <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 shrink-0 opacity-80 group-hover:opacity-100">
                  Use
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {hashtags.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Hash className="w-3 h-3" />
              {source === 'template' ? 'Starter Hashtags' : 'Suggested Hashtags'}
            </span>
            <button
              type="button"
              onClick={() => onAppendHashtags(hashtags.join(' '))}
              className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              + Add All
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {hashtags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => handlePickHashtag(tag)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-indigo-200/80 dark:border-slate-700 hover:border-indigo-500 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 transition-colors"
              >
                {appliedTag === tag ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <Plus className="w-3 h-3 opacity-60" />
                )}
                <span>{tag}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
