// The tooltips of as/zlib.ts, in both languages: scripts/apply-docs.ts writes the
// one AMXTS_DOCS_LANG picks into the JSDoc above each element.
export default {
	gzipSync: {
		en: `
			Compresses into the gzip format, a \`.gz\` file's.

			\`\`\`ts
			fs.writeFileSync("addons/amxmodx/data/run.rec.gz", zlib.gzipSync(recording));
			\`\`\`
		`,
		ru: `
			Сжимает в формат gzip — формат файла \`.gz\`.

			\`\`\`ts
			fs.writeFileSync("addons/amxmodx/data/run.rec.gz", zlib.gzipSync(recording));
			\`\`\`
		`,
	},
	gunzipSync: {
		en: `Inflates gzip data; throws an \`Error\` when it is not whole gzip data, or comes to more than 64 MB.`,
		ru: `Распаковывает данные gzip; бросает \`Error\`, если это не целые данные gzip или они дают больше 64 МБ.`,
	},
	deflateSync: {
		en: `Compresses into the zlib format: deflate data with zlib's header and checksum.`,
		ru: `Сжимает в формат zlib: данные deflate с заголовком и контрольной суммой zlib.`,
	},
	inflateSync: {
		en: `Inflates zlib data; throws an \`Error\` when it is not whole zlib data, or comes to more than 64 MB.`,
		ru: `Распаковывает данные zlib; бросает \`Error\`, если это не целые данные zlib или они дают больше 64 МБ.`,
	},
	deflateRawSync: {
		en: `Compresses into raw deflate data, with no header around it, as a zip archive holds a file.`,
		ru: `Сжимает в голые данные deflate, без заголовка, — так файл лежит в zip-архиве.`,
	},
	inflateRawSync: {
		en: `Inflates raw deflate data; throws an \`Error\` when it is not whole deflate data, or comes to more than 64 MB.`,
		ru: `Распаковывает голые данные deflate; бросает \`Error\`, если это не целые данные deflate или они дают больше 64 МБ.`,
	},
	gzip: {
		en: `
			\`gzipSync\` without holding the server: the work is done on the module's
			worker thread, and the promise settles on a later frame.

			\`\`\`ts
			await fs.writeFile("addons/amxmodx/data/run.rec.gz", await zlib.gzip(recording));
			\`\`\`
		`,
		ru: `
			\`gzipSync\` без задержки сервера: работа идёт в рабочем потоке модуля, а
			промис выполняется на одном из следующих кадров.

			\`\`\`ts
			await fs.writeFile("addons/amxmodx/data/run.rec.gz", await zlib.gzip(recording));
			\`\`\`
		`,
	},
	gunzip: {
		en: `\`gunzipSync\` on the module's worker thread; rejects with an \`Error\` when the data is not whole gzip data.`,
		ru: `\`gunzipSync\` в рабочем потоке модуля; отклоняется с \`Error\`, если это не целые данные gzip.`,
	},
	deflate: {
		en: `\`deflateSync\` on the module's worker thread.`,
		ru: `\`deflateSync\` в рабочем потоке модуля.`,
	},
	inflate: {
		en: `\`inflateSync\` on the module's worker thread; rejects with an \`Error\` when the data is not whole zlib data.`,
		ru: `\`inflateSync\` в рабочем потоке модуля; отклоняется с \`Error\`, если это не целые данные zlib.`,
	},
	deflateRaw: {
		en: `\`deflateRawSync\` on the module's worker thread.`,
		ru: `\`deflateRawSync\` в рабочем потоке модуля.`,
	},
	inflateRaw: {
		en: `\`inflateRawSync\` on the module's worker thread; rejects with an \`Error\` when the data is not whole deflate data.`,
		ru: `\`inflateRawSync\` в рабочем потоке модуля; отклоняется с \`Error\`, если это не целые данные deflate.`,
	},
};
