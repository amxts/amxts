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
			Writes text, or bytes - a \`Uint8Array\` or an \`ArrayBuffer\` - to a file,
			replacing what was there; \`false\` when it cannot be opened (a folder that
			does not exist, for one). Bytes are not written past the game folder.

			\`\`\`ts
			fs.writeFileSync("addons/amxmodx/data/last-map.txt", server.map);
			fs.writeFileSync("maps/kz_map.bsp", await response.arrayBuffer());
			\`\`\`

			Pawn: \`fopen\`, \`fputs\`
		`,
		ru: `
			Записывает текст или байты — \`Uint8Array\` или \`ArrayBuffer\` — в файл
			вместо того, что там было; \`false\`, если файл не удалось открыть (например,
			такой папки нет). Байты не пишутся за пределы папки игры.

			\`\`\`ts
			fs.writeFileSync("addons/amxmodx/data/last-map.txt", server.map);
			fs.writeFileSync("maps/kz_map.bsp", await response.arrayBuffer());
			\`\`\`

			Pawn: \`fopen\`, \`fputs\`
		`,
	},
	'appendFileSync': {
		en: `
			Adds text or bytes to the end of a file, making it if there is none; \`false\` when it cannot be opened.

			Pawn: \`fopen(path, "a")\`, \`fputs\`
		`,
		ru: `
			Дописывает текст или байты в конец файла, создавая его, если файла нет; \`false\`, если его не удалось открыть.

			Pawn: \`fopen(path, "a")\`, \`fputs\`
		`,
	},
	'readBytesSync': {
		en: `
			Reads a whole file as bytes; \`null\` when it cannot be opened or the path
			leaves the game folder.
		`,
		ru: `
			Читает весь файл как байты; \`null\`, если его не удалось открыть или путь
			ведёт за пределы папки игры.
		`,
	},
	'readBytes': {
		en: `
			\`readBytesSync\` as a promise, rejected when the file cannot be opened: the
			file is read on the module's worker thread, without holding the server.
		`,
		ru: `
			\`readBytesSync\` в виде промиса; отклоняется, если файл не удалось открыть.
			Файл читается в рабочем потоке модуля и не задерживает сервер.
		`,
	},
	'ArchiveEntry': {
		en: `A file of an archive, from \`extract\`: its path inside the archive and its bytes.`,
		ru: `Файл архива из \`extract\`: его путь внутри архива и его байты.`,
	},
	'ArchiveEntry.path': {
		en: `The path inside the archive, \`/\` between folders: \`"maps/de_dust2.bsp"\`.`,
		ru: `Путь внутри архива, \`/\` между папками: \`"maps/de_dust2.bsp"\`.`,
	},
	'ArchiveEntry.data': {
		en: `The file's bytes.`,
		ru: `Байты файла.`,
	},
	'extract': {
		en: `
			The files of an archive, with their paths inside it; folders are not
			listed. The archive's kind is read off its first bytes: a zip archive,
			stored or deflated. The files are inflated on the module's worker thread,
			without holding the server, and the promise settles on a later frame. It
			rejects with an \`Error\` for a kind it does not read - naming the ones it
			does - a file whose bytes do not check out, and a path that would leave
			the folder it is unpacked into.

			\`\`\`ts
			for (const entry of await fs.extract(await response.arrayBuffer())) {
				await fs.writeFile(entry.path, entry.data);
			}
			\`\`\`
		`,
		ru: `
			Файлы архива с их путями внутри него; папки не перечисляются. Вид архива
			читается по его первым байтам: zip-архив, сохранённый как есть или сжатый
			deflate. Файлы распаковываются в рабочем потоке модуля и не задерживают
			сервер, а промис выполняется на одном из следующих кадров. Отклоняется с
			\`Error\` для вида, который не читает, — называя те, что читает, — для
			файла, чьи байты не сходятся, и для пути, который ведёт за пределы папки,
			куда архив распаковывается.

			\`\`\`ts
			for (const entry of await fs.extract(await response.arrayBuffer())) {
				await fs.writeFile(entry.path, entry.data);
			}
			\`\`\`
		`,
	},
	'extractSync': {
		en: `
			\`extract\` at once, holding the server while it inflates: the files of an
			archive, or an \`Error\` thrown where \`extract\` rejects.

			\`\`\`ts
			for (const entry of fs.extractSync(bytes)) {
				fs.writeFileSync(entry.path, entry.data);
			}
			\`\`\`
		`,
		ru: `
			\`extract\` сразу, с задержкой сервера на время распаковки: файлы архива
			или \`Error\`, брошенная там, где \`extract\` отклоняется.

			\`\`\`ts
			for (const entry of fs.extractSync(bytes)) {
				fs.writeFileSync(entry.path, entry.data);
			}
			\`\`\`
		`,
	},
	'ExistsOptions': {
		en: `The options of \`existsSync\`: \`{ game: true }\` looks in every folder of the game.`,
		ru: `Настройки \`existsSync\`: \`{ game: true }\` ищет во всех папках игры.`,
	},
	'ExistsOptions.game': {
		en: `\`true\` to look in every folder the game reads from (\`valve/\`, \`cstrike_downloads/\`...), not only the game folder; \`false\` by default.`,
		ru: `\`true\` — искать во всех папках, из которых игра читает файлы (\`valve/\`, \`cstrike_downloads/\`...), а не только в папке игры; по умолчанию \`false\`.`,
	},
	'existsSync': {
		en: `
			\`true\` when the file or folder exists: \`fs.existsSync("maps/de_dust2.bsp")\`.
			With \`{ game: true }\`, in any folder the game reads files from.

			Pawn: \`file_exists\`, \`dir_exists\`
		`,
		ru: `
			\`true\`, если такой файл или папка есть: \`fs.existsSync("maps/de_dust2.bsp")\`.
			С \`{ game: true }\` — в любой папке, из которой игра читает файлы.

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
		en: `
			\`writeFileSync\` as a promise, rejected when the file cannot be opened.
			Bytes are written on the module's worker thread, without holding the
			server, in the order the calls were made.
		`,
		ru: `
			\`writeFileSync\` в виде промиса; отклоняется, если файл не удалось открыть.
			Байты пишутся в рабочем потоке модуля и не задерживают сервер — в том
			порядке, в каком были вызовы.
		`,
	},
	'appendFile': {
		en: `\`appendFileSync\` as a promise, rejected when the file cannot be opened; bytes are written as \`writeFile\` writes them.`,
		ru: `\`appendFileSync\` в виде промиса; отклоняется, если файл не удалось открыть. Байты пишутся так же, как пишет \`writeFile\`.`,
	},
	'exists': {
		en: `\`existsSync\` as a promise.`,
		ru: `\`existsSync\` в виде промиса.`,
	},
	'readdir': {
		en: `\`readdirSync\` as a promise, rejected when there is no such folder.`,
		ru: `\`readdirSync\` в виде промиса; отклоняется, если такой папки нет.`,
	},
	'unlinkSync': {
		en: `
			Deletes a file; \`false\` when there is none or it cannot be deleted.

			Pawn: \`delete_file\`, \`unlink\`
		`,
		ru: `
			Удаляет файл; \`false\`, если его нет или его не удалось удалить.

			Pawn: \`delete_file\`, \`unlink\`
		`,
	},
	'renameSync': {
		en: `
			Moves or renames a file: \`fs.renameSync("addons/amxmodx/data/top.txt",
			"addons/amxmodx/data/top.old")\`; \`false\` when it cannot.

			Pawn: \`rename_file\`
		`,
		ru: `
			Перемещает или переименовывает файл: \`fs.renameSync("addons/amxmodx/data/top.txt",
			"addons/amxmodx/data/top.old")\`; \`false\`, если не удалось.

			Pawn: \`rename_file\`
		`,
	},
	'rmdirSync': {
		en: `
			Deletes an empty folder; \`false\` when there is none, it holds something or
			it cannot be deleted.

			Pawn: \`rmdir\`
		`,
		ru: `
			Удаляет пустую папку; \`false\`, если её нет, в ней что-то есть или её не
			удалось удалить.

			Pawn: \`rmdir\`
		`,
	},
	'Stats': {
		en: `
			A file's or a folder's facts from \`statSync\`, as Node's \`fs.Stats\`.
		`,
		ru: `
			Сведения о файле или папке из \`statSync\`, как \`fs.Stats\` в Node.
		`,
	},
	'Stats.size': {
		en: `
			The size in bytes; \`0\` for a folder.
		`,
		ru: `
			Размер в байтах; \`0\` для папки.
		`,
	},
	'Stats.mtime': {
		en: `
			The moment it last changed.
		`,
		ru: `
			Момент его последнего изменения.
		`,
	},
	'Stats.isFile': {
		en: `
			Whether it is a file.
		`,
		ru: `
			Файл ли это.
		`,
	},
	'Stats.isDirectory': {
		en: `
			Whether it is a folder.
		`,
		ru: `
			Папка ли это.
		`,
	},
	'statSync': {
		en: `
			A file's or a folder's size and the moment it last changed; \`null\` when
			there is none: \`fs.statSync("addons/amxmodx/logs/error.log")?.size\`.

			Pawn: \`file_size\`, \`GetFileTime\`
		`,
		ru: `
			Размер файла или папки и момент последнего изменения; \`null\`, если их нет:
			\`fs.statSync("addons/amxmodx/logs/error.log")?.size\`.

			Pawn: \`file_size\`, \`GetFileTime\`
		`,
	},
	'unlink': {
		en: `
			\`unlinkSync\` as a promise, rejected when the file cannot be deleted.
		`,
		ru: `
			\`unlinkSync\` в виде промиса; отклоняется, если файл не удалось удалить.
		`,
	},
	'rename': {
		en: `
			\`renameSync\` as a promise, rejected when the file cannot be moved.
		`,
		ru: `
			\`renameSync\` в виде промиса; отклоняется, если файл не удалось переместить.
		`,
	},
	'rmdir': {
		en: `
			\`rmdirSync\` as a promise, rejected when the folder cannot be deleted.
		`,
		ru: `
			\`rmdirSync\` в виде промиса; отклоняется, если папку не удалось удалить.
		`,
	},
	'stat': {
		en: `
			\`statSync\` as a promise, rejected when there is no such file or folder.
		`,
		ru: `
			\`statSync\` в виде промиса; отклоняется, если такого файла или папки нет.
		`,
	},
};
