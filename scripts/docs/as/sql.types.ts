// The tooltips of as/sql.types.d.ts, in both languages: scripts/apply-docs.ts writes the
// one AMXTS_DOCS_LANG picks into the JSDoc above each element.
export default {
	'Table.$inferSelect': {
		en: `The table's row: \`type Record = typeof records.$inferSelect\`.`,
		ru: `Строка таблицы: \`type Record = typeof records.$inferSelect\`.`,
	},
	'Table.$inferInsert': {
		en: `The row an insert into the table takes: the \`notNull\` columns without a default, and the rest optional.`,
		ru: `Строка, которую принимает вставка в таблицу: колонки \`notNull\` без умолчания, остальные — по желанию.`,
	},
	'Database.select': {
		en: `Starts a query of rows: \`db.select().from(records)\`, every column.`,
		ru: `Начинает запрос строк: \`db.select().from(records)\`, все колонки.`,
	},
	'Transaction.select': {
		en: `Starts a query of rows: \`tx.select().from(records)\`, every column.`,
		ru: `Начинает запрос строк: \`tx.select().from(records)\`, все колонки.`,
	},
};
