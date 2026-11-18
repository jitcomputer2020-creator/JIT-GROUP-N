import {
  generateAiQuizRound,
  classifyGeminiHttpError,
} from '../../src/server/geminiService';

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const count = Number(body?.count) || 10;
    const difficulty =
      body?.difficulty === 'easy' || body?.difficulty === 'hard' ? body.difficulty : 'medium';
    const excludeQuestions = Array.isArray(body?.excludeQuestions) ? body.excludeQuestions : [];
    const topicHint = typeof body?.topicHint === 'string' ? body.topicHint : undefined;

    const result = await generateAiQuizRound({
      count,
      difficulty,
      excludeQuestions,
      topicHint,
    });
    return res.status(200).json(result);
  } catch (err: any) {
    const info = classifyGeminiHttpError(err);
    return res.status(info.status).json({ error: info.message, code: info.code });
  }
}
