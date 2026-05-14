// SIMPLEONE COPILOT FRONTEND
// postMessage contract version: 1.0
// Compatible with: copilot_ui_action.js
//
// Incoming (SimpleOne → iframe):
//   { type: 'copilot.handshake', payload: { record_id, table_name, csrf_token } }
// Outgoing (iframe → SimpleOne):
//   { type: 'copilot.insert_solution',  payload: { text } }
//   { type: 'copilot.close_modal' }
//   { type: 'copilot.link_ticket',      payload: { related_record_id, related_number } }
//   { type: 'copilot.feedback',         payload: { value, source_type, source_id } }

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name) || '';
}
function normalizeOrigin(v) {
  try { return new URL(v).origin; } catch { return ''; }
}

// --- Yandex AI proxy (server-side, key never reaches the browser) ---
async function callYandexAI(ctx) {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ctx),
    signal: AbortSignal.timeout(11000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'server error');
  return data;
}

// --- Mock data ---
const KB_ARTICLES = [
  {
    id: 'kb-001',
    title: 'Сброс пароля в корпоративной сети AD',
    url: '#kb-001',
    excerpt:
      'Для сброса пароля сотрудника перейдите в AD Users and Computers, найдите учётную запись и выполните сброс через контекстное меню. Убедитесь, что у пользователя включена опция «Сменить пароль при следующем входе».',
    solution:
      'Выполнен сброс пароля через AD Users and Computers. Пользователю отправлена инструкция по смене пароля при следующем входе. Учётная запись разблокирована.',
  },
  {
    id: 'kb-002',
    title: 'Настройка VPN-подключения для удалённых сотрудников',
    url: '#kb-002',
    excerpt:
      'Инструкция по установке корпоративного VPN-клиента на Windows 10/11. Включает конфигурацию профиля подключения и установку корпоративного сертификата для безопасного доступа.',
    solution:
      'Установлен VPN-клиент версии 4.2.1, настроен профиль подключения с корпоративным сертификатом. Подключение проверено и работает стабильно.',
  },
  {
    id: 'kb-003',
    title: 'Восстановление доступа к Exchange / Microsoft 365',
    url: '#kb-003',
    excerpt:
      'При блокировке учётной записи Exchange выполните разблокировку через Exchange Admin Center. Проверьте политику паролей и статус лицензии в Microsoft 365 Admin Center.',
    solution:
      'Учётная запись Exchange разблокирована через EAC. Политика паролей скорректирована. Лицензия Office 365 активна, доступ к почте восстановлен.',
  },
];

const SIMILAR_TICKETS = [
  {
    id: 'inc-001',
    number: 'INC0041872',
    recordId: 'a1b2c3d4e5f6',
    description: 'Не работает авторизация в корпоративном портале',
    resolution:
      'Выполнен сброс сессии пользователя, очищен кэш браузера. Проблема связана с устаревшим токеном авторизации. После повторного входа доступ восстановлен в полном объёме.',
  },
  {
    id: 'inc-002',
    number: 'INC0038541',
    recordId: 'b2c3d4e5f6a1',
    description: 'Запрос на сброс пароля для нового сотрудника',
    resolution:
      'Создана учётная запись в AD, выдан временный пароль. Пользователю отправлено письмо с инструкцией по первому входу и обязательной смене пароля через самосервисный портал.',
  },
  {
    id: 'inc-003',
    number: 'INC0035209',
    recordId: 'c3d4e5f6a1b2',
    description: 'Не удаётся подключиться к VPN из домашней сети',
    resolution:
      'Переустановлен VPN-клиент, обновлены сертификаты пользователя. Причина — истёкший клиентский сертификат. VPN-подключение восстановлено и протестировано.',
  },
];

const BOT_REPLIES = [
  {
    text: 'На основе описания рекомендую проверить настройки учётной записи в Active Directory — вероятна блокировка или истечение срока пароля.',
    citations: [{ label: 'KB: Сброс пароля AD', id: 'kb-001' }, { label: 'INC0041872', id: 'inc-001' }],
  },
  {
    text: 'Похожие инциденты решались перезапуском службы или очисткой кэша браузера. Попробуйте эти шаги и сообщите о результате.',
    citations: [{ label: 'INC0038541', id: 'inc-002' }],
  },
  {
    text: 'Для данной категории заявок средний SLA составляет 4 часа. Рекомендую эскалировать в L2, если проблема не решена за 2 часа.',
    citations: [],
  },
  {
    text: 'Нашёл 3 похожие заявки. Наиболее вероятное решение — сброс пароля и проверка прав доступа пользователя.',
    citations: [{ label: 'KB: VPN-подключение', id: 'kb-002' }, { label: 'INC0035209', id: 'inc-003' }],
  },
];

// --- Root app ---
function App() {
  const simpleoneOrigin = normalizeOrigin(getParam('simpleone_origin'));
  const [ctx, setCtx] = useState({
    tableName: getParam('table_name'),
    recordId: getParam('record_id'),
    number: getParam('number'),
    subject: getParam('subject') || 'Не удаётся войти в корпоративный портал',
    csrfToken: '',
  });
  const [applied, setApplied] = useState(false);
  const [analysisData, setAnalysisData]     = useState(null);
  const [analysisStatus, setAnalysisStatus] = useState('idle'); // 'idle'|'loading'|'ready'|'error'|'timeout'
  const analysisTimerRef = useRef(null);
  const isIframe = window.parent !== window;

  // Start a Yandex AI analysis request; sets loading/ready/error state automatically
  const triggerYandexAnalysis = useCallback((aiCtx) => {
    setAnalysisStatus('loading');
    clearTimeout(analysisTimerRef.current);
    analysisTimerRef.current = setTimeout(() => {
      setAnalysisStatus(s => s === 'loading' ? 'timeout' : s);
    }, 10000);

    callYandexAI(aiCtx)
      .then(data => {
        clearTimeout(analysisTimerRef.current);
        setAnalysisData(data);
        setAnalysisStatus('ready');
      })
      .catch(err => {
        clearTimeout(analysisTimerRef.current);
        console.error('[Copilot] Yandex AI error:', err.message);
        setAnalysisStatus('error');
      });
  }, []); // setters and ref are stable across renders

  // Incoming messages from SimpleOne
  useEffect(() => {
    if (!simpleoneOrigin) return;
    function onMessage(e) {
      if (e.origin !== simpleoneOrigin) return;
      const msg = e.data || {};

      if (msg.type === 'copilot.handshake') {
        const p = msg.payload || {};
        // Only update metadata — analysis already started on mount
        setCtx(prev => ({
          ...prev,
          recordId:  p.record_id  || prev.recordId,
          tableName: p.table_name || prev.tableName,
          csrfToken: p.csrf_token || '',
        }));
      }

      // Keep this handler: used when SimpleOne backend (CopilotAjaxProcessor) is wired up
      if (msg.type === 'copilot.analysis_result') {
        clearTimeout(analysisTimerRef.current);
        setAnalysisData(msg.payload || null);
        setAnalysisStatus('ready');
      }

      if (msg.type === 'copilot.error') {
        clearTimeout(analysisTimerRef.current);
        setAnalysisStatus('error');
      }
    }
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(analysisTimerRef.current);
    };
  }, [simpleoneOrigin, triggerYandexAnalysis]);

  // Always start analysis on mount from URL params — UIAction already embedded them in the iframe URL,
  // so this works both standalone and when opened from SimpleOne without waiting for handshake.
  useEffect(() => {
    triggerYandexAnalysis({
      number:           getParam('number'),
      subject:          getParam('subject'),
      description:      getParam('description'),
      priority:         getParam('priority'),
      category:         getParam('category'),
      service:          getParam('service'),
      assignment_group: getParam('assignment_group'),
    });
  }, [triggerYandexAnalysis]);

  function post(type, payload = {}) {
    if (!isIframe || !simpleoneOrigin) return;
    window.parent.postMessage({ type, payload }, simpleoneOrigin);
  }

  function closeModal()   { post('copilot.close_modal'); }
  function insertSolution(text, sourceType, sourceId) {
    post('copilot.insert_solution', { text });
    setApplied(true);
  }
  function sendFeedback(value, sourceType, sourceId) {
    post('copilot.feedback', { value, source_type: sourceType, source_id: sourceId });
  }
  function linkTicket(relatedRecordId, relatedNumber) {
    post('copilot.link_ticket', { related_record_id: relatedRecordId, related_number: relatedNumber });
  }
  function markApplied() {
    post('copilot.feedback', { value: 'applied', source_type: 'manual', source_id: '' });
    setApplied(true);
  }

  return (
    <div className="cp-modal">
      <Header number={ctx.number} subject={ctx.subject} onClose={closeModal} />
      <Body
        onInsert={insertSolution}
        onFeedback={sendFeedback}
        onLink={linkTicket}
        analysisData={analysisData}
        analysisStatus={analysisStatus}
      />
      <Footer applied={applied} onApplied={markApplied} aiStatus={analysisStatus} />
    </div>
  );
}

// --- Header ---
function Header({ number, subject, onClose }) {
  const [summarizing, setSummarizing] = useState(false);

  function summarize() {
    setSummarizing(true);
    setTimeout(() => setSummarizing(false), 2000);
  }

  return (
    <header className="cp-header">
      <div className="cp-header-left">
        <div className="cp-logo">
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill="#2563eb" opacity=".15" />
            <path d="M12 5l2 5.5h5.5l-4.5 3.2 1.7 5.3L12 16l-4.7 3 1.7-5.3L4.5 10.5H10L12 5z" fill="#2563eb" />
          </svg>
        </div>
        <div className="cp-header-title-block">
          <h1 className="cp-title">Копайлот</h1>
          {(number || subject) && (
            <p className="cp-subtitle">
              {number && <span className="cp-ticket-chip">{number}</span>}
              {subject && <span className="cp-subject-text">{subject}</span>}
            </p>
          )}
        </div>
      </div>
      <div className="cp-header-right">
        <button
          className={`cp-btn cp-btn-outline${summarizing ? ' cp-btn--loading' : ''}`}
          onClick={summarize}
          disabled={summarizing}
        >
          {summarizing ? (
            <><span className="cp-spinner" /> Анализирую…</>
          ) : 'Суммировать заявку'}
        </button>
        <button className="cp-btn-icon" onClick={onClose} aria-label="Закрыть">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
          </svg>
        </button>
      </div>
    </header>
  );
}

// --- Body ---
function Body({ onInsert, onFeedback, onLink, analysisData, analysisStatus }) {
  const [tab, setTab] = useState('hints');
  const TABS = [
    { id: 'hints',   label: 'Подсказки ИИ' },
    { id: 'similar', label: 'Похожие заявки' },
    { id: 'chat',    label: 'Чат' },
  ];
  return (
    <div className="cp-body">
      <nav className="cp-tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            className={`cp-tab${tab === t.id ? ' active' : ''}`}
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="cp-panel" role="tabpanel">
        {tab === 'hints'   && <HintsTab   onInsert={onInsert} onFeedback={onFeedback} analysisData={analysisData} analysisStatus={analysisStatus} />}
        {tab === 'similar' && <SimilarTab onInsert={onInsert} onFeedback={onFeedback} onLink={onLink}            analysisData={analysisData} analysisStatus={analysisStatus} />}
        {tab === 'chat'    && <ChatTab    onInsert={onInsert} />}
      </div>
    </div>
  );
}

// --- Skeleton card ---
function SkeletonCard() {
  return (
    <div className="cp-card cp-card--skeleton">
      <div className="sk sk-w55" />
      <div className="sk sk-w100" />
      <div className="sk sk-w80" />
      <div className="sk sk-w40 sk-btn" />
    </div>
  );
}

// --- Feedback row ---
function FeedbackRow({ sourceType, sourceId, onFeedback }) {
  const [vote, setVote] = useState(null);
  function cast(v) {
    setVote(v);
    onFeedback(v, sourceType, sourceId);
  }
  return (
    <div className="cp-feedback-row">
      <span className="cp-feedback-label">Полезно?</span>
      <button
        className={`cp-vote-btn${vote === 'helpful' ? ' active' : ''}`}
        onClick={() => cast('helpful')}
        title="Полезно"
      >👍</button>
      <button
        className={`cp-vote-btn${vote === 'not_helpful' ? ' active' : ''}`}
        onClick={() => cast('not_helpful')}
        title="Не полезно"
      >👎</button>
    </div>
  );
}

// --- Tab: Подсказки ИИ ---
function HintsTab({ onInsert, onFeedback, analysisData, analysisStatus }) {
  if (analysisStatus === 'idle' || analysisStatus === 'loading') {
    return <ul className="cp-card-list">{KB_ARTICLES.map(a => <li key={a.id}><SkeletonCard /></li>)}</ul>;
  }

  const serverArticles = analysisData?.kb_articles;
  const items = (serverArticles && serverArticles.length > 0) ? serverArticles : KB_ARTICLES;
  const showNotice = analysisStatus === 'error' || analysisStatus === 'timeout';

  return (
    <>
      {showNotice && (
        <div className="cp-ai-notice">ИИ-функции временно недоступны — показаны рекомендации по умолчанию.</div>
      )}
      <ul className="cp-card-list">
        {items.map(a => (
          <li key={a.id} className="cp-card">
            <a href={a.url} className="cp-card-link" target="_blank" rel="noreferrer">{a.title}</a>
            <p className="cp-card-text">{a.excerpt}</p>
            <div className="cp-card-actions">
              <button className="cp-btn cp-btn-action" onClick={() => onInsert(a.solution, 'kb_article', a.id)}>
                Вставить решение
              </button>
              <FeedbackRow sourceType="kb_article" sourceId={a.id} onFeedback={onFeedback} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

// --- Tab: Похожие заявки ---
function SimilarCard({ ticket, onInsert, onFeedback, onLink }) {
  const [expanded, setExpanded] = useState(false);
  const SHORT = 120;
  const isLong = ticket.resolution.length > SHORT;
  const displayText = expanded || !isLong
    ? ticket.resolution
    : ticket.resolution.slice(0, SHORT) + '…';

  return (
    <li className="cp-card">
      <div className="cp-ticket-meta">
        <span className="cp-badge">{ticket.number}</span>
        <span className="cp-ticket-desc">{ticket.description}</span>
      </div>
      <p className="cp-card-text">
        {displayText}
        {isLong && (
          <button className="cp-expand-btn" onClick={() => setExpanded(e => !e)}>
            {expanded ? ' Свернуть' : ' Показать полностью'}
          </button>
        )}
      </p>
      <div className="cp-card-actions">
        <button className="cp-btn cp-btn-action" onClick={() => onInsert(ticket.resolution, 'similar_ticket', ticket.id)}>
          Клонировать решение
        </button>
        <button className="cp-btn cp-btn-ghost" onClick={() => onLink(ticket.recordId, ticket.number)}>
          Связать заявку
        </button>
        <FeedbackRow sourceType="similar_ticket" sourceId={ticket.id} onFeedback={onFeedback} />
      </div>
    </li>
  );
}

function SimilarTab({ onInsert, onFeedback, onLink, analysisData, analysisStatus }) {
  if (analysisStatus === 'idle' || analysisStatus === 'loading') {
    return <ul className="cp-card-list">{SIMILAR_TICKETS.map(t => <li key={t.id}><SkeletonCard /></li>)}</ul>;
  }

  const serverTickets = analysisData?.similar_tickets;
  // Normalize server field name (record_id) to match SimilarCard's expected shape (recordId)
  const items = (serverTickets && serverTickets.length > 0)
    ? serverTickets.map(t => ({ ...t, recordId: t.record_id || t.recordId || '' }))
    : SIMILAR_TICKETS;
  const showNotice = analysisStatus === 'error' || analysisStatus === 'timeout';

  return (
    <>
      {showNotice && (
        <div className="cp-ai-notice">ИИ-функции временно недоступны — показаны примеры.</div>
      )}
      <ul className="cp-card-list">
        {items.map(t => (
          <SimilarCard key={t.id} ticket={t} onInsert={onInsert} onFeedback={onFeedback} onLink={onLink} />
        ))}
      </ul>
    </>
  );
}

// --- Tab: Чат ---
function ChatTab() {
  const [msgs, setMsgs] = useState([
    { role: 'bot', text: 'Привет! Я Копайлот. Задайте вопрос по текущей заявке — постараюсь помочь.', citations: [] },
  ]);
  const [input, setInput]   = useState('');
  const [waiting, setWaiting] = useState(false);
  const bottomRef = useRef(null);
  const replyIdx  = useRef(0);

  function send() {
    const text = input.trim();
    if (!text || waiting) return;
    const next = [...msgs, { role: 'user', text, citations: [] }];
    setMsgs(next);
    setInput('');
    setWaiting(true);
    setTimeout(() => {
      const reply = BOT_REPLIES[replyIdx.current % BOT_REPLIES.length];
      replyIdx.current++;
      setMsgs(prev => [...prev, { role: 'bot', ...reply }]);
      setWaiting(false);
    }, 800);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, waiting]);

  return (
    <div className="cp-chat">
      <div className="cp-chat-messages">
        {msgs.map((m, i) => (
          <div key={i} className={`cp-msg cp-msg--${m.role}`}>
            {m.role === 'bot' && <div className="cp-avatar">AI</div>}
            <div className="cp-msg-body">
              <span className="cp-msg-bubble">{m.text}</span>
              {m.citations?.length > 0 && (
                <div className="cp-citations">
                  {m.citations.map(c => (
                    <a key={c.id} href={`#${c.id}`} className="cp-citation-chip">{c.label}</a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {waiting && (
          <div className="cp-msg cp-msg--bot">
            <div className="cp-avatar">AI</div>
            <div className="cp-msg-body">
              <span className="cp-msg-bubble cp-typing">
                <span /><span /><span />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="cp-chat-input-row">
        <textarea
          className="cp-chat-input"
          value={input}
          rows={2}
          placeholder="Введите сообщение… (Enter — отправить)"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="cp-btn cp-btn-primary" onClick={send} disabled={waiting}>
          Отправить
        </button>
      </div>
    </div>
  );
}

// --- Footer ---
function Footer({ applied, onApplied, aiStatus }) {
  const online  = aiStatus === 'ready';
  const loading = aiStatus === 'idle' || aiStatus === 'loading';
  const dotClass = online ? 'cp-status-dot--online' : loading ? 'cp-status-dot--loading' : 'cp-status-dot--offline';
  const label    = online ? 'ИИ доступен' : loading ? 'ИИ подключается…' : 'ИИ недоступен';

  return (
    <footer className="cp-footer">
      <button
        className={`cp-btn${applied ? ' cp-btn-applied' : ' cp-btn-outline'}`}
        onClick={onApplied}
        disabled={applied}
      >
        {applied ? 'Применено ✓' : 'Применено ✓'}
      </button>
      <div className="cp-ai-status">
        <span className={`cp-status-dot ${dotClass}`} />
        {label}
      </div>
    </footer>
  );
}

createRoot(document.getElementById('root')).render(<App />);
