/*
 * SimpleOne Copilot — iframe frontend (React/Vite build)
 *
 * Architecture mapping:
 *   - This file is the entry point served inside the <iframe> of a SimpleOne UI Action modal.
 *   - URL params received from SimpleOne: source, table_name, record_id, number, simpleone_origin.
 *   - postMessage events sent to parent:
 *       copilot.insert_solution  → triggers s_form.setValue('close_notes', payload.text) in the UI Action
 *       copilot.close_modal      → triggers g_modal.close() in the UI Action
 *   - No backend calls are made; all data is hardcoded mock (MVP).
 */

import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// --- URL context helpers ---
function getParam(name) {
  return new URLSearchParams(window.location.search).get(name) || '';
}
function normalizeOrigin(value) {
  try { return new URL(value).origin; } catch { return ''; }
}

// --- Mock data ---
const KB_ARTICLES = [
  {
    id: 1,
    title: 'Сброс пароля в корпоративной сети',
    excerpt:
      'Для сброса пароля сотрудника необходимо перейти в AD Users and Computers, найти учётную запись и выполнить сброс через контекстное меню. Убедитесь, что пользователь авторизован для смены пароля при следующем входе.',
    solution:
      'Выполнен сброс пароля через AD Users and Computers. Пользователю отправлена инструкция по смене пароля при следующем входе. Учётная запись разблокирована.',
  },
  {
    id: 2,
    title: 'Настройка VPN-подключения для удалённых сотрудников',
    excerpt:
      'Инструкция по настройке корпоративного VPN-клиента на Windows 10/11. Включает установку сертификатов и конфигурацию профиля подключения для безопасного доступа к внутренним ресурсам.',
    solution:
      'Установлен VPN-клиент версии 4.2.1, настроен профиль подключения с использованием корпоративного сертификата. Подключение проверено и работает стабильно.',
  },
  {
    id: 3,
    title: 'Восстановление доступа к корпоративной почте',
    excerpt:
      'При блокировке учётной записи Exchange необходимо выполнить разблокировку через EAC. Проверьте политику паролей и статус лицензии пользователя в Microsoft 365 Admin Center.',
    solution:
      'Учётная запись Exchange разблокирована через EAC. Проверена и скорректирована политика паролей. Лицензия Office 365 активна, доступ к почте восстановлен.',
  },
];

const SIMILAR_TICKETS = [
  {
    id: 1,
    number: 'INC0041872',
    description: 'Не работает авторизация в корпоративном портале',
    resolution:
      'Выполнен сброс сессии пользователя, очищен кэш браузера. Проблема связана с устаревшим токеном авторизации. После повторного входа доступ восстановлен.',
  },
  {
    id: 2,
    number: 'INC0038541',
    description: 'Запрос на сброс пароля для нового сотрудника',
    resolution:
      'Создана учётная запись в AD, выдан временный пароль. Пользователю отправлено письмо с инструкцией по первому входу и обязательной смене пароля через самосервисный портал.',
  },
  {
    id: 3,
    number: 'INC0035209',
    description: 'Не удаётся подключиться к VPN из домашней сети',
    resolution:
      'Переустановлен VPN-клиент, обновлены сертификаты пользователя. Проблема заключалась в истёкшем сертификате. VPN-подключение восстановлено и протестировано.',
  },
];

const BOT_REPLIES = [
  'На основе описания заявки рекомендую проверить настройки учётной записи в Active Directory — возможна блокировка или истечение срока пароля.',
  'Похожие инциденты чаще всего решаются перезапуском службы или очисткой кэша. Попробуйте эти шаги и сообщите о результате.',
  'Для данной категории заявок средний SLA составляет 4 часа. Рекомендую эскалировать в L2, если проблема не решена за 2 часа.',
  'Нашёл 3 похожие заявки в базе. Наиболее вероятное решение — сброс пароля и проверка прав доступа пользователя.',
];

// --- Root app ---
function App() {
  const simpleoneOrigin = normalizeOrigin(getParam('simpleone_origin'));
  const tableName = getParam('table_name');
  const recordId = getParam('record_id');
  const number = getParam('number');

  const isIframe = window.parent !== window;
  const targetOrigin = simpleoneOrigin || '*';

  function post(type, payload = {}) {
    if (!isIframe) return;
    window.parent.postMessage(
      { type, payload: { ...payload, table_name: tableName, record_id: recordId, number } },
      targetOrigin,
    );
  }

  return (
    <div className="cp-modal">
      <Header onClose={() => post('copilot.close_modal')} />
      <Body onInsert={(text) => post('copilot.insert_solution', { text })} />
      <Footer onClose={() => post('copilot.close_modal')} />
    </div>
  );
}

// --- Header ---
function Header({ onClose }) {
  const [busy, setBusy] = useState(false);

  function summarize() {
    setBusy(true);
    setTimeout(() => setBusy(false), 1800);
  }

  return (
    <header className="cp-header">
      <div className="cp-header-brand">
        <svg className="cp-icon-logo" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="8" fill="#2458e6" opacity=".12" />
          <path d="M10 4l1.5 4.5H16l-3.75 2.7 1.44 4.3L10 13.1l-3.69 2.4 1.44-4.3L4 8.5h4.5L10 4z" fill="#2458e6" />
        </svg>
        <h1 className="cp-title">Копайлот</h1>
      </div>
      <div className="cp-header-actions">
        <button
          className={`cp-btn cp-btn-outline ${busy ? 'cp-btn-busy' : ''}`}
          onClick={summarize}
          disabled={busy}
        >
          {busy ? 'Анализирую…' : 'Суммировать заявку'}
        </button>
        <button className="cp-btn-icon" onClick={onClose} aria-label="Закрыть">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <line x1="3" y1="3" x2="13" y2="13" />
            <line x1="13" y1="3" x2="3" y2="13" />
          </svg>
        </button>
      </div>
    </header>
  );
}

// --- Body with tabs ---
function Body({ onInsert }) {
  const [tab, setTab] = useState('hints');
  const TABS = [
    { id: 'hints', label: 'Подсказки ИИ' },
    { id: 'similar', label: 'Похожие заявки' },
    { id: 'chat', label: 'Чат' },
  ];

  return (
    <div className="cp-body">
      <nav className="cp-tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`cp-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="cp-tab-panel" role="tabpanel">
        {tab === 'hints' && <HintsTab onInsert={onInsert} />}
        {tab === 'similar' && <SimilarTab onInsert={onInsert} />}
        {tab === 'chat' && <ChatTab />}
      </div>
    </div>
  );
}

// --- Tab: Подсказки ИИ ---
function HintsTab({ onInsert }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1300);
    return () => clearTimeout(t);
  }, []);

  if (!ready) {
    return (
      <ul className="cp-card-list">
        {[0, 1, 2].map(i => (
          <li key={i} className="cp-card cp-skeleton">
            <div className="sk-line sk-w60" />
            <div className="sk-line sk-w100" />
            <div className="sk-line sk-w80" />
            <div className="sk-btn" />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="cp-card-list">
      {KB_ARTICLES.map(a => (
        <li key={a.id} className="cp-card">
          <a href="#" className="cp-card-link" onClick={e => e.preventDefault()}>
            {a.title}
          </a>
          <p className="cp-card-text">{a.excerpt}</p>
          <button className="cp-btn cp-btn-action" onClick={() => onInsert(a.solution)}>
            Вставить решение
          </button>
        </li>
      ))}
    </ul>
  );
}

// --- Tab: Похожие заявки ---
function SimilarTab({ onInsert }) {
  return (
    <ul className="cp-card-list">
      {SIMILAR_TICKETS.map(t => (
        <li key={t.id} className="cp-card">
          <div className="cp-ticket-meta">
            <span className="cp-badge">{t.number}</span>
            <span className="cp-ticket-desc">{t.description}</span>
          </div>
          <p className="cp-card-text">{t.resolution}</p>
          <button className="cp-btn cp-btn-action" onClick={() => onInsert(t.resolution)}>
            Клонировать решение
          </button>
        </li>
      ))}
    </ul>
  );
}

// --- Tab: Чат ---
function ChatTab() {
  const [msgs, setMsgs] = useState([
    { role: 'bot', text: 'Привет! Я Копайлот. Задайте вопрос по текущей заявке.' },
  ]);
  const [input, setInput] = useState('');
  const [waiting, setWaiting] = useState(false);
  const bottomRef = useRef(null);

  function send() {
    const text = input.trim();
    if (!text || waiting) return;

    const next = [...msgs, { role: 'user', text }];
    setMsgs(next);
    setInput('');
    setWaiting(true);

    setTimeout(() => {
      const reply = BOT_REPLIES[next.length % BOT_REPLIES.length];
      setMsgs(prev => [...prev, { role: 'bot', text: reply }]);
      setWaiting(false);
    }, 700);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, waiting]);

  return (
    <div className="cp-chat">
      <div className="cp-chat-messages">
        {msgs.map((m, i) => (
          <div key={i} className={`cp-msg cp-msg-${m.role}`}>
            <span className="cp-msg-bubble">{m.text}</span>
          </div>
        ))}
        {waiting && (
          <div className="cp-msg cp-msg-bot">
            <span className="cp-msg-bubble cp-typing">
              <span /><span /><span />
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="cp-chat-input-row">
        <textarea
          className="cp-chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder="Введите сообщение… (Enter — отправить)"
          rows={2}
        />
        <button className="cp-btn cp-btn-primary" onClick={send} disabled={waiting}>
          Отправить
        </button>
      </div>
    </div>
  );
}

// --- Footer ---
function Footer({ onClose }) {
  const [vote, setVote] = useState(null);

  return (
    <footer className="cp-footer">
      <div className="cp-feedback">
        <span className="cp-feedback-label">Полезно?</span>
        <button
          className={`cp-btn cp-btn-vote ${vote === 'up' ? 'voted' : ''}`}
          onClick={() => setVote('up')}
          aria-pressed={vote === 'up'}
        >
          👍 Полезно
        </button>
        <button
          className={`cp-btn cp-btn-vote ${vote === 'down' ? 'voted' : ''}`}
          onClick={() => setVote('down')}
          aria-pressed={vote === 'down'}
        >
          👎 Не полезно
        </button>
      </div>
      <button className="cp-btn cp-btn-ghost" onClick={onClose}>
        Закрыть
      </button>
    </footer>
  );
}

createRoot(document.getElementById('root')).render(<App />);
