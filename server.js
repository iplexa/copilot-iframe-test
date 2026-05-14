import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app    = express();
const PORT   = 80;
const KEY      = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK = 'https://api.deepseek.com/v1/chat/completions';

app.use(express.json({ limit: '64kb' }));

app.post('/api/analyze', async (req, res) => {
  const ctx = req.body || {};

  const systemText = `Ты ИИ-ассистент IT-службы поддержки (ITSM).
Проанализируй заявку и верни ТОЛЬКО валидный JSON без markdown-обёртки строго по схеме:
{
  "summary": "резюме проблемы в 1-2 предложениях",
  "kb_articles": [
    {"id":"kb-1","title":"...","url":"#","excerpt":"краткий отрывок","solution":"текст решения"}
  ],
  "similar_tickets": [
    {"id":"inc-1","number":"INCxxxxxxx","record_id":"","description":"...","resolution":"..."}
  ],
  "draft_solution": "черновик решения для инженера"
}
Верни 2-3 статьи базы знаний и 2-3 похожих инцидента, релевантных описанию заявки.`;

  const userText = [
    `Номер: ${ctx.number            || '—'}`,
    `Тема: ${ctx.subject            || '—'}`,
    `Описание: ${ctx.description    || ctx.subject || '—'}`,
    `Приоритет: ${ctx.priority      || '—'}`,
    `Категория: ${ctx.category      || '—'}`,
    `Услуга: ${ctx.service          || '—'}`,
    `Группа: ${ctx.assignment_group || '—'}`,
  ].join('\n');

  try {
    const upstream = await fetch(DEEPSEEK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        temperature: 0.1,
        max_tokens: 2000,
        messages: [
          { role: 'system', content: systemText },
          { role: 'user',   content: userText },
        ],
      }),
      signal: AbortSignal.timeout(12000),
    });

    const json = await upstream.json();
    if (!upstream.ok) {
      console.error('[deepseek] error response:', upstream.status, JSON.stringify(json));
      return res.status(502).json({ ok: false, error: `DeepSeek HTTP ${upstream.status}` });
    }

    const raw   = json?.choices?.[0]?.message?.content ?? '';
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const data  = JSON.parse(clean);
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[deepseek] fetch error:', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.get('/health', (_req, res) => res.send('ok'));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'dist')));
app.use((_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`copilot-frontend :${PORT}`));
