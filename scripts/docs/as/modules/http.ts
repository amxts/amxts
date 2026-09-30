// The tooltips of as/modules/http.ts, in both languages: scripts/apply-docs.ts writes the
// one AMXTS_DOCS_LANG picks into the JSDoc above each element.
export default {
	'RequestInit': {
		en: `A request's options besides its URL. Every field is optional.`,
		ru: `Настройки запроса помимо URL. Все поля необязательны.`,
	},
	'RequestInit.method': {
		en: `The request's method, one of \`"GET"\` (the default), \`"POST"\`, \`"PUT"\`, \`"PATCH"\`, \`"DELETE"\`.`,
		ru: `Метод запроса, одно из \`"GET"\` (по умолчанию), \`"POST"\`, \`"PUT"\`, \`"PATCH"\`, \`"DELETE"\`.`,
	},
	'RequestInit.body': {
		en: `The text sent with the request, such as JSON for a POST; empty by default.`,
		ru: `Текст, который уходит с запросом, например JSON для POST; по умолчанию пустой.`,
	},
	'RequestInit.headers': {
		en: `The request's headers, as pairs: \`[["Content-Type", "application/json"]]\`.`,
		ru: `Заголовки запроса, парами: \`[["Content-Type", "application/json"]]\`.`,
	},
	'RequestInit.signal': {
		en: `
			A signal that cancels the request; the promise then rejects with an
			Error named \`"AbortError"\`. In an async command handler or player event,
			the player leaving cancels the request too.
		`,
		ru: `
			Сигнал, который отменяет запрос; промис тогда отклоняется с Error с
			именем \`"AbortError"\`. В async-обработчике команды или события игрока
			запрос отменяется и тогда, когда игрок выходит.
		`,
	},
	'Response': {
		en: `The server's response to a request.`,
		ru: `Ответ сервера на запрос.`,
	},
	'Response.status': {
		en: `The response's HTTP status: \`200\`, \`404\`, ...`,
		ru: `HTTP-статус ответа: \`200\`, \`404\`, ...`,
	},
	'Response.text': {
		en: `The response's body, as text.`,
		ru: `Тело ответа, текстом.`,
	},
	'Response.ok': {
		en: `\`true\` for a 2xx status.`,
		ru: `\`true\` при статусе 2xx.`,
	},
	'fetch': {
		en: `
			Sends a request. The promise is fulfilled with the response on a later
			frame, and rejected when there is none - no connection, a bad URL, a
			timeout, no \`easy_http\`, or an abort. An HTTP error such as \`404\` is a
			response, as in fetch: check \`response.ok\`.

			Pawn: \`ezhttp_get\`, \`ezhttp_post\` (easy_http)
		`,
		ru: `
			Отправляет запрос. Промис выполняется с ответом в одном из следующих
			кадров и отклоняется, если ответа нет: нет соединения, плохой URL,
			таймаут, нет \`easy_http\` или отмена. HTTP-ошибка вроде \`404\` — это ответ,
			как и в fetch: проверяйте \`response.ok\`.

			Pawn: \`ezhttp_get\`, \`ezhttp_post\` (easy_http)
		`,
	},
};
