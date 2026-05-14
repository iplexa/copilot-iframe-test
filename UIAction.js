/**
 * UI Action — «Копайлот»
 * Таблица:     req (или нужная таблица заявок)
 * Тип:         Client Script
 * Слой:        Client
 *
 * Что изменено по сравнению с прежней версией:
 *  - убран s_form.addSuccessMessage при открытии (вводил в заблуждение)
 *  - убран лишний console.log(getAllFields) — не нужен в проде
 *  - добавлена передача расширенного контекста заявки (category, service, priority и др.)
 *  - добавлена передача CSRF-токена через postMessage при handshake с iframe
 *  - обработчик postMessage расширен: добавлены типы link_ticket и feedback
 *  - добавлен guard от двойного клика (isOpening)
 *  - улучшен escapeHtml — обрабатывает не только строки
 *  - добавлены комментарии по каждому блоку
 */

(function openCopilotModal() {

    /* ─── 0. Константы ──────────────────────────────────────────────── */
    // TODO: заменить на реальный адрес вашего Copilot-backend
    var COPILOT_ORIGIN      = 'https://copilot.plxa.ru';
    var COPILOT_MODAL_PATH  = '/simpleone/modal';

    // TODO: уточнить системное имя поля «Решение» в вашей конфигурации
    var SOLUTION_FIELD      = 'closure_notes';

    // Ширина и высота модального окна
    var MODAL_WIDTH         = 1100;
    var IFRAME_HEIGHT       = 720;

    /* ─── 1. Guard: не открывать дважды ─────────────────────────────── */
    if (window.__copilotOpening) return;
    window.__copilotOpening = true;

    /* ─── 2. Проверка обязательных данных ───────────────────────────── */
    var recordId = s_form.getUniqueValue();
    if (!recordId) {
        s_form.addInfoMessage('Сначала сохраните заявку, затем откройте Копайлот.');
        window.__copilotOpening = false;
        return;
    }

    /* ─── 3. Сбор контекста заявки ──────────────────────────────────── */
    // Все поля читаем через safeGet — если поля нет в форме, вернётся ''
    var context = {
        source:           'simpleone',
        table_name:       s_form.getTableName(),
 record_id:        recordId,
 number:           safeGet('number'),
 subject:          safeGet('subject') || safeGet('short_description'),
 description:      safeGet('description'),
 category:         safeGet('category'),          // TODO: уточнить имя поля категории
 service:          safeGet('service'),            // TODO: уточнить имя поля услуги
 ci:               safeGet('cmdb_ci'),            // TODO: уточнить имя поля КЕ
 priority:         safeGet('priority'),
 assignment_group: safeGet('assignment_group'),
 assigned_to:      safeGet('assigned_to'),
 simpleone_origin: window.location.origin
    };

    /* ─── 4. Формирование URL iframe ────────────────────────────────── */
    var params   = new URLSearchParams(context);
    var iframeUrl = COPILOT_ORIGIN + COPILOT_MODAL_PATH + '?' + params.toString();

    /* ─── 5. Регистрация обработчика postMessage ─────────────────────── */
    registerMessageHandler(COPILOT_ORIGIN, SOLUTION_FIELD);

    /* ─── 6. Рендер модального окна ─────────────────────────────────── */
    s_modal.setTitle('Копайлот');
    s_modal.setWidth(MODAL_WIDTH);
    s_modal.setIsLoading(false);

    s_modal.renderTemplate(
        '<iframe' +
        ' id="copilot-frame"' +
        ' src="' + escapeHtml(iframeUrl) + '"' +
        ' style="width:100%;height:' + IFRAME_HEIGHT + 'px;border:0;display:block;background:#f8f9fa;"' +
        ' allow="clipboard-write"' +
        ' loading="lazy"' +
        '></iframe>',
        // Инлайн-CSS для контейнера — только то, что SimpleOne позволяет передать вторым аргументом
        '#copilot-frame{border-radius:8px;}'
    );

    /* ─── 7. Handshake: отправляем токен в iframe после его загрузки ── */
    // Позволяет iframe верифицировать, что сообщения идут от легитимного хоста.
    // Токен читается из мета-тега SimpleOne (если доступен), иначе не отправляется.
    var frameEl = document.getElementById('copilot-frame');
    if (frameEl) {
        frameEl.addEventListener('load', function () {
            var csrfMeta = document.querySelector('meta[name="csrf-token"]');
            var csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : null;
            frameEl.contentWindow.postMessage({
                type:    'copilot.handshake',
                payload: {
                    record_id:   recordId,
                    table_name:  s_form.getTableName(),
                                              csrf_token:  csrfToken   // может быть null — iframe должен это учитывать
                }
            }, COPILOT_ORIGIN);
            window.__copilotOpening = false;   // снимаем guard после загрузки
        });
    } else {
        // iframe ещё не в DOM (renderTemplate асинхронный) — снимаем guard с задержкой
        setTimeout(function () { window.__copilotOpening = false; }, 2000);
    }

    /* ════════════════════════════════════════════════════════════════════
     * Вспомогательные функции
     * ════════════════════════════════════════════════════════════════════ */

    /**
     * Безопасное чтение поля формы.
     * Возвращает строку или '' при любой ошибке.
     */
    function safeGet(fieldName) {
        try {
            return String(s_form.getValue(fieldName) || '');
        } catch (e) {
            return '';
        }
    }

    /**
     * Экранирование значения для безопасной вставки в HTML-атрибут.
     */
    function escapeHtml(value) {
        return String(value == null ? '' : value)
        .replace(/&/g,  '&amp;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;');
    }

    /**
     * Регистрирует единственный обработчик postMessage от Copilot iframe.
     * Предыдущий обработчик (если был) удаляется, чтобы не накапливать дубли.
     *
     * Поддерживаемые типы сообщений:
     *   copilot.request_analysis — запросить анализ заявки через SimpleAjax
     *   copilot.insert_solution  — вставить текст в поле решения
     *   copilot.close_modal      — закрыть модальное окно
     *   copilot.link_ticket      — связать текущую заявку с найденной
     *   copilot.feedback         — принять обратную связь (полезно / не полезно)
     */
    function registerMessageHandler(expectedOrigin, solutionField) {
        if (window.__copilotMessageHandler) {
            window.removeEventListener('message', window.__copilotMessageHandler);
        }

        window.__copilotMessageHandler = async function (event) {
            // Проверка origin — обязательна
            if (event.origin !== expectedOrigin) return;

            var msg     = event.data  || {};
            var payload = msg.payload || {};

            switch (msg.type) {

                /* -- Вставить решение в поле формы -------------------------- */
                case 'copilot.insert_solution': {
                    var text = payload.text;
                    if (!text) {
                        s_form.addInfoMessage('Копайлот не передал текст решения.');
                        return;
                    }
                    try {
                        await s_form.setValue(solutionField, text);
                        s_form.addInfoMessage(
                            'Текст решения вставлен в поле «' + solutionField + '». ' +
                            'Проверьте его перед сохранением.'
                        );
                    } catch (e) {
                        s_form.addErrorMessage(
                            'Не удалось вставить текст в поле «' + solutionField + '». ' +
                            'Проверьте системное имя поля.'
                        );
                    }
                    break;
                }

                /* -- Закрыть модальное окно ---------------------------------- */
                case 'copilot.close_modal': {
                    s_modal.setShow(false);
                    break;
                }

                /* -- Связать текущую заявку с найденной --------------------- */
                // TODO: реализовать через серверный скрипт / SimpleAjax
                // payload.related_record_id — sys_id заявки-аналога
                case 'copilot.link_ticket': {
                    var relatedId = payload.related_record_id;
                    if (!relatedId) return;
                    // Заглушка — в целевой версии здесь вызов SimpleAjax
                    s_form.addInfoMessage(
                        'Связь с заявкой ' + (payload.related_number || relatedId) +
                        ' будет создана. (Функция в разработке)'
                    );
                    break;
                }

                /* -- Обратная связь: полезно / не полезно / применено ------- */
                // TODO: реализовать запись через серверный скрипт / SimpleAjax
                // payload.value: 'helpful' | 'not_helpful' | 'applied'
                // payload.source_type: 'kb_article' | 'similar_ticket' | 'generated'
                // payload.source_id: идентификатор источника
                case 'copilot.feedback': {
                    // Заглушка — в целевой версии здесь вызов SimpleAjax для логирования
                    console.log('[Copilot] feedback:', JSON.stringify(payload));
                    break;
                }

                /* -- Запросить анализ заявки через серверный слой ----------- */
                // iframe отправляет этот тип сразу после handshake;
                // здесь вызываем CopilotAjaxProcessor.analyze и возвращаем результат
                case 'copilot.request_analysis': {
                    var iframeWin = event.source;
                    var ajax = new SimpleAjax('CopilotAjaxProcessor');
                    ajax.addParam('sysparm_name', 'analyze');
                    ajax.addParam('sysparm_sys_id', recordId);
                    ajax.getXML(function (response) {
                        if (!iframeWin) return;
                        try {
                            var raw = response.responseXML.documentElement.getAttribute('answer');
                            var data = JSON.parse(raw);
                            iframeWin.postMessage(
                                { type: 'copilot.analysis_result', payload: data },
                                expectedOrigin
                            );
                        } catch (err) {
                            iframeWin.postMessage(
                                { type: 'copilot.error', payload: { message: 'Ошибка обработки ответа сервера' } },
                                expectedOrigin
                            );
                        }
                    });
                    break;
                }

                default:
                    // Неизвестный тип — игнорируем
                    break;
            }
        };

        window.addEventListener('message', window.__copilotMessageHandler);
    }

})();
