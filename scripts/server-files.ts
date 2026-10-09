// A server's addons/amxts: what the module writes out on a start when it is
// missing (runtime/src/embedded.h, made by scripts/generate-embedded.ts), and
// what a server kit carries (scripts/pack-server.ts). One list, so the two
// cannot differ. A server loads .aot files only, built on the author's
// machine: nothing here is for compiling.

export interface ServerFile {
	/** Under addons/amxts. */
	path: string;
	text: string;
	/** The author's: written only while missing. */
	keep: boolean;
}

/** plugins.ini naming `plugins`: the module's own names none, a kit's its example. */
export function pluginList(plugins: string[] = []): ServerFile {
	return {
		path: 'plugins.ini',
		text: ['; One plugin per line: a .aot in plugins/, built with npx amxts build.', ...plugins, ''].join('\n'),
		keep: true,
	};
}
