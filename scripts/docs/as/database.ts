// The tooltips of as/database.ts, in both languages: scripts/apply-docs.ts writes the
// one AMXTS_DOCS_LANG picks into the JSDoc above each element.
export default {
	'DatabaseValue': {
		en: `A value of a query's \`?\`: text, a number, a boolean or \`null\`.`,
		ru: `Значение для \`?\` запроса: текст, число, логическое или \`null\`.`,
	},
	'ExecuteResult': {
		en: `The outcome of \`execute\`: the id the row it inserted got, and how many rows it changed.`,
		ru: `Итог \`execute\`: номер вставленной строки и сколько строк изменено.`,
	},
	'ExecuteResult.insertId': {
		en: `The \`AUTO_INCREMENT\` id of the row inserted; \`0\` when there was none.`,
		ru: `\`AUTO_INCREMENT\`-номер вставленной строки; \`0\`, если вставки не было.`,
	},
	'ExecuteResult.affectedRows': {
		en: `The number of rows the statement inserted, changed or deleted - for \`UPDATE\`, the rows it matched.`,
		ru: `Число строк, которые запрос вставил, изменил или удалил; для \`UPDATE\` — подошедших под условие.`,
	},
	'DatabaseError': {
		en: `Why a query failed: the database's message, with its error code and SQLSTATE when the server refused it.`,
		ru: `Почему запрос не удался: текст базы, с кодом ошибки и SQLSTATE, если запрос отклонил сервер.`,
	},
	'DatabaseError.code': {
		en: `The server's error number, such as \`1062\` for a duplicate key; \`0\` when the query did not reach the server.`,
		ru: `Номер ошибки сервера, например \`1062\` — повтор ключа; \`0\`, если запрос не дошёл до сервера.`,
	},
	'DatabaseError.sqlState': {
		en: `The error's SQLSTATE, such as \`"23000"\`; \`""\` when the query did not reach the server.`,
		ru: `SQLSTATE ошибки, например \`"23000"\`; \`""\`, если запрос не дошёл до сервера.`,
	},
	'DatabaseQueries': {
		en: `The side a query runs on: a connection, or a transaction of one. Rows are JSON text, an array of objects.`,
		ru: `На чём выполняется запрос: соединение или его транзакция. Строки — JSON-текст, массив объектов.`,
	},
	'DatabaseQueries.dialect': {
		en: `The dialect the database writes SQL in: what the query builder writes its statements in.`,
		ru: `Диалект, на котором база пишет SQL: на нём построитель запросов пишет свои запросы.`,
	},
	'DatabaseQueries.query': {
		en: `Runs a statement that reads rows; gives them as JSON text, \`[{"name":"a"}]\`.`,
		ru: `Выполняет запрос, который читает строки; отдаёт их JSON-текстом, \`[{"name":"a"}]\`.`,
	},
	'DatabaseQueries.execute': {
		en: `Runs a statement that changes rows; gives \`{ insertId, affectedRows }\`.`,
		ru: `Выполняет запрос, который меняет строки; отдаёт \`{ insertId, affectedRows }\`.`,
	},
	'DatabaseTransaction': {
		en: `A transaction a provider began: its queries, and how it ends.`,
		ru: `Транзакция, начатая провайдером: её запросы и как она заканчивается.`,
	},
	'DatabaseTransaction.commit': {
		en: `Keeps what the transaction changed.`,
		ru: `Сохраняет то, что изменила транзакция.`,
	},
	'DatabaseTransaction.rollback': {
		en: `Undoes what the transaction changed.`,
		ru: `Отменяет то, что изменила транзакция.`,
	},
	'DatabaseConnection': {
		en: `
			A connection a provider gives for an address: what \`Database\` runs on.
			Its queries run in the order they are given.
		`,
		ru: `
			Соединение, которое провайдер даёт для адреса: на нём работает \`Database\`.
			Его запросы выполняются в том порядке, в каком переданы.
		`,
	},
	'DatabaseConnection.begin': {
		en: `Begins a transaction; rejects when the database has none.`,
		ru: `Начинает транзакцию; отклоняется, если у базы их нет.`,
	},
	'DatabaseConnection.close': {
		en: `Lets the connection go.`,
		ru: `Отпускает соединение.`,
	},
	'__Queries.query': {
		en: `
			Runs a statement that reads rows and gives them as \`T\`, an interface of
			the columns. A column \`T\` does not name is skipped; a field the row lacks
			keeps its default, or is a \`TypeError\` when it has none. The values of
			the statement's \`?\` are \`params\`, in order.
		`,
		ru: `
			Выполняет запрос, который читает строки, и отдаёт их как \`T\` — интерфейс
			колонок. Колонка, которой нет в \`T\`, пропускается; поле, которого нет в
			строке, сохраняет значение по умолчанию, а без него это \`TypeError\`.
			Значения для \`?\` запроса — \`params\`, по порядку.
		`,
	},
	'__Queries.execute': {
		en: `Runs a statement that changes rows - \`INSERT\`, \`UPDATE\`, \`DELETE\` - with the values of its \`?\`.`,
		ru: `Выполняет запрос, который меняет строки, — \`INSERT\`, \`UPDATE\`, \`DELETE\` — со значениями для его \`?\`.`,
	},
	'__Queries.select': {
		en: `Starts a query of rows: \`db.select().from(records)\`, every column - or \`db.select({ time: records.time })\`, the ones chosen.`,
		ru: `Начинает запрос строк: \`db.select().from(records)\` — все колонки, или \`db.select({ time: records.time })\` — выбранные.`,
	},
	'__Queries.insert': {
		en: `Starts an insert into the table: \`db.insert(records).values({ ... })\`.`,
		ru: `Начинает вставку в таблицу: \`db.insert(records).values({ ... })\`.`,
	},
	'__Queries.update': {
		en: `Starts an update of the table's rows: \`db.update(records).set({ ... }).where(...)\`.`,
		ru: `Начинает изменение строк таблицы: \`db.update(records).set({ ... }).where(...)\`.`,
	},
	'__Queries.delete': {
		en: `Starts a delete of the table's rows: \`db.delete(records).where(...)\` - every row without \`where\`.`,
		ru: `Начинает удаление строк таблицы: \`db.delete(records).where(...)\` — без \`where\` все строки.`,
	},
	'__Queries.create': {
		en: `Creates the table, with its keys, unless the database has it already: \`CREATE TABLE IF NOT EXISTS\`.`,
		ru: `Создаёт таблицу с её ключами, если в базе её ещё нет: \`CREATE TABLE IF NOT EXISTS\`.`,
	},
	'Transaction': {
		en: `The queries of a transaction: \`db.transaction(async (tx) => { await tx.execute(...); })\`.`,
		ru: `Запросы транзакции: \`db.transaction(async (tx) => { await tx.execute(...); })\`.`,
	},
	'Database': {
		en: `
			A database at an address - \`mysql://user:password@host:3306/database\` -
			that a plugin sends SQL to. The queries run in the background, in the order
			sent; each promise settles on a later server frame.

			\`\`\`ts
			const db = new Database(env("MYPLUGIN_DB", ""));
			const top = await db.query<Record>("SELECT name, time FROM records WHERE map = ? ORDER BY time LIMIT 10", [server.map]);
			\`\`\`
		`,
		ru: `
			База по адресу — \`mysql://user:password@host:3306/database\`, — которой
			плагин отправляет SQL. Запросы идут в фоне, в порядке отправки; каждый
			промис выполняется на одном из следующих кадров сервера.

			\`\`\`ts
			const db = new Database(env("MYPLUGIN_DB", ""));
			const top = await db.query<Record>("SELECT name, time FROM records WHERE map = ? ORDER BY time LIMIT 10", [server.map]);
			\`\`\`
		`,
	},
	'Database.transaction': {
		en: `
			Runs \`fn\` in a transaction: what it sends through \`tx\` is committed when
			it returns, and rolled back when it throws - the error goes on to the
			caller. A transaction has a connection of its own while it runs.
		`,
		ru: `
			Выполняет \`fn\` в транзакции: то, что она отправила через \`tx\`,
			фиксируется, когда она вернулась, и откатывается, когда бросила
			исключение, — ошибка уходит дальше вызывающему. У транзакции, пока она
			идёт, своё соединение.
		`,
	},
	'Database.close': {
		en: `Lets the connection go; the provider decides what that means (the module keeps MySQL's for the next map).`,
		ru: `Отпускает соединение; что это значит, решает провайдер (соединение MySQL модуль держит для следующей карты).`,
	},
	'Database.register': {
		en: `
			Makes \`scheme\` (\`"sqlite"\`) an address a database can have: \`connect\`
			gives the connection for an address of it. A provider's library calls it
			when it is imported.
		`,
		ru: `
			Делает \`scheme\` (\`"sqlite"\`) схемой адреса базы: \`connect\` даёт
			соединение для адреса с ней. Библиотека провайдера вызывает это при
			импорте.
		`,
	},
};
