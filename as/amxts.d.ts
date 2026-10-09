// The globals a module file and amxts.config.ts use without an import:
// defineModule and defineConfig; and the types of a field's change the
// editor reads off Player, which the compiler has from the build.
//
// Only the editor reads this file. The build reads a module's definition from
// its source and evaluates amxts.config.ts with a defineConfig of its own
// (scripts/project.ts); asc never compiles either call.
import type { CommandOptions, ModuleOptions, Player, PlayerChangeEvent } from "./facade";

declare global {
	/** A module's name and config key. */
	interface AmxtsModuleMeta {
		/** The package's name without its scope, e.g. `"menu-core"` for `@amxts/menu-core`. */
		name: string;
		/** The key the module's options go under in `amxts.config.ts`, e.g. `"menus"`. */
		configKey?: string;
	}

	/** A module's API as plugins use it without an import: a namespace and its name (`as`), or one of its exports by its own name (`name`). */
	interface AmxtsModuleImport {
		/** The module's own package, e.g. `"@amxts/menu-core"`. */
		from: string;
		/** The name plugins use it by, e.g. `"menus"`: `menus.create(...)`. */
		as?: string;
		/** One export plugins use by its own name, e.g. `"semiclip"`: `semiclip.rule = ...`. */
		name?: string;
	}

	/** A module's definition for `defineModule`: its meta, the modules it requires, its options, what it gives plugins and its setup. */
	interface AmxtsModule<T> {
		/** The module's name and `configKey`. */
		meta: AmxtsModuleMeta;
		/** The module packages this one needs, e.g. `"@amxts/config-core"`. They come along with it - listing this one in `amxts.config.ts` is enough - and load first. */
		requires?: string[];
		/** The module's default options: the values used when `amxts.config.ts` does not set them. */
		defaults?: T;
		/**
		 * The module's API as plugins use it without an import, e.g. `[{ from: "@amxts/menu-core", as: "menus" }]`:
		 * a plugin writes `menus.create(...)`, and the build adds the import to
		 * that plugin alone. `{ from, name }` gives one export by its own name
		 * instead - an object a plugin assigns a property of, as `semiclip.rule = ...`.
		 */
		imports?: AmxtsModuleImport[];
		/**
		 * Runs once, in the module's plugin, when the server loads it. Gets the
		 * defaults with what `amxts.config.ts` sets under `configKey` on top.
		 */
		setup?: (options: T) => void;
	}

	/** The project's auto-imports: `imports` in `amxts.config.ts`. */
	interface AmxtsImports {
		/** `false`: the plugins import everything themselves. `true` by default. */
		autoImport?: boolean;
	}

	/** The project's settings, exported by `amxts.config.ts`: the modules it uses and their options. */
	interface AmxtsConfig extends ModuleOptions {
		/** The project's module packages, by name, e.g. `"@amxts/menu-core"`. The build loads each after the ones it requires. */
		modules?: string[];
		/** The folder with the project's plugins; `"plugins"` by default. */
		pluginsDir?: string;
		/** The folder the build writes the `.aot` files and `plugins.ini` to; `"dist"` by default. */
		outDir?: string;
		/**
		 * The server the project is for, one of `"rehlds"` (ReHLDS, ReGameDLL and
		 * ReAPI) or `"hlds"` (plain HLDS); `"rehlds"` by default. Without a server
		 * (`AMXTS_SERVER`) the `amxts` command fetches the includes that server has
		 * into `.amxts/include`; with one, the build takes the server's own.
		 */
		target?: "rehlds" | "hlds";
		/**
		 * Auto-imports: the build adds the imports of what a plugin uses without
		 * importing it - the core's API and what the modules give. `{ autoImport:
		 * false }` turns them off; the plugins import everything themselves.
		 */
		imports?: AmxtsImports;
		/**
		 * The modules whose natives Pawn plugins call, by package name, e.g.
		 * `"@amxts/menu-core"`. A module no plugin of the project uses is left out
		 * of the build; one listed here is built all the same.
		 */
		pawn?: string[];
	}

	/**
	 * Defines a module, in its module file:
	 *
	 * ```ts
	 * export default defineModule<MenuCoreOptions>({
	 *   meta: { name: "menu-core", configKey: "menus" },
	 *   requires: ["@amxts/config-core"],
	 *   defaults: { file: "menu" },
	 *   imports: [{ from: "@amxts/menu-core", as: "menus" }],
	 *   setup(options) { ... },
	 * });
	 * ```
	 */
	function defineModule<T = Record<string, never>>(definition: AmxtsModule<T>): AmxtsModule<T>;

	/**
	 * Defines the project's settings, in `amxts.config.ts`:
	 *
	 * ```ts
	 * export default defineConfig({
	 *   modules: ["@amxts/config-core", "@amxts/menu-core"],
	 *   menus: { file: "myserver/menu" },
	 * });
	 * ```
	 */
	function defineConfig(config: AmxtsConfig): AmxtsConfig;
}

// A field's change, typed by the field. The compiler gives a listener with
// `{ field: "spawnProtected" }` the field's own event class (scripts/player-fields.ts);
// the editor reads the same types off the fields plugins declare on Player.

/** A field plugins added to `Player` - `"spawnProtected"` - or a member of an object field, `"glow.enabled"`. */
type PlayerFieldName = {
	[K in keyof Player & string]: Player[K] extends (...args: never[]) => unknown ? never
		: Player[K] extends readonly unknown[] ? K
			: Player[K] extends object ? K | `${K}.${keyof Player[K] & string}`
				: K
}[keyof Player & string];

/** The type of the field `F` names; `never` when it names none. */
type PlayerFieldValue<F extends string> = F extends `${infer O}.${infer M}`
	? O extends keyof Player ? (M extends keyof Player[O] ? Player[O][M] : never) : never
	: F extends keyof Player ? Player[F] : never;

// A command's arguments, typed. The build reads the type argument and the
// usage the same way (scripts/typed-commands.ts); the editor reads them here.

/** The names a usage requires: `<target>` in `"/kick <target> [reason]"`. */
type RequiredNames<U extends string> = U extends `${string}<${infer N}>${infer R}` ? N | RequiredNames<R> : never;

/** The names a usage may leave out: `[reason]`. */
type OptionalNames<U extends string> = U extends `${string}[${infer N}]${infer R}` ? N | OptionalNames<R> : never;

/** A usage's arguments, each text; any name for a usage made at run time, which the build reads. */
type UsageArgs<U extends string> = string extends U ? Record<string, string | undefined> : { [K in RequiredNames<U>]: string } & { [K in OptionalNames<U>]?: string };

/** A command's arguments: the type argument's, or else the usage's, as text. */
type CommandArgsOf<T, U extends string> = [T] extends [never] ? UsageArgs<U> : T;

/**
 * What a command's handler takes: its arguments and `player` - `({ player,
 * target }) =>`; for a command without arguments, the player himself too -
 * `(player) =>`, which the compiler hands `player` (`Context & Player`).
 */
type CommandHandlerArgs<T, U extends string> = CommandArgsOf<T, U> & { player: Player } & ([T] extends [never] ? ([RequiredNames<U> | OptionalNames<U>] extends [never] ? Player : unknown) : unknown);

declare module "./facade" {
	interface PlayerChangeEvent<F extends string = string> {
		/** The field's value after the change; with `{ field }`, of the field's type. */
		readonly value: PlayerFieldValue<F>;
		/** The field's value before the change. */
		readonly previous: PlayerFieldValue<F>;
	}

	interface Server {
		/**
		 * Calls `listener` every time the field `field` plugins added to `Player`
		 * changes on a player, e.g. `{ field: "spawnProtected" }`: `event.value`
		 * and `event.previous` have the field's type.
		 */
		// oxlint-disable-next-line typescript/method-signature-style -- an overload, merged into the class's method
		addEventListener<F extends PlayerFieldName>(type: "playerChange", listener: (event: PlayerChangeEvent<F>) => void, options: { field: F }): void;
		/** Stops calling a listener added with `addEventListener` - the same function and the same field. */
		// oxlint-disable-next-line typescript/method-signature-style -- an overload, merged into the class's method
		removeEventListener<F extends PlayerFieldName>(type: "playerChange", listener: (event: PlayerChangeEvent<F>) => void, options: { field: F }): void;
		/**
		 * Adds a command players type, by its usage: the name, then the
		 * arguments, `<name>` required and `[name]` optional. Their types are an
		 * interface, the type argument; without it each is text.
		 *
		 * ```ts
		 * interface KickArgs {
		 *   target: Player;
		 *   reason?: string;
		 * }
		 *
		 * server.addCommand<KickArgs>("/kick <target> [reason]", ({ player, target, reason }) => {
		 *   target.kick(reason ?? `Kicked by ${player.name}`);
		 * }, { access: "kick" });
		 * server.addCommand("/hp", ({ player }) => player.print(`${player.health} HP`));
		 * server.addCommand(["/cp", "cp"], checkpoint);   // several names; a handler of the player
		 * ```
		 *
		 * A name with `/` is a chat command, one without a console command, and
		 * `"say <phrase>"` a phrase written in chat. Several names - the usage
		 * first, then other names - are one command. A command without
		 * arguments takes a handler of the player, `(player) => ...`. A `number` argument is
		 * parsed, a `Player` found by `#userid`, the whole name or a part of it,
		 * a `string` taken as it is - the last one takes the rest of the line. A
		 * word that is not what the command takes answers the player with the
		 * usage, and the handler does not run.
		 *
		 * Pawn: `register_clcmd`
		 */
		// oxlint-disable-next-line typescript/method-signature-style -- the editor's signature of the class's method, which the build writes per call
		addCommand<T extends object = never, const U extends string = string>(usage: U | readonly [U, ...string[]], handler: (args: CommandHandlerArgs<T, U>) => void, options?: CommandOptions): void;
		/**
		 * Adds a command of the server console - typed there, sent over rcon or
		 * run by another plugin - by its usage, its arguments read as a player's
		 * command's are. No player types it.
		 *
		 * ```ts
		 * interface ResetArgs {
		 *   what?: "scores" | "all";
		 * }
		 *
		 * server.addServerCommand<ResetArgs>("myplugin_reset [what]", ({ what }) => reset(what ?? "all"));
		 * ```
		 *
		 * Pawn: `register_srvcmd`
		 */
		// oxlint-disable-next-line typescript/method-signature-style -- the editor's signature of the class's method, which the build writes per call
		addServerCommand<T extends object = never, const U extends string = string>(usage: U, handler: (args: CommandArgsOf<T, U>) => void): void;
	}
}

export {};
