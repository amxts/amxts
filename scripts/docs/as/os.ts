// The tooltips of as/os.ts, in both languages: scripts/apply-docs.ts writes the
// one AMXTS_DOCS_LANG picks into the JSDoc above each element.
export default {
	Platform: {
		en: `The operating system's name as \`platform()\` gives it, with Node's names: one of \`"win32"\`, \`"linux"\`.`,
		ru: `Имя операционной системы, как его даёт \`platform()\`, — те же имена, что в Node: одно из \`"win32"\`, \`"linux"\`.`,
	},
	platform: {
		en: `Returns the operating system the server runs on, either \`"win32"\` or \`"linux"\`.`,
		ru: `Возвращает операционную систему сервера, либо \`"win32"\`, либо \`"linux"\`.`,
	},
	EOL: {
		en: `The line ending on this system, one of \`"\\r\\n"\` on Windows, \`"\\n"\` on Linux.`,
		ru: `Конец строки в этой системе, одно из: \`"\\r\\n"\` на Windows, \`"\\n"\` на Linux.`,
	},
};
