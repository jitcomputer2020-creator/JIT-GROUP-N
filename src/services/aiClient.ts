/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client-side proxy wrapper for server-side Gemini AI endpoints (/api/ai/*).
 * Zero @google/genai imports or API keys reside in client code.
 */

import { AIDifficulty } from '../types/multiplayer';
import { QuizQuestion, pickShuffledQuizQuestions } from './gameAIEngine';
import { detectExpressBackendAvailable, safeFetchJson } from '../utils/safeFetch';

export interface JitAiChatTurn {
  role: 'user' | 'model';
  text: string;
}

export interface JitAiChatResult {
  reply: string;
  model: string;
  createdAtMs: number;
}

export async function sendJitAiChat(params: {
  message: string;
  history: JitAiChatTurn[];
  userName?: string;
  mode?: 'studies' | 'tech' | 'general';
}): Promise<JitAiChatResult> {
  const res = await safeFetchJson<{ reply?: string; model?: string; createdAtMs?: number; error?: string }>('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok || !res.data) {
    throw new Error(
      res.data?.error ||
        'JIT AI Assistant requires the full-stack server API and is unavailable on static serverless deployments.'
    );
  }

  return {
    reply: String(res.data.reply || ''),
    model: String(res.data.model || 'gemini-4-hydrogen'),
    createdAtMs: Number(res.data.createdAtMs || Date.now()),
  };
}

export interface SmartCaptionResult {
  captions: string[];
  hashtags: string[];
  source: 'ai' | 'template';
}

export async function generateAiCaptions(params: {
  topic?: string;
  existingText?: string;
  contentType: 'post' | 'reel';
  tone?: string;
}): Promise<SmartCaptionResult> {
  const res = await safeFetchJson<{ captions?: string[]; hashtags?: string[]; error?: string }>('/api/ai/captions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok || !res.data) {
    throw new Error(res.data?.error || 'Could not generate AI captions right now.');
  }

  return {
    captions: Array.isArray(res.data.captions) ? res.data.captions : [],
    hashtags: Array.isArray(res.data.hashtags) ? res.data.hashtags : [],
    source: 'ai',
  };
}

export interface QuizRoundResult {
  questions: QuizQuestion[];
  breakdown: {
    total: number;
    csCount: number;
    generalCount: number;
    csPercent: number;
    generalPercent: number;
  };
  source: 'ai' | 'curated-70-30';
  notice?: string;
}

export async function fetchAiQuizRound(params?: {
  count?: number;
  difficulty?: AIDifficulty;
  excludeQuestions?: string[];
  topicHint?: string;
}): Promise<QuizRoundResult> {
  const count = Math.max(5, Math.min(20, params?.count || 10));
  const csTarget = Math.round(count * 0.7);
  const genTarget = count - csTarget;

  let serverNotice: string | undefined;
  try {
    if (await detectExpressBackendAvailable()) {
      const res = await safeFetchJson<{
        questions?: QuizQuestion[];
        breakdown?: QuizRoundResult['breakdown'];
        error?: string;
      }>('/api/ai/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count,
          difficulty: params?.difficulty || 'medium',
          excludeQuestions: params?.excludeQuestions || [],
          topicHint: params?.topicHint,
        }),
      });

      if (res.ok && res.data && Array.isArray(res.data.questions) && res.data.questions.length > 0) {
        return {
          questions: res.data.questions,
          breakdown: res.data.breakdown || {
            total: res.data.questions.length,
            csCount: csTarget,
            generalCount: genTarget,
            csPercent: 70,
            generalPercent: 30,
          },
          source: 'ai',
        };
      }
      serverNotice = res.data?.error;
    }

    const fallback = pickShuffledQuizQuestions(count, params?.excludeQuestions || []);
    return {
      questions: fallback,
      breakdown: {
        total: fallback.length,
        csCount: fallback.filter((q) => q.domain === 'cs').length,
        generalCount: fallback.filter((q) => q.domain === 'general').length,
        csPercent: 70,
        generalPercent: 30,
      },
      source: 'curated-70-30',
      notice: serverNotice || 'Loaded curated 70% CS / 30% General bank.',
    };
  } catch {
    const fallback = pickShuffledQuizQuestions(count, params?.excludeQuestions || []);
    return {
      questions: fallback,
      breakdown: {
        total: fallback.length,
        csCount: fallback.filter((q) => q.domain === 'cs').length,
        generalCount: fallback.filter((q) => q.domain === 'general').length,
        csPercent: 70,
        generalPercent: 30,
      },
      source: 'curated-70-30',
      notice: 'Offline curated 70% CS / 30% General bank active.',
    };
  }
}

export interface ClientModerationResult {
  allowed: boolean;
  flagged: boolean;
  severity: 'none' | 'warning' | 'block';
  category: string;
  reason: string;
}

const CLIENT_ABUSIVE_REGEX =
  /\b(fuck|fucking|motherfucker|bitch|asshole|bastard|slut|whore|dickhead|chutiya|madarchod|behenchod|bsdk|bhosdike|harami|kamina|idiot|moron|kill\s+yourself|kys|nigger|faggot|retard)\b/i;
const CLIENT_SPAM_REGEX =
  /(https?:\/\/[^\s]+\s*){3,}|(.)\2{7,}|(free\s+(money|nitro|crypto|followers|points)|click\s+here\s+to\s+claim|win\s+\$?\d+\s+now|guaranteed\s+profit)/i;

/**
 * Automated AI & heuristic content moderation filter.
 * Strictly used on public comments & live game room chats.
 * NEVER applied to private direct messages or group DMs.
 */
export async function moderatePublicContent(
  text: string,
  context: 'comment' | 'room_chat' | 'post' = 'comment'
): Promise<ClientModerationResult> {
  const clean = text.trim();
  if (!clean) {
    return { allowed: true, flagged: false, severity: 'none', category: 'clean', reason: '' };
  }

  // Instant client pre-check
  if (CLIENT_ABUSIVE_REGEX.test(clean)) {
    return {
      allowed: false,
      flagged: true,
      severity: 'block',
      category: 'abusive_language',
      reason: 'Abusive or profane words are not allowed in public comments or room chat.',
    };
  }
  if (CLIENT_SPAM_REGEX.test(clean)) {
    return {
      allowed: false,
      flagged: true,
      severity: 'block',
      category: 'spam',
      reason: 'Repetitive characters or promotional spam links are blocked.',
    };
  }

  try {
    if (!(await detectExpressBackendAvailable())) {
      return { allowed: true, flagged: false, severity: 'none', category: 'clean', reason: '' };
    }
    const res = await safeFetchJson<Partial<ClientModerationResult>>('/api/ai/moderate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean, context }),
    });
    if (!res.ok || !res.data) {
      return { allowed: true, flagged: false, severity: 'none', category: 'clean', reason: '' };
    }
    const data = res.data;
    return {
      allowed: typeof data.allowed === 'boolean' ? data.allowed : data.severity !== 'block',
      flagged: Boolean(data.flagged),
      severity: data.severity === 'block' || data.severity === 'warning' ? data.severity : 'none',
      category: String(data.category || 'clean'),
      reason: String(data.reason || ''),
    };
  } catch {
    return { allowed: true, flagged: false, severity: 'none', category: 'clean', reason: '' };
  }
}
