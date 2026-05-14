import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app    = express();
const PORT   = 80;
const KEY    = process.env.YANDEX_API_KEY   || '';
const FOLDER = process.env.YANDEX_FOLDER_ID || '';
const YANDEX = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

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
    const upstream = await fetch(YANDEX, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Api-Key ${KEY}`,
        'x-folder-id': FOLDER,
      },
      body: JSON.stringify({
        modelUri: `gpt://${FOLDER}/yandexgpt/latest`,
        completionOptions: { stream: false, temperature: 0.1, maxTokens: '2000' },
        messages: [
          { role: 'system', text: systemText },
          { role: 'user',   text: userText },
        ],
      }),
      signal: AbortSignal.timeout(12000),
    });

    const json = await upstream.json();
    if (!upstream.ok) {
      console.error('[yandex-ai] error response:', upstream.status, JSON.stringify(json));
      return res.status(502).json({ ok: false, error: `Yandex AI HTTP ${upstream.status}` });
    }

    const raw   = json?.result?.alternatives?.[0]?.message?.text ?? '';
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const data  = JSON.parse(clean);
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error('[yandex-ai] fetch error:', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.get('/health', (_req, res) => res.send('ok'));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, 'dist')));
app.use((_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`copilot-frontend :${PORT}`));
