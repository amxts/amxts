// The tooltips of as/fs.ts, in both languages: scripts/apply-docs.ts writes the
// one AMXTS_DOCS_LANG picks into the JSDoc above each element.
export default {
	'readFileSync': {
		en: `
			Reads a whole file as text; \`null\` when it cannot be opened.

			\`\`\`ts
			const text = fs.readFileSync("addons/amxmodx/configs/myplugin.ini");
			if (text == null) return;
			\`\`\`

			The path is relative to the game folder (\`cstrike/\`), as for any AMX Mod X
			plugin. The file is UTF-8; it is read whole, whatever its size.

			Pawn: \`fopen\`, \`fread_blocks\`
		`,
		ru: `
			Читает весь файл как текст; \`null\`, если его не удалось открыть.

			\`\`\`ts
			const text = fs.readFileSync("addons/amxmodx/configs/myplugin.ini");
			if (text == null) return;
			\`\`\`

			Путь считается от папки игры (\`cstrike/\`), как у любого плагина AMX Mod X.
			Файл в UTF-8; он читается целиком, какого бы размера ни был.

			Pawn: \`fopen\`, \`fread_blocks\`
		`,
	},
	'writeFileSync': {
		en: `
			Writes text to a file, replacing what was there; \`false\` when it cannot be
			opened (a folder that does not exist, for one).

			\`\`\`ts
			fs.writeFileSync("addons/amxmodx/data/last-map.txt", server.map);
			\`\`\`

			Pawn: \`fopen\`, \`fputs\`
		`,
		ru: `
			Записывает текст в файл вместо того, что там было; \`false\`, если файл не
			удалось открыть (например, такой папки нет).

			\`\`\`ts
			fs.writeFileSync("addons/amxmodx/data/last-map.txt", server.map);
			\`\`\`

			Pawn: \`fopen\`, \`fputs\`
		`,
	},
	'appendFileSync': {
		en: `
			Adds text to the end of a file, making it if there is none; \`false\` when it cannot be opened.

			Pawn: \`fopen(path, "a")\`, \`fputs\`
		`,
		ru: `
			Дописывает текст в конец файла, создавая его, если файла нет; \`false\`, если его не удалось открыть.

			Pawn: \`fopen(path, "a")\`, \`fputs\`
		`,
	},
	'existsSync': {
		en: `
			\`true\` when the file or folder exists.

			Pawn: \`file_exists\`, \`dir_exists\`
		`,
		ru: `
			\`true\`, если такой файл или папка есть.

			Pawn: \`file_exists\`, \`dir_exists\`
		`,
	},
	'readdirSync': {
		en: `
			Lists the names in a folder, without \`.\` and \`..\`; \`null\` when there is no
			such folder.

			\`\`\`ts
			const maps = fs.readdirSync("maps");
			\`\`\`

			Pawn: \`open_dir\`, \`next_file\`
		`,
		ru: `
			Возвращает имена в папке, без \`.\` и \`..\`; \`null\`, если такой папки нет.

			\`\`\`ts
			const maps = fs.readdirSync("maps");
			\`\`\`

			Pawn: \`open_dir\`, \`next_file\`
		`,
	},
	'MakeDirectoryOptions': {
		en: `The options of \`mkdirSync\`: \`{ recursive: true }\` makes the missing folders above too.`,
		ru: `Настройки \`mkdirSync\`: \`{ recursive: true }\` создаёт и недостающие папки выше.`,
	},
	'MakeDirectoryOptions.recursive': {
		en: `\`true\` to make every missing folder on the way too; \`false\` by default.`,
		ru: `\`true\` — создать и все недостающие папки по пути; по умолчанию \`false\`.`,
	},
	'mkdirSync': {
		en: `
			Makes a folder; \`false\` when it cannot be made, or - without \`recursive\` -
			when it is there already or its parent is not.

			\`\`\`ts
			fs.mkdirSync("addons/amxmodx/data/stats", { recursive: true });
			\`\`\`

			With \`{ recursive: true }\` every missing folder on the way is made, and a
			folder that is already there is fine, as in Node.

			Pawn: \`mkdir\`
		`,
		ru: `
			Создаёт папку; \`false\`, если создать не удалось, или — без \`recursive\` —
			если она уже есть или нет родительской.

			\`\`\`ts
			fs.mkdirSync("addons/amxmodx/data/stats", { recursive: true });
			\`\`\`

			С \`{ recursive: true }\` создаются все недостающие папки по пути, а уже
			существующая папка — не ошибка, как в Node.

			Pawn: \`mkdir\`
		`,
	},
	'mkdir': {
		en: `\`mkdirSync\` as a promise, rejected when the folder cannot be made.`,
		ru: `\`mkdirSync\` в виде промиса; отклоняется, если папку не удалось создать.`,
	},
	'readFile': {
		en: `
			\`readFileSync\` as a promise: it rejects with an \`ENOENT\` error when the file
			cannot be opened, like Node's \`fs.promises.readFile\`.

			\`\`\`ts
			const text = await fs.readFile("addons/amxmodx/configs/myplugin.ini");
			\`\`\`
		`,
		ru: `
			\`readFileSync\` в виде промиса: если файл не удалось открыть, отклоняется с
			ошибкой \`ENOENT\`, как \`fs.promises.readFile\` в Node.

			\`\`\`ts
			const text = await fs.readFile("addons/amxmodx/configs/myplugin.ini");
			\`\`\`
		`,
	},
	'writeFile': {
		en: `\`writeFileSync\` as a promise, rejected when the file cannot be opened.`,
		ru: `\`writeFileSync\` в виде промиса; отклоняется, если файл не удалось открыть.`,
	},
	'appendFile': {
		en: `\`appendFileSync\` as a promise, rejected when the file cannot be opened.`,
		ru: `\`appendFileSync\` в виде промиса; отклоняется, если файл не удалось открыть.`,
	},
	'exists': {
		en: `\`existsSync\` as a promise.`,
		ru: `\`existsSync\` в виде промиса.`,
	},
	'readdir': {
		en: `\`readdirSync\` as a promise, rejected when there is no such folder.`,
		ru: `\`readdirSync\` в виде промиса; отклоняется, если такой папки нет.`,
	},
};
