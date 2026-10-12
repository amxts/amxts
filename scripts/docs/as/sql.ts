// The tooltips of as/sql.ts, in both languages: scripts/apply-docs.ts writes the
// one AMXTS_DOCS_LANG picks into the JSDoc above each element.
export default {
	'Column': {
		en: `A column of a table - \`records.time\` - which queries compare, order and select by.`,
		ru: `Колонка таблицы — \`records.time\`, — по которой запросы сравнивают, сортируют и выбирают.`,
	},
	'Aggregate': {
		en: `A value a query works out of a column: \`count()\`, \`sum(records.time)\`.`,
		ru: `Значение, которое запрос вычисляет по колонке: \`count()\`, \`sum(records.time)\`.`,
	},
	'NullableAggregate': {
		en: `An aggregate that is \`null\` when no row is there to work it out of: \`sum\`, \`avg\`, \`min\`, \`max\`.`,
		ru: `Агрегат, который равен \`null\`, если строк для него нет: \`sum\`, \`avg\`, \`min\`, \`max\`.`,
	},
	'count': {
		en: `The number of rows - or, of a column, of the rows that hold a value in it.`,
		ru: `Число строк — а с колонкой, число строк, где в ней есть значение.`,
	},
	'sum': {
		en: `The sum of a column's values; \`null\` when there are none.`,
		ru: `Сумма значений колонки; \`null\`, если их нет.`,
	},
	'avg': {
		en: `The average of a column's values; \`null\` when there are none.`,
		ru: `Среднее значений колонки; \`null\`, если их нет.`,
	},
	'min': {
		en: `The least of a column's values; \`null\` when there are none.`,
		ru: `Наименьшее значение колонки; \`null\`, если значений нет.`,
	},
	'max': {
		en: `The greatest of a column's values; \`null\` when there are none.`,
		ru: `Наибольшее значение колонки; \`null\`, если значений нет.`,
	},
	'Table': {
		en: `
			A table \`table(...)\` describes: its columns are its fields, \`records.time\`.
			\`typeof records.$inferSelect\` is its row, \`typeof records.$inferInsert\`
			what an insert takes.
		`,
		ru: `
			Таблица, которую описывает \`table(...)\`: её колонки — её поля, \`records.time\`.
			\`typeof records.$inferSelect\` — её строка, \`typeof records.$inferInsert\` —
			то, что принимает вставка.
		`,
	},
	'Condition': {
		en: `A condition of \`where\`: \`eq(records.map, server.map)\`, \`and(...)\`.`,
		ru: `Условие для \`where\`: \`eq(records.map, server.map)\`, \`and(...)\`.`,
	},
	'eq': {
		en: `The column equals the value, or the other column.`,
		ru: `Колонка равна значению или другой колонке.`,
	},
	'ne': {
		en: `The column does not equal the value, or the other column.`,
		ru: `Колонка не равна значению или другой колонке.`,
	},
	'gt': {
		en: `The column is greater than the value, or the other column.`,
		ru: `Колонка больше значения или другой колонки.`,
	},
	'gte': {
		en: `The column is greater than or equal to the value, or the other column.`,
		ru: `Колонка больше или равна значению или другой колонке.`,
	},
	'lt': {
		en: `The column is less than the value, or the other column.`,
		ru: `Колонка меньше значения или другой колонки.`,
	},
	'lte': {
		en: `The column is less than or equal to the value, or the other column.`,
		ru: `Колонка меньше или равна значению или другой колонке.`,
	},
	'like': {
		en: `The text column matches \`pattern\`, SQL's \`LIKE\`: \`%\` any text, \`_\` one character.`,
		ru: `Текстовая колонка подходит под \`pattern\`, \`LIKE\` из SQL: \`%\` — любой текст, \`_\` — один символ.`,
	},
	'inArray': {
		en: `The column's value is one of \`values\`; never, when there are none.`,
		ru: `Значение колонки — одно из \`values\`; при пустом списке — никогда.`,
	},
	'between': {
		en: `The column's value is between \`low\` and \`high\`, both included.`,
		ru: `Значение колонки между \`low\` и \`high\`, обе границы включены.`,
	},
	'isNull': {
		en: `The column holds no value: SQL's \`NULL\`.`,
		ru: `В колонке нет значения: \`NULL\` из SQL.`,
	},
	'isNotNull': {
		en: `The column holds a value.`,
		ru: `В колонке есть значение.`,
	},
	'and': {
		en: `Every condition holds; with none, any row does.`,
		ru: `Выполняются все условия; без условий подходит любая строка.`,
	},
	'or': {
		en: `One of the conditions holds; with none, no row does.`,
		ru: `Выполняется одно из условий; без условий не подходит ни одна строка.`,
	},
	'not': {
		en: `The condition does not hold.`,
		ru: `Условие не выполняется.`,
	},
	'Order': {
		en: `An order of \`orderBy\`: by a column or an aggregate, up or down.`,
		ru: `Порядок для \`orderBy\`: по колонке или агрегату, по возрастанию или убыванию.`,
	},
	'asc': {
		en: `Smallest first.`,
		ru: `Сначала наименьшие.`,
	},
	'desc': {
		en: `Greatest first.`,
		ru: `Сначала наибольшие.`,
	},
	'SqlDialect': {
		en: `
			A database's way of writing SQL: the names, the \`?\`, the upsert, the
			column types of \`create\`. A provider's connection names its dialect; the builder
			hands the parts of a statement to it, so the same query is written for
			any database. This class writes standard SQL; a dialect overrides what
			its database writes otherwise, and what it cannot do it refuses with
			\`unsupported\`.
		`,
		ru: `
			Способ, которым база пишет SQL: имена, \`?\`, upsert, типы колонок для \`create\`.
			Соединение провайдера называет свой диалект; построитель отдаёт ему части
			запроса, так что один и тот же запрос пишется для любой базы. Этот класс
			пишет стандартный SQL; диалект переопределяет то, что его база пишет
			иначе, а то, чего она не умеет, отклоняет через \`unsupported\`.
		`,
	},
	'SqlDialect.name': {
		en: `The database's name, for a message, e.g. \`"mysql"\`.`,
		ru: `Имя базы для сообщений, например \`"mysql"\`.`,
	},
	'SqlDialect.quote': {
		en: `A table's or a column's name as the statement has it, e.g. \`"name"\`.`,
		ru: `Имя таблицы или колонки так, как его пишет запрос, например \`"name"\`.`,
	},
	'SqlDialect.placeholder': {
		en: `The mark of the \`index\`-th value (from 1): \`?\`.`,
		ru: `Метка \`index\`-го значения (с 1): \`?\`.`,
	},
	'SqlDialect.castText': {
		en: `A column selected as text: \`CAST(column AS TEXT)\`.`,
		ru: `Колонка, выбранная как текст: \`CAST(column AS TEXT)\`.`,
	},
	'SqlDialect.limit': {
		en: `\`LIMIT\` and \`OFFSET\`; NaN for one not given.`,
		ru: `\`LIMIT\` и \`OFFSET\`; NaN — не задан.`,
	},
	'SqlDialect.insertDefaults': {
		en: `An insert without a single column given.`,
		ru: `Вставка, в которой не задано ни одной колонки.`,
	},
	'SqlDialect.defaultValue': {
		en: `A value an insert of several rows leaves to the column's default.`,
		ru: `Значение, которое вставка нескольких строк оставляет умолчанию колонки.`,
	},
	'SqlDialect.onConflict': {
		en: `After \`INSERT ... VALUES ...\`: on a row whose \`target\` is taken already, change \`set\` instead - or, with none, do nothing.`,
		ru: `После \`INSERT ... VALUES ...\`: для строки, чей \`target\` уже занят, изменить вместо этого \`set\` — а без него ничего не делать.`,
	},
	'SqlDialect.returningId': {
		en: `After an insert: what makes \`insertId\` - nothing where the server gives it.`,
		ru: `После вставки: то, что даёт \`insertId\`, — ничего, если его отдаёт сервер.`,
	},
	'SqlDialect.columnType': {
		en: `A column's type in \`CREATE TABLE\`: \`VARCHAR(32)\`.`,
		ru: `Тип колонки в \`CREATE TABLE\`: \`VARCHAR(32)\`.`,
	},
	'SqlDialect.createTable': {
		en: `\`CREATE TABLE IF NOT EXISTS\` of the table, and then any statement its indexes need.`,
		ru: `\`CREATE TABLE IF NOT EXISTS\` для таблицы, а затем запросы, которые нужны её индексам.`,
	},
	'SqlDialect.columnDefinition': {
		en: `A column of \`CREATE TABLE\`: its name, type, \`NOT NULL\`, default and \`UNIQUE\`.`,
		ru: `Колонка в \`CREATE TABLE\`: имя, тип, \`NOT NULL\`, умолчание и \`UNIQUE\`.`,
	},
	'SqlDialect.indexesInside': {
		en: `Writes the composite keys inside \`CREATE TABLE\`, where the database takes them there; false leaves each to a \`CREATE INDEX\`.`,
		ru: `Пишет составные ключи внутри \`CREATE TABLE\`, если база принимает их там; false оставляет каждый отдельному \`CREATE INDEX\`.`,
	},
	'SqlDialect.index': {
		en: `\`CREATE INDEX\` of a composite key.`,
		ru: `\`CREATE INDEX\` для составного ключа.`,
	},
	'SqlDialect.literal': {
		en: `A default of \`create\`, written into the statement - a value of the plugin's code, never one a player typed.`,
		ru: `Умолчание для \`create\`, вписанное в запрос, — значение из кода плагина, никогда не то, что ввёл игрок.`,
	},
	'SqlDialect.unsupported': {
		en: `The error of something this dialect's database cannot do: \`mysql has no ...: write ... instead\`.`,
		ru: `Ошибка о том, чего база этого диалекта не умеет: \`mysql has no ...: write ... instead\`.`,
	},
	'SelectBuilder': {
		en: `The start of a query of rows: \`db.select().from(records)\`.`,
		ru: `Начало запроса строк: \`db.select().from(records)\`.`,
	},
	'SelectBuilder.from': {
		en: `The table whose rows the query reads, every column of them.`,
		ru: `Таблица, строки которой читает запрос, со всеми колонками.`,
	},
	'SelectFieldsBuilder': {
		en: `The start of a query of chosen columns: \`db.select({ time: records.time }).from(records)\`.`,
		ru: `Начало запроса выбранных колонок: \`db.select({ time: records.time }).from(records)\`.`,
	},
	'SelectFieldsBuilder.from': {
		en: `The table whose rows the query reads.`,
		ru: `Таблица, строки которой читает запрос.`,
	},
	'SelectQuery': {
		en: `A query of rows, sent when it is awaited: \`await db.select().from(records).where(...)\`.`,
		ru: `Запрос строк, который уходит, когда его ждут: \`await db.select().from(records).where(...)\`.`,
	},
	'SelectQuery.where': {
		en: `Only the rows the condition holds for.`,
		ru: `Только строки, для которых выполняется условие.`,
	},
	'SelectQuery.groupBy': {
		en: `One row for each value of these columns, which aggregates are worked out over.`,
		ru: `Одна строка на каждое значение этих колонок; по ним считаются агрегаты.`,
	},
	'SelectQuery.orderBy': {
		en: `The rows in this order: by a column - smallest first - or \`asc(...)\` and \`desc(...)\`.`,
		ru: `Строки в этом порядке: по колонке — сначала наименьшие — или \`asc(...)\` и \`desc(...)\`.`,
	},
	'SelectQuery.limit': {
		en: `At most this many rows.`,
		ru: `Не больше стольких строк.`,
	},
	'SelectQuery.offset': {
		en: `Leaves out this many rows first.`,
		ru: `Сначала пропускает столько строк.`,
	},
	'SelectQuery.then': {
		en: `Sends the query and calls \`onFulfilled\` with its rows.`,
		ru: `Отправляет запрос и вызывает \`onFulfilled\` с его строками.`,
	},
	'SelectQuery.catch': {
		en: `Sends the query; \`onRejected\` is called if it fails.`,
		ru: `Отправляет запрос; \`onRejected\` вызывается, если он не удался.`,
	},
	'InsertBuilder': {
		en: `The start of an insert: \`db.insert(records).values({ ... })\`.`,
		ru: `Начало вставки: \`db.insert(records).values({ ... })\`.`,
	},
	'InsertBuilder.values': {
		en: `The row to insert, or the rows.`,
		ru: `Строка для вставки или строки.`,
	},
	'ConflictTarget': {
		en: `The key whose taken value is a conflict: a column with a unique or primary key, or the columns of one.`,
		ru: `Ключ, занятое значение которого — конфликт: колонка с уникальным или первичным ключом или колонки такого ключа.`,
	},
	'ConflictTarget.target': {
		en: `The column, or the columns, of the unique key.`,
		ru: `Колонка или колонки уникального ключа.`,
	},
	'ConflictUpdate': {
		en: `The change an insert makes instead on a row whose key is taken.`,
		ru: `Изменение, которое вставка делает вместо этого в строке, чей ключ уже занят.`,
	},
	'ConflictUpdate.target': {
		en: `The column, or the columns, of the unique key.`,
		ru: `Колонка или колонки уникального ключа.`,
	},
	'ConflictUpdate.set': {
		en: `The columns to change on the row there, and their values.`,
		ru: `Колонки, которые нужно изменить в той строке, и их значения.`,
	},
	'InsertQuery': {
		en: `An insert, sent when it is awaited; gives \`{ insertId, affectedRows }\`.`,
		ru: `Вставка, которая уходит, когда её ждут; отдаёт \`{ insertId, affectedRows }\`.`,
	},
	'InsertQuery.onConflictDoNothing': {
		en: `Leaves a row out when its key is taken already.`,
		ru: `Пропускает строку, если её ключ уже занят.`,
	},
	'InsertQuery.onConflictDoUpdate': {
		en: `Changes \`set\` on the row there instead when the row's key is taken already.`,
		ru: `Если ключ строки уже занят, меняет вместо этого \`set\` в той строке.`,
	},
	'InsertQuery.then': {
		en: `Sends the insert and calls \`onFulfilled\` with what it did.`,
		ru: `Отправляет вставку и вызывает \`onFulfilled\` с её итогом.`,
	},
	'InsertQuery.catch': {
		en: `Sends the insert; \`onRejected\` is called if it fails.`,
		ru: `Отправляет вставку; \`onRejected\` вызывается, если она не удалась.`,
	},
	'UpdateBuilder': {
		en: `The start of an update: \`db.update(records).set({ ... })\`.`,
		ru: `Начало изменения: \`db.update(records).set({ ... })\`.`,
	},
	'UpdateBuilder.set': {
		en: `The columns to change, and their values.`,
		ru: `Колонки, которые нужно изменить, и их значения.`,
	},
	'ChangeQuery': {
		en: `An update or a delete, sent when it is awaited; gives \`{ insertId, affectedRows }\`.`,
		ru: `Изменение или удаление, которое уходит, когда его ждут; отдаёт \`{ insertId, affectedRows }\`.`,
	},
	'ChangeQuery.where': {
		en: `Only the rows the condition holds for; without it, every row.`,
		ru: `Только строки, для которых выполняется условие; без него — все строки.`,
	},
	'ChangeQuery.then': {
		en: `Sends the statement and calls \`onFulfilled\` with what it did.`,
		ru: `Отправляет запрос и вызывает \`onFulfilled\` с его итогом.`,
	},
	'ChangeQuery.catch': {
		en: `Sends the statement; \`onRejected\` is called if it fails.`,
		ru: `Отправляет запрос; \`onRejected\` вызывается, если он не удался.`,
	},
};
