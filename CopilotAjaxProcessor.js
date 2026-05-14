/**
 * CopilotAjaxProcessor — серверный Script Include для SimpleOne
 *
 * Назначение: принимает AJAX-запрос от UI Action (copilot_ui_action.js),
 *   читает заявку itsm_request, собирает контекст и вызывает Copilot API.
 *   Результат возвращается UI Action через setAnswer() в формате JSON.
 *
 * Установка в SimpleOne:
 *   1. Перейдите в System Definition → Script Includes
 *   2. Создайте запись с именем «CopilotAjaxProcessor»
 *   3. Вставьте содержимое этого файла в поле Script
 *   4. Выставьте флаг «Client callable» = true
 *   5. Замените все места, помеченные ⚠️ REPLACE, на актуальные значения
 *
 * Системные свойства (System Properties):
 *   copilot.api.token  — токен авторизации для Copilot backend (⚠️ REPLACE)
 */

var CopilotAjaxProcessor = Class.create();
CopilotAjaxProcessor.prototype = Object.extendsObject(AbstractAjaxProcessor, {

    /**
     * Точка входа: анализ заявки по sys_id.
     * Вызывается из UI Action через SimpleAjax с параметром sysparm_name=analyze.
     */
    analyze: function () {
        var sysId = this.getParameter('sysparm_sys_id');

        if (!sysId) {
            this.setAnswer(JSON.stringify(this._fallbackResponse('missing_sys_id')));
            return;
        }

        // ⚠️ REPLACE: замените 'itsm_request' на системное имя таблицы заявок в вашем экземпляре
        var gr = new GlideRecord('itsm_request');
        if (!gr.get(sysId)) {
            this.setAnswer(JSON.stringify(this._fallbackResponse('record_not_found')));
            return;
        }

        if (!gr.canRead()) {
            this.setAnswer(JSON.stringify(this._fallbackResponse('access_denied')));
            return;
        }

        // Проверка конфиденциальности — не передаём данные, если заявка закрыта от чтения
        // ⚠️ REPLACE: уточните системное имя поля конфиденциальности в вашем экземпляре
        var confidential = gr.getValue('task_confidentiality');
        if (confidential === '1' || confidential === 'true') {
            this.setAnswer(JSON.stringify(this._fallbackResponse('confidential')));
            return;
        }

        // Сборка контекста заявки для отправки в Copilot API
        var context = {
            number:             gr.getValue('number'),
            subject:            gr.getValue('subject'),
            description:        gr.getValue('description'),
            priority:           gr.getValue('priority'),
            // ⚠️ REPLACE: проверьте системные имена полей услуги в вашем экземпляре
            service:            gr.getValue('service'),
            service_2nd_level:  gr.getValue('service_2nd_level'),
            service_3rd_level:  gr.getValue('service_3rd_level'),
            // ⚠️ REPLACE: проверьте системное имя поля группы назначения
            assignment_group:   gr.getValue('assignment_group'),
            related_cis:        this._getRelatedCIs(sysId)
        };

        var result = this._callCopilotAPI(context);

        this._auditLog(sysId, context, result);

        this.setAnswer(JSON.stringify(result));
    },

    /**
     * HTTP POST к Copilot backend. Таймаут — 10 секунд.
     * При любой ошибке возвращает _fallbackResponse().
     */
    _callCopilotAPI: function (context) {
        try {
            // ⚠️ REPLACE: читайте токен из системного свойства, не хардкодьте
            var token = gs.getProperty('copilot.api.token');

            // ⚠️ REPLACE: замените URL на адрес вашего Copilot backend
            var endpoint = 'https://your-copilot-backend/api/v1/analyze';

            // SimpleOne HTTP-клиент (уточните класс для вашей версии платформы):
            // ⚠️ REPLACE: замените вызов на актуальный HTTP API вашего экземпляра SimpleOne
            var rm = new RESTMessage(endpoint, 'post');
            rm.setRequestHeader('Content-Type', 'application/json');
            rm.setRequestHeader('Authorization', 'Bearer ' + token);
            rm.setRequestBody(JSON.stringify(context));
            // ⚠️ REPLACE: убедитесь, что метод установки таймаута соответствует вашему HTTP-клиенту
            rm.setHttpTimeout(10000);

            var response   = rm.execute();
            var statusCode = response.getStatusCode();
            var body       = response.getBody();

            if (statusCode === 200) {
                return JSON.parse(body);
            }

            gs.warn('[CopilotAjaxProcessor] API вернул статус ' + statusCode);
            return this._fallbackResponse('api_status_' + statusCode);

        } catch (e) {
            gs.warn('[CopilotAjaxProcessor] Ошибка вызова API: ' + e.message);
            return this._fallbackResponse(e.message);
        }
    },

    /**
     * Безопасный ответ при недоступности API.
     * Возвращает пустые массивы — UI покажет mock-данные как fallback.
     */
    _fallbackResponse: function (reason) {
        return {
            status:           'fallback',
            fallback_reason:  reason || 'unknown',
            summary:          '',
            kb_articles:      [],
            similar_tickets:  [],
            draft_solution:   ''
        };
    },

    /**
     * Получает список связанных конфигурационных единиц (CI) для заявки.
     */
    _getRelatedCIs: function (sysId) {
        var cis = [];
        try {
            // ⚠️ REPLACE: уточните таблицу и поля связи КЕ с заявкой в вашем экземпляре
            var gr = new GlideRecord('task_ci');
            gr.addQuery('task', sysId);
            gr.setLimit(20);
            gr.query();
            while (gr.next()) {
                cis.push(gr.getValue('ci_item'));
            }
        } catch (e) {
            gs.warn('[CopilotAjaxProcessor] Ошибка чтения related_cis: ' + e.message);
        }
        return cis;
    },

    /**
     * Записывает факт вызова анализа в таблицу аудита.
     * Не бросает исключений — ошибка логирования не должна ломать основной поток.
     */
    _auditLog: function (sysId, context, result) {
        try {
            // ⚠️ REPLACE: убедитесь, что таблица copilot_audit_log существует в вашем экземпляре
            //             или замените на актуальное имя таблицы аудита
            var log = new GlideRecord('copilot_audit_log');
            log.setValue('request_id',    sysId);
            log.setValue('context',       JSON.stringify(context));
            log.setValue('result_status', result.status || 'unknown');
            log.insert();
        } catch (e) {
            gs.warn('[CopilotAjaxProcessor] Ошибка записи аудита: ' + e.message);
        }
    },

    type: 'CopilotAjaxProcessor'
});
