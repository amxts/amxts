// The tooltips of as/promise.types.d.ts, in both languages: scripts/apply-docs.ts writes the
// one AMXTS_DOCS_LANG picks into the JSDoc above each element.
export default {
	'Promise': {
		en: `The statics that take a list of promises: \`all\`, \`allSettled\`, \`race\` and \`any\`.`,
		ru: `Статические методы, которые принимают список промисов: \`all\`, \`allSettled\`, \`race\` и \`any\`.`,
	},
	'Promise.all': {
		en: `
			Waits for every promise and gives their values in order; rejects with the
			first rejection. Promises of different types give a tuple:

			\`\`\`ts
			const [response, count] = await Promise.all([fetch(url), countAsync()]);
			\`\`\`
		`,
		ru: `
			Ждёт все промисы и отдаёт их значения по порядку; отклоняется с первой
			же ошибкой. Промисы разных типов дают кортеж:

			\`\`\`ts
			const [response, count] = await Promise.all([fetch(url), countAsync()]);
			\`\`\`
		`,
	},
	'Promise.allSettled': {
		en: `
			Waits for every promise to settle, either way, and tells how each did:
			\`status\` is \`"fulfilled"\` with \`value\`, or \`"rejected"\` with \`reason\`.
		`,
		ru: `
			Ждёт, пока завершатся все промисы, как бы ни завершились, и сообщает,
			как завершился каждый: \`status\` — \`"fulfilled"\` с \`value\` или
			\`"rejected"\` с \`reason\`.
		`,
	},
	'Promise.race': {
		en: `
			Settles like the first promise to settle. Promises of different types
			need a common base class; a Promise<void> among them makes the value
			nullable.
		`,
		ru: `
			Завершается так же, как первый завершившийся промис. Промисам разных
			типов нужен общий базовый класс; с Promise<void> среди них значение
			может быть \`null\`.
		`,
	},
	'Promise.any': {
		en: `
			Gives the first value to arrive; once all promises are rejected, rejects
			with an AggregateError whose \`errors\` hold every reason.
		`,
		ru: `
			Отдаёт первое полученное значение; если отклонены все промисы —
			отклоняется с AggregateError, в \`errors\` которого все причины.
		`,
	},
};
