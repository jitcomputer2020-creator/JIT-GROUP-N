import {
  generateSmartCaptions,
  classifyGeminiHttpError,
} from '../../src/server/geminiService';

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const topic = typeof body?.topic === 'string' ? body.topic : '';
    const existingText = typeof body?.existingText === 'string' ? body.existingText : '';
    const contentType = body?.contentType === 'reel' ? 'reel' : 'post';
    const tone = typeof body?.tone === 'string' ? body.tone : 'engaging';

    const result = await generateSmartCaptions({ topic, existingText, contentType, tone });
    return res.status(200).json(result);
  } catch (err: any) {
    const info = classifyGeminiHttpError(err);
    return res.status(info.status).json({ error: info.message, code: info.code });
  }
}
