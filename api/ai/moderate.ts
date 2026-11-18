import {
  moderatePublicText,
  runFastHeuristicModeration,
} from '../../src/server/geminiService';

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
  }

  let text = '';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    text = typeof body?.text === 'string' ? body.text : '';
    const context =
      body?.context === 'room_chat' || body?.context === 'post' ? body.context : 'comment';

    if (!text.trim()) {
      return res.status(200).json({
        allowed: true,
        flagged: false,
        severity: 'none',
        category: 'clean',
        reason: '',
        source: 'heuristic',
      });
    }

    const verdict = await moderatePublicText({ text, context });
    return res.status(200).json(verdict);
  } catch {
    return res.status(200).json(runFastHeuristicModeration(text));
  }
}
