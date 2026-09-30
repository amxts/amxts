// The tooltips of as/promise.ts, in both languages: scripts/apply-docs.ts writes the
// one AMXTS_DOCS_LANG picks into the JSDoc above each element.
export default {
	'PromiseBase': {
		en: `The base of every Promise, whatever its value's type; a plugin uses Promise<T>.`,
		ru: `Общая основа любого Promise, каким бы ни был тип значения; плагин пользуется Promise<T>.`,
	},
	'PromiseLike': {
		en: `Anything with a \`then\`: the type \`await\` takes in the editor. In a plugin, \`await\` a Promise.`,
		ru: `Всё, у чего есть \`then\`: тип, который \`await\` принимает в редакторе. В плагине \`await\` ждёт Promise.`,
	},
	'PromiseLike.then': {
		en: `Calls \`onFulfilled\` with the value once there is one.`,
		ru: `Вызывает \`onFulfilled\` со значением, когда оно появится.`,
	},
	'Promise': {
		en: `A value that is not there yet: the result of a request, a timer, an async function.`,
		ru: `Значение, которого ещё нет: результат запроса, таймера, async-функции.`,
	},
	'Promise.then': {
		en: `
			Calls \`onFulfilled\` with the value once there is one; the promise it
			returns settles with what that returns. A rejection passes through to
			it untouched, or to \`onRejected\` when there is one.
		`,
		ru: `
			Вызывает \`onFulfilled\` со значением, когда оно появится; возвращённый
			промис завершается тем, что вернёт \`onFulfilled\`. Отклонение переходит
			в него как есть — или в \`onRejected\`, если он передан.
		`,
	},
	'Promise.catch': {
		en: `
			Calls \`onRejected\` with the reason if this is rejected. What it returns
			is the value instead: \`readFile(path).catch(() => "")\` - or nothing, when
			it only logs.
		`,
		ru: `
			Вызывает \`onRejected\` с причиной, если промис отклонён. То, что он
			вернёт, становится значением взамен — \`readFile(path).catch(() => "")\`, —
			или ничего, если он только пишет в лог.
		`,
	},
	'Promise.finally': {
		en: `Calls \`onFinally\` once this settles, either way, and passes the outcome on.`,
		ru: `Вызывает \`onFinally\`, когда промис завершится, как бы ни завершился, и передаёт результат дальше.`,
	},
	'Promise.resolve': {
		en: `A promise already fulfilled with \`value\`.`,
		ru: `Промис, уже выполненный со значением \`value\`.`,
	},
	'Promise.reject': {
		en: `A promise already rejected with \`reason\`.`,
		ru: `Промис, уже отклонённый с причиной \`reason\`.`,
	},
	'PromiseSettledResult': {
		en: `A promise's outcome, as Promise.allSettled gives it for each.`,
		ru: `Итог промиса — то, что Promise.allSettled даёт для каждого.`,
	},
	'PromiseSettledResult.status': {
		en: `The promise's outcome, either \`"fulfilled"\` or \`"rejected"\`.`,
		ru: `Итог промиса, либо \`"fulfilled"\`, либо \`"rejected"\`.`,
	},
	'PromiseSettledResult.value': {
		en: `The promise's value, when fulfilled.`,
		ru: `Значение промиса, если он выполнен.`,
	},
	'PromiseSettledResult.reason': {
		en: `The rejection's reason, when rejected.`,
		ru: `Причина отказа, если промис отклонён.`,
	},
	'AggregateError': {
		en: `The error Promise.any rejects with when every promise is rejected; their reasons are in \`errors\`.`,
		ru: `Ошибка, с которой отклоняется Promise.any, когда отклонены все промисы; их причины лежат в \`errors\`.`,
	},
	'AggregateError.errors': {
		en: `The reason each promise was rejected, in the order the promises were given.`,
		ru: `Причины отказа каждого промиса, в том порядке, в каком промисы переданы.`,
	},
	'Event': {
		en: `The event an abort listener gets.`,
		ru: `Событие, которое получает обработчик отмены.`,
	},
	'Event.type': {
		en: `The event's type; the only one here is \`"abort"\`.`,
		ru: `Тип события; здесь он всегда \`"abort"\`.`,
	},
	'AbortSignal': {
		en: `A signal to give something up: a request, a timer, everything a player started.`,
		ru: `Сигнал бросить начатое: запрос, таймер, всё, что начал игрок.`,
	},
	'AbortSignal.aborted': {
		en: `\`true\` once the signal has aborted.`,
		ru: `\`true\`, если сигнал уже сработал.`,
	},
	'AbortSignal.reason': {
		en: `The abort's reason: an Error named \`"AbortError"\` unless \`abort()\` was given one.`,
		ru: `Причина отмены: Error с именем \`"AbortError"\`, если в \`abort()\` не передали свою.`,
	},
	'AbortSignal.addEventListener': {
		en: `Calls \`listener\` when the signal aborts.`,
		ru: `Вызывает \`listener\`, когда сигнал срабатывает.`,
	},
	'AbortSignal.removeEventListener': {
		en: `Takes back a \`listener\` given to \`addEventListener\`: it is not called any more.`,
		ru: `Убирает \`listener\`, переданный в \`addEventListener\`: он больше не вызывается.`,
	},
	'AbortSignal.timeout': {
		en: `A signal that aborts by itself after \`ms\`, with an Error named \`"TimeoutError"\`.`,
		ru: `Сигнал, который сам срабатывает через \`ms\` с Error с именем \`"TimeoutError"\`.`,
	},
	'AbortSignal.abort': {
		en: `A signal that has aborted already.`,
		ru: `Сигнал, который уже сработал.`,
	},
	'AbortSignal.any': {
		en: `A signal that aborts when any of \`signals\` does.`,
		ru: `Сигнал, который срабатывает, как только сработает любой из \`signals\`.`,
	},
	'AbortController': {
		en: `A controller that aborts its \`signal\` on demand: \`controller.abort()\`.`,
		ru: `Контроллер, который отменяет свой \`signal\` по команде: \`controller.abort()\`.`,
	},
	'AbortController.signal': {
		en: `The controller's signal: hand it to fetch, sleep or anything else that takes one.`,
		ru: `Сигнал контроллера: передайте его в fetch, sleep или куда угодно ещё, где принимают сигнал.`,
	},
	'AbortController.abort': {
		en: `Aborts the signal, with \`reason\` or an Error named \`"AbortError"\`.`,
		ru: `Отменяет сигнал с причиной \`reason\` или с Error с именем \`"AbortError"\`.`,
	},
};
