// The tooltips of as/lib/check.ts, in both languages: scripts/apply-docs.ts writes the
// one AMXTS_DOCS_LANG picks into the JSDoc above each element.
export default {
	'Checks': {
		en: `
			Checks of one piece of the API on a live server. Each goes to the server
			console with the tag, as \`[tag] ok ...\` or \`[tag] FAIL ...\`; the player
			who ran them gets the total in chat.

			\`\`\`ts
			const check = new Checks("api-async", player);
			check.expect(player.gravity, "gravity").toBeCloseTo(0.5);
			check.done();
			\`\`\`
		`,
		ru: `
			Проверки одной части API на живом сервере. Каждая пишется в консоль
			сервера с тегом — \`[tag] ok ...\` или \`[tag] FAIL ...\`; игрок, который
			их запустил, получает итог в чат.

			\`\`\`ts
			const check = new Checks("api-async", player);
			check.expect(player.gravity, "gravity").toBeCloseTo(0.5);
			check.done();
			\`\`\`
		`,
	},
	'Checks.passed': {
		en: `The number of checks passed so far.`,
		ru: `Число пройденных проверок.`,
	},
	'Checks.failed': {
		en: `The number of checks failed so far.`,
		ru: `Число проваленных проверок.`,
	},
	'Checks.tag': {
		en: `The checks' tag: every log line starts with it, \`[cvar]\`.`,
		ru: `Тег проверок: с него начинается каждая строка лога, \`[cvar]\`.`,
	},
	'Checks.player': {
		en: `The player who ran the checks, if any: the total is printed to him too.`,
		ru: `Игрок, запустивший проверки, если их запустил игрок: итог выводится и ему.`,
	},
	'Checks.expect': {
		en: `Starts a check of a value; \`what\` names it in the log: \`check.expect(player.gravity, "gravity")\`.`,
		ru: `Начинает проверку значения; \`what\` — его имя в логе: \`check.expect(player.gravity, "gravity")\`.`,
	},
	'Checks.done': {
		en: `Prints the total, to the log and to the player.`,
		ru: `Выводит итог — в лог и игроку.`,
	},
	'Checks.record': {
		en: `@hidden`,
		ru: `@hidden Записывает одну проверку в лог и в итог.`,
	},
	'Expectation': {
		en: `One value under check, from \`check.expect(...)\`: \`toBe\` or \`toBeCloseTo\` logs the result.`,
		ru: `Одно проверяемое значение из \`check.expect(...)\`: \`toBe\` или \`toBeCloseTo\` пишут результат в лог.`,
	},
	'Expectation.toBe': {
		en: `Checks the value equals \`expected\`: the same number, text or boolean.`,
		ru: `Проверяет, что значение равно \`expected\`: то же число, текст или boolean.`,
	},
	'Expectation.toBeCloseTo': {
		en: `Checks the number is within \`0.001\` of \`expected\`: a value the game stores comes back rounded (\`0.5\` as \`0.49999\`).`,
		ru: `Проверяет, что число отличается от \`expected\` меньше чем на \`0.001\`: значение, которое хранит игра, возвращается округлённым (\`0.5\` как \`0.49999\`).`,
	},
};
