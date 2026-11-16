/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server-Side Gemini AI Integration Service (@google/genai)
 * Never import this file from client-side React views or components.
 */

import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

export const GEMINI_MODEL = 'gemini-4-hydrogen';

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface ChatTurnInput {
  role: 'user' | 'model';
  text: string;
}

export async function runJitAiChat(params: {
  message: string;
  history?: ChatTurnInput[];
  userName?: string;
  mode?: 'studies' | 'tech' | 'general';
}): Promise<{ reply: string; model: string }> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const modeHint =
    params.mode === 'studies'
      ? 'Focus on clear academic study explanations, step-by-step concepts, and exam-ready summaries.'
      : params.mode === 'tech'
      ? 'Focus on practical computer science, algorithms, debugging, and clean TypeScript/software engineering guidance.'
      : 'Be helpful, concise, friendly, and accurate for both campus academics and general questions.';

  const systemInstruction = `You are JIT AI, the smart study, engineering, and campus companion inside JIT GROUP (Jharna Institute of Technology).
${params.userName ? `You are assisting student/member ${params.userName}.` : ''}
${modeHint}
Keep responses clear, well-structured, concise (under 250 words unless asked for more detail), and formatted cleanly in plain text or lightweight bullet lists without excessive filler.`;

  const validHistory = (params.history || [])
    .filter((h) => h && typeof h.text === 'string' && h.text.trim().length > 0)
    .slice(-12)
    .map((h) => ({
      role: h.role === 'model' ? ('model' as const) : ('user' as const),
      parts: [{ text: h.text.trim().slice(0, 1500) }],
    }));

  const chat = ai.chats.create({
    model: GEMINI_MODEL,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
    history: validHistory,
  });

  const response = await chat.sendMessage({
    message: params.message.trim().slice(0, 2000),
  });

  const reply = (response.text || '').trim();
  if (!reply) {
    throw new Error('Empty response received from Gemini model.');
  }
  return { reply, model: GEMINI_MODEL };
}

export async function generateSmartCaptions(params: {
  topic?: string;
  existingText?: string;
  contentType?: 'post' | 'reel';
  tone?: string;
}): Promise<{ captions: string[]; hashtags: string[]; model: string }> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const contentType = params.contentType === 'reel' ? 'short vertical reel video' : 'campus social feed post';
  const tone = (params.tone || 'engaging').trim();
  const prompt = `Generate 3 catchy, authentic social media caption options and 7 relevant hashtags for a ${contentType} on JIT GROUP (a college & gaming community platform).
Tone: ${tone}
Topic / Context: ${(params.topic || '').trim() || 'Campus life, coding, or gaming moment'}
Existing draft text (if any): ${(params.existingText || '').trim() || 'None'}

Rules:
- Each caption must be 1 to 2 sentences, crisp, natural, and tailored to students/gamers.
- Hashtags must be single words starting with # (e.g. #JITCampus, #CodeAndPlay).`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          captions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          hashtags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['captions', 'hashtags'],
      },
    },
  });

  const parsed = JSON.parse(response.text || '{}') as {
    captions?: string[];
    hashtags?: string[];
  };

  const captions = Array.isArray(parsed.captions)
    ? parsed.captions.map((c) => String(c).trim()).filter(Boolean).slice(0, 4)
    : [];
  const hashtags = Array.isArray(parsed.hashtags)
    ? parsed.hashtags
        .map((h) => String(h).trim().replace(/\s+/g, ''))
        .filter(Boolean)
        .map((h) => (h.startsWith('#') ? h : `#${h}`))
        .slice(0, 10)
    : [];

  if (captions.length === 0) {
    throw new Error('Model returned no caption suggestions.');
  }

  return { captions, hashtags, model: GEMINI_MODEL };
}

export interface GeneratedQuizItem {
  q: string;
  options: string[];
  answer: number;
  category: string;
  domain: 'cs' | 'general';
  explanation: string;
}

const SERVER_QUIZ_BACKUP_BANK: GeneratedQuizItem[] = [
  // CS Questions (14)
  {
    q: 'Which data structure follows the Last-In-First-Out (LIFO) principle for function call frames?',
    options: ['Queue', 'Stack', 'Min-Heap', 'Adjacency List'],
    answer: 1,
    category: 'Data Structures',
    domain: 'cs',
    explanation: 'The call stack pushes activation records and pops the most recently invoked frame first.',
  },
  {
    q: 'Which SQL normal form eliminates transitive functional dependencies of non-key attributes?',
    options: ['First Normal Form (1NF)', 'Second Normal Form (2NF)', 'Third Normal Form (3NF)', 'Unnormalized Form'],
    answer: 2,
    category: 'DBMS',
    domain: 'cs',
    explanation: '3NF requires 2NF plus no non-prime attribute depends transitively on a candidate key.',
  },
  {
    q: 'What is the worst-case time complexity of binary search on a sorted array of n elements?',
    options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
    answer: 1,
    category: 'Algorithms',
    domain: 'cs',
    explanation: 'Each comparison halves the remaining search interval, giving O(log n).',
  },
  {
    q: 'In TCP, which mechanism prevents a fast sender from overwhelming a slower receiver buffer?',
    options: ['DNS Caching', 'Sliding Window Flow Control', 'ARP Resolution', 'ICMP Echo'],
    answer: 1,
    category: 'Computer Networks',
    domain: 'cs',
    explanation: 'TCP receiver-advertised window (rwnd) limits how many unacknowledged bytes can be in flight.',
  },
  {
    q: 'Which scheduling algorithm can cause starvation for long CPU-burst processes?',
    options: ['Round Robin', 'First-Come First-Served', 'Shortest Job First (SJF)', 'Multilevel Feedback'],
    answer: 2,
    category: 'Operating Systems',
    domain: 'cs',
    explanation: 'Continuous arrivals of shorter jobs can indefinitely delay longer jobs in SJF.',
  },
  {
    q: 'Which HTTP method is defined as both safe and idempotent in RESTful API design?',
    options: ['POST', 'GET', 'PATCH', 'CONNECT'],
    answer: 1,
    category: 'Web Engineering',
    domain: 'cs',
    explanation: 'GET retrieves state without modifying server resources, making repeated calls safe and idempotent.',
  },
  {
    q: 'In Git, what does "git rebase" primarily modify compared to "git merge"?',
    options: ['Deletes remote branches', 'Replays commits onto a new base commit linearly', 'Compresses binary blobs only', 'Removes git config'],
    answer: 1,
    category: 'Software Engineering',
    domain: 'cs',
    explanation: 'Rebase rewrites commit history onto the target base branch for a linear commit sequence.',
  },
  {
    q: 'Which graph traversal uses a Queue and guarantees shortest path length in unweighted graphs?',
    options: ['Depth-First Search (DFS)', 'Breadth-First Search (BFS)', 'Kruskal’s Algorithm', 'Topological Sort'],
    answer: 1,
    category: 'Algorithms',
    domain: 'cs',
    explanation: 'BFS explores vertices level by level by distance from the source.',
  },
  {
    q: 'Which cryptographic property ensures that changing 1 bit of input drastically alters the hash digest?',
    options: ['Polymorphism', 'Avalanche Effect', 'Encapsulation', 'Normalization'],
    answer: 1,
    category: 'Cybersecurity',
    domain: 'cs',
    explanation: 'Strong hash functions exhibit the avalanche effect so small input changes create uncorrelated outputs.',
  },
  {
    q: 'In TypeScript, which utility type makes all properties of an interface optional?',
    options: ['Required<T>', 'Readonly<T>', 'Partial<T>', 'Record<K, T>'],
    answer: 2,
    category: 'TypeScript',
    domain: 'cs',
    explanation: 'Partial<T> maps every key K of T to optional property syntax (K?: T[K]).',
  },
  // General Trivia Questions (6)
  {
    q: 'Which planet in our solar system rotates on its side with an axial tilt of about 98 degrees?',
    options: ['Saturn', 'Uranus', 'Neptune', 'Venus'],
    answer: 1,
    category: 'Astronomy',
    domain: 'general',
    explanation: 'Uranus has an extreme 98-degree axial tilt, causing its poles to experience 42-year seasons.',
  },
  {
    q: 'Which element has the highest electrical and thermal conductivity among all metals at room temperature?',
    options: ['Copper', 'Gold', 'Silver', 'Aluminum'],
    answer: 2,
    category: 'Physics & Chemistry',
    domain: 'general',
    explanation: 'Silver possesses the highest electrical and thermal conductivity of any element.',
  },
  {
    q: 'In Chess, what special move involves moving the King two squares toward a Rook in a single turn?',
    options: ['En Passant', 'Castling', 'Promotion', 'Fianchetto'],
    answer: 1,
    category: 'Games & Strategy',
    domain: 'general',
    explanation: 'Castling moves both the King and Rook simultaneously when specific conditions are met.',
  },
  {
    q: 'Which river flows through the most countries in the world?',
    options: ['Nile', 'Amazon', 'Danube', 'Mekong'],
    answer: 2,
    category: 'World Geography',
    domain: 'general',
    explanation: 'The Danube passes through or borders 10 European countries.',
  },
  {
    q: 'Who wrote the classic science fiction novel "Dune" published in 1965?',
    options: ['Isaac Asimov', 'Arthur C. Clarke', 'Frank Herbert', 'Philip K. Dick'],
    answer: 2,
    category: 'Literature',
    domain: 'general',
    explanation: 'Frank Herbert authored Dune, set on the desert planet Arrakis.',
  },
  {
    q: 'Which vitamin is primarily synthesized when human skin is exposed to UVB sunlight?',
    options: ['Vitamin A', 'Vitamin C', 'Vitamin D', 'Vitamin K'],
    answer: 2,
    category: 'Biology',
    domain: 'general',
    explanation: 'UVB radiation converts 7-dehydrocholesterol in the skin into Vitamin D3.',
  },
];

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function generateAiQuizRound(params: {
  count?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  excludeQuestions?: string[];
  topicHint?: string;
}): Promise<{
  questions: GeneratedQuizItem[];
  breakdown: { total: number; csCount: number; generalCount: number; csPercent: number; generalPercent: number };
  model: string;
}> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const total = Math.max(5, Math.min(20, Math.round(Number(params.count) || 10)));
  const csTarget = Math.round(total * 0.7);
  const generalTarget = total - csTarget;
  const difficulty = params.difficulty || 'medium';
  const excludeSet = new Set(
    (params.excludeQuestions || []).map((q) => String(q).trim().toLowerCase()).filter(Boolean)
  );

  // Request slightly extra items per bucket to survive deduplication and guarantee exact 70/30 count
  const csReq = csTarget + 2;
  const genReq = generalTarget + 2;

  const prompt = `Generate ${csReq + genReq} fresh, unique multiple-choice quiz questions at "${difficulty}" difficulty.
STRICT RATIO REQUIREMENT:
- Exactly ${csReq} questions must have domain="cs" covering Computer Science & Engineering (Data Structures, Algorithms, DBMS, Operating Systems, Computer Networks, Web/React/TypeScript, Software Architecture, Cybersecurity, AI/ML).
- Exactly ${genReq} questions must have domain="general" covering General Trivia (Science, Space, Geography, Sports, World History, Literature, Everyday Logic).
${params.topicHint ? `Focus theme hint: ${params.topicHint}` : ''}
${excludeSet.size > 0 ? `Do NOT repeat any of these questions: ${Array.from(excludeSet).slice(0, 12).join(' | ')}` : ''}

Every question must have:
- q: clear single question string
- options: exactly 4 distinct plausible strings
- answer: integer 0, 1, 2, or 3 indicating the single correct option index
- category: concise label (e.g. "Algorithms", "DBMS", "Space", "World Geography")
- domain: strictly "cs" or "general"
- explanation: 1 concise sentence explaining why the answer is right`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                q: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                answer: { type: Type.INTEGER },
                category: { type: Type.STRING },
                domain: { type: Type.STRING, enum: ['cs', 'general'] },
                explanation: { type: Type.STRING },
              },
              required: ['q', 'options', 'answer', 'category', 'domain', 'explanation'],
            },
          },
        },
        required: ['questions'],
      },
    },
  });

  const parsed = JSON.parse(response.text || '{}') as { questions?: any[] };
  const rawList = Array.isArray(parsed.questions) ? parsed.questions : [];
  if (rawList.length === 0) {
    throw new Error('Gemini returned zero quiz questions.');
  }

  const seenQ = new Set<string>(excludeSet);
  const csBucket: GeneratedQuizItem[] = [];
  const generalBucket: GeneratedQuizItem[] = [];

  for (const item of rawList) {
    const qText = String(item?.q || '').trim();
    const norm = qText.toLowerCase();
    const options = Array.isArray(item?.options)
      ? item.options.map((o: any) => String(o).trim()).filter(Boolean).slice(0, 4)
      : [];
    const ans = Number(item?.answer);
    const domain = item?.domain === 'general' ? 'general' : 'cs';

    if (!qText || seenQ.has(norm) || options.length !== 4 || !Number.isInteger(ans) || ans < 0 || ans > 3) {
      continue;
    }
    seenQ.add(norm);

    const normalizedItem: GeneratedQuizItem = {
      q: qText,
      options,
      answer: ans,
      category: String(item?.category || (domain === 'cs' ? 'Computer Science' : 'General Trivia')).trim(),
      domain,
      explanation: String(item?.explanation || '').trim() || 'Verified correct answer.',
    };

    if (domain === 'cs') csBucket.push(normalizedItem);
    else generalBucket.push(normalizedItem);
  }

  // Enforce strict 70% CS / 30% General counts using curated backup only if Gemini slightly under-counted one bucket
  const backupCs = shuffleArray(SERVER_QUIZ_BACKUP_BANK.filter((b) => b.domain === 'cs' && !seenQ.has(b.q.toLowerCase())));
  const backupGen = shuffleArray(SERVER_QUIZ_BACKUP_BANK.filter((b) => b.domain === 'general' && !seenQ.has(b.q.toLowerCase())));

  while (csBucket.length < csTarget && backupCs.length > 0) {
    const next = backupCs.shift()!;
    csBucket.push(next);
  }
  while (generalBucket.length < generalTarget && backupGen.length > 0) {
    const next = backupGen.shift()!;
    generalBucket.push(next);
  }

  const finalCs = csBucket.slice(0, csTarget);
  const finalGeneral = generalBucket.slice(0, generalTarget);
  const combined = shuffleArray([...finalCs, ...finalGeneral]);

  return {
    questions: combined,
    breakdown: {
      total: combined.length,
      csCount: finalCs.length,
      generalCount: finalGeneral.length,
      csPercent: combined.length > 0 ? Math.round((finalCs.length / combined.length) * 100) : 70,
      generalPercent: combined.length > 0 ? Math.round((finalGeneral.length / combined.length) * 100) : 30,
    },
    model: GEMINI_MODEL,
  };
}

// Fast deterministic abusive-language & spam guard (runs instantly & offline-safe)
const ABUSIVE_REGEX =
  /\b(fuck|fucking|motherfucker|bitch|asshole|bastard|slut|whore|dickhead|chutiya|madarchod|behenchod|bsdk|bhosdike|harami|kamina|idiot|moron|kill\s+yourself|kys|nigger|faggot|retard)\b/i;
const SPAM_REGEX =
  /(https?:\/\/[^\s]+\s*){3,}|(.)\2{7,}|(free\s+(money|nitro|crypto|followers|points)|click\s+here\s+to\s+claim|win\s+\$?\d+\s+now|guaranteed\s+profit)/i;

export interface ModerationVerdict {
  allowed: boolean;
  flagged: boolean;
  severity: 'none' | 'warning' | 'block';
  category: string;
  reason: string;
  source: 'heuristic' | 'gemini';
}

export function runFastHeuristicModeration(text: string): ModerationVerdict {
  const clean = text.trim();
  if (!clean) {
    return { allowed: true, flagged: false, severity: 'none', category: 'clean', reason: '', source: 'heuristic' };
  }
  if (ABUSIVE_REGEX.test(clean)) {
    return {
      allowed: false,
      flagged: true,
      severity: 'block',
      category: 'abusive_language',
      reason: 'Abusive or disrespectful language is blocked in public comments and game room chats.',
      source: 'heuristic',
    };
  }
  if (SPAM_REGEX.test(clean)) {
    return {
      allowed: false,
      flagged: true,
      severity: 'block',
      category: 'spam',
      reason: 'Promotional spam or repetitive flood messages are blocked.',
      source: 'heuristic',
    };
  }
  return { allowed: true, flagged: false, severity: 'none', category: 'clean', reason: '', source: 'heuristic' };
}

export async function moderatePublicText(params: {
  text: string;
  context?: 'comment' | 'room_chat' | 'post';
}): Promise<ModerationVerdict> {
  const heuristic = runFastHeuristicModeration(params.text);
  if (!heuristic.allowed) {
    return heuristic;
  }

  const ai = getGeminiClient();
  if (!ai) {
    return heuristic;
  }

  const ctxLabel =
    params.context === 'room_chat'
      ? 'multiplayer game room public chat'
      : params.context === 'post'
      ? 'public campus feed post'
      : 'public post/reel comment';

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: `Analyze this ${ctxLabel} message on a college social & gaming platform for abusive language, harassment, slurs, threats, NSFW toxicity, or spam/scams.
Allow normal playful gaming banter (e.g. "gg", "nice move!", "checkmate soon haha"), campus discussion, Hindi/English casual greetings, and constructive criticism.
Block or warn ONLY genuine abuse, insults, slurs, harassment, or spam.

Message: """${params.text.trim().slice(0, 1000)}"""`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          allowed: { type: Type.BOOLEAN },
          flagged: { type: Type.BOOLEAN },
          severity: { type: Type.STRING, enum: ['none', 'warning', 'block'] },
          category: { type: Type.STRING },
          reason: { type: Type.STRING },
        },
        required: ['allowed', 'flagged', 'severity', 'category', 'reason'],
      },
    },
  });

  const parsed = JSON.parse(response.text || '{}') as Partial<ModerationVerdict>;
  const severity =
    parsed.severity === 'block' || parsed.severity === 'warning' ? parsed.severity : 'none';
  const allowed = typeof parsed.allowed === 'boolean' ? parsed.allowed : severity !== 'block';

  return {
    allowed,
    flagged: Boolean(parsed.flagged) || !allowed || severity !== 'none',
    severity,
    category: String(parsed.category || (allowed ? 'clean' : 'policy_violation')),
    reason: String(parsed.reason || '').trim(),
    source: 'gemini',
  };
}
