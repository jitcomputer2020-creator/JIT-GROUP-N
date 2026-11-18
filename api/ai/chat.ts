import {
  runJitAiChat,
  classifyGeminiHttpError,
} from '../../src/server/geminiService';

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const history = Array.isArray(body?.history) ? body.history : [];
    const userName = typeof body?.userName === 'string' ? body.userName : undefined;
    const mode = body?.mode === 'studies' || body?.mode === 'tech' ? body.mode : 'general';

    if (!message) {
      return res.status(400).json({ error: 'Message text is required.', code: 'BAD_REQUEST' });
    }

    const result = await runJitAiChat({ message, history, userName, mode });
    return res.status(200).json({
      reply: result.reply,
      model: result.model,
      createdAtMs: Date.now(),
    });
  } catch (err: any) {
    const info = classifyGeminiHttpError(err);
    return res.status(info.status).json({ error: info.message, code: info.code });
  }
}
