import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setup } from '@amxts/core/test-utils';
// `amxts upgrade` (scripts/upgrade.ts): imports of the core's API by `~/`
// become imports by the package's name, a module package's place in the
// build's tree its name; the project's own files, strings and comments stay.
// @ts-ignore - bun:test types not available during type checking
import { afterEach, expect, setDefaultTimeout, test } from 'bun:test';
import { CORE_PLUGINS, setProjectDir } from '../scripts/project';
import { dropHttpImports, renamesFor, upgradeEvents, upgradeFlags, upgradeHandlers, upgradeMessages, upgradeNames, upgradeProject, upgradeText } from '../scripts/upgrade';
import { upgradeCalls } from '../scripts/upgrade-calls';
import { upgradeMenus } from '../scripts/upgrade-menus';

setDefaultTimeout(240_000);

const HERE = process.cwd();
const made: string[] = [];

afterEach(() => {
	setProjectDir(HERE);
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const MODULES = [{ name: '@amxts/menu-core', short: 'menu-core' }];

const PLUGIN = [
	'import { get_maxplayers } from "~/natives";',
	'import { MAX_PLAYERS } from \'~/constants\';',
	'import * as fs from "~/fs";',
	'import { Weapon } from "~/entities";',
	'import * as menus from "~/modules/menu-core";',
	'import { typed } from "~/modules/menu-core/src/typed";',
	'import "~/myplugin/player";',
	'export { EOL } from "~/os";',
	'',
	'declare module "~/facade" {',
	'\tinterface Player {',
	'\t\tghost: boolean;',
	'\t}',
	'}',
	'',
	'// import { x } from "~/natives";',
	'const text = \'import { x } from "~/natives"\';',
	'const later = import("~/natives");',
	'',
].join('\n');

test('every import of the core\'s API and of a module package by ~/ is rewritten; nothing else is', () => {
	const { text, changes } = upgradeText('plugins/a.ts', PLUGIN, renamesFor(MODULES));

	expect(text).toBe(PLUGIN
		.replace('"~/natives";', '"@amxts/core/natives";')
		.replace('\'~/constants\'', '\'@amxts/core/constants\'')
		.replace('"~/fs"', '"@amxts/core/fs"')
		.replace('"~/entities"', '"@amxts/core"')
		.replace('"~/modules/menu-core";', '"@amxts/menu-core";')
		.replace('"~/modules/menu-core/src/typed"', '"@amxts/menu-core/src/typed"')
		.replace('"~/os"', '"@amxts/core/os"')
		.replace('declare module "~/facade"', 'declare module "@amxts/core"')
		.replace('import("~/natives")', 'import("@amxts/core/natives")'));
	expect(changes.map(change => `${change.file}:${change.line} ${change.from} -> ${change.to}`)).toEqual([
		'plugins/a.ts:1 ~/natives -> @amxts/core/natives',
		'plugins/a.ts:2 ~/constants -> @amxts/core/constants',
		'plugins/a.ts:3 ~/fs -> @amxts/core/fs',
		'plugins/a.ts:4 ~/entities -> @amxts/core',
		'plugins/a.ts:5 ~/modules/menu-core -> @amxts/menu-core',
		'plugins/a.ts:6 ~/modules/menu-core/src/typed -> @amxts/menu-core/src/typed',
		'plugins/a.ts:8 ~/os -> @amxts/core/os',
		'plugins/a.ts:10 ~/facade -> @amxts/core',
		'plugins/a.ts:18 ~/natives -> @amxts/core/natives',
	]);

	// A second run finds nothing.
	expect(upgradeText('plugins/a.ts', text, renamesFor(MODULES)).changes).toEqual([]);
});

test('a place the project\'s plugins folder has a file at is its own', () => {
	const renames = renamesFor(MODULES, place => place === 'os.ts');
	expect(upgradeText('a.ts', 'import { EOL } from "~/os";\n', renames).changes).toEqual([]);
});

test('a project is rewritten in place - plugins, tests, a local module - and a second run changes nothing', () => {
	const dir = join(tmpdir(), 'amxts-upgrade');
	rmSync(dir, { recursive: true, force: true });
	made.push(dir);
	const files: Record<string, string> = {
		'package.json': '{ "name": "myserver", "private": true }\n',
		'amxts.config.ts': 'export default defineConfig({ modules: [] });\n',
		'plugins/myplugin.ts': 'import { user_slap } from "~/natives";\nimport { twice } from "~/lib/twice";\n',
		'plugins/lib/twice.ts': 'export function twice(n: number) {\n\treturn n * 2;\n}\n',
		'plugins/modules/greeter.ts': 'import * as fs from "~/fs";\n',
		'test/fixtures/probe.ts': 'import { HIDE_HUD } from "~/facade";\n',
		'dist/old.ts': 'import { user_slap } from "~/natives";\n',
	};
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}

	// A dry run lists the same changes and writes nothing.
	expect(upgradeProject(dir, { write: false }).changes).toHaveLength(3);
	expect(readFileSync(join(dir, 'plugins/myplugin.ts'), 'utf8')).toBe(files['plugins/myplugin.ts']);

	const { changes } = upgradeProject(dir);
	expect(changes.map(change => `${change.file}:${change.line} ${change.to}`)).toEqual([
		'plugins/modules/greeter.ts:1 @amxts/core/fs',
		'plugins/myplugin.ts:1 @amxts/core/natives',
		'test/fixtures/probe.ts:1 @amxts/core',
	]);
	expect(readFileSync(join(dir, 'plugins/myplugin.ts'), 'utf8')).toBe('import { user_slap } from "@amxts/core/natives";\nimport { twice } from "~/lib/twice";\n');
	// What the build wrote is not the project's code.
	expect(readFileSync(join(dir, 'dist/old.ts'), 'utf8')).toBe(files['dist/old.ts']);
	expect(upgradeProject(dir)).toEqual({ changes: [], left: [], removed: [] });
});

test('a project in the server\'s folder: the module\'s own files there are not the project\'s code', () => {
	const dir = join(tmpdir(), 'amxts-upgrade-server');
	rmSync(dir, { recursive: true, force: true });
	made.push(dir);
	const old = 'import { user_slap } from "~/natives";\nexport class ClientInfochangedEvent {}\n';
	const files: Record<string, string> = {
		'package.json': '{ "name": "myserver", "private": true }\n',
		'amxts.config.ts': 'export default defineConfig({ modules: [] });\n',
		'plugins/myplugin.ts': 'import { user_slap } from "~/natives";\n',
		// The module's files on the server, under addons/amxts.
		'cstrike/addons/amxts/plugins/events.ts': old,
		'cstrike/addons/amxts/plugins/hlds.ts': old,
		'cstrike/addons/amxts/plugins/imports.d.ts': old,
		'cstrike/addons/amxts/plugins/hello.ts': old,
		// The folder AMXTS_SERVER names, by another name.
		'test-server/amxts/plugins/hello.ts': old,
		// A copy of the module's files, anywhere.
		'backup/plugins/events.ts': old,
	};
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	const server = process.env.AMXTS_SERVER;
	process.env.AMXTS_SERVER = join(dir, 'test-server/amxts');
	try {
		expect(upgradeProject(dir).changes.map(change => change.file)).toEqual(['plugins/myplugin.ts']);
	} finally {
		if (server === undefined) delete process.env.AMXTS_SERVER;
		else process.env.AMXTS_SERVER = server;
	}
	for (const path of Object.keys(files).filter(path => path !== 'plugins/myplugin.ts')) expect(readFileSync(join(dir, path), 'utf8')).toBe(files[path]);
});

/** A copy of the core's as/<file> an older amxts left in plugins/: the core's first line and old API. */
function staleCopy(file: string): string {
	return `${readFileSync(join(CORE_PLUGINS, file), 'utf8').split('\n', 1)[0]}\nexport function flagOf(name: string): i32 {\n\treturn name.length;\n}\n`;
}

test('the copies of the core\'s API an older amxts left in plugins/ go, after the imports of them are rewritten; the project builds', async () => {
	const dir = join(tmpdir(), 'amxts-upgrade-stale');
	rmSync(dir, { recursive: true, force: true });
	made.push(dir);
	const files: Record<string, string> = {
		'package.json': '{ "name": "myserver", "private": true }\n',
		'amxts.config.ts': 'export default defineConfig({ modules: [] });\n',
		'plugins/myplugin.ts': 'import { server } from "~/facade";\nimport { MAX_PLAYERS } from "~/constants";\n\nexport function my_slots(): number {\n\treturn server.maxPlayers + MAX_PLAYERS;\n}\n',
		'plugins/constants.ts': '// GENERATED by scripts/generate-wasm-api.ts - do not edit\nexport function flagOf(name: string): i32 {\n\treturn 0;\n}\n',
		'plugins/facade.ts': staleCopy('facade.ts'),
		'plugins/fs.ts': staleCopy('fs.ts'),
		'plugins/amxts.d.ts': staleCopy('amxts.d.ts'),
		'plugins/imports.d.ts': '// GENERATED by amxts prepare: what the plugins use without an import - the\n',
	};
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}

	expect(upgradeProject(dir, { write: false }).removed).toEqual(['amxts.d.ts', 'constants.ts', 'facade.ts', 'fs.ts', 'imports.d.ts']);
	expect(existsSync(join(dir, 'plugins/constants.ts'))).toBe(true);

	const { changes, removed } = upgradeProject(dir);
	expect(changes.map(change => `${change.file}:${change.line} ${change.to}`)).toEqual([
		'plugins/myplugin.ts:1 @amxts/core',
		'plugins/myplugin.ts:2 @amxts/core/constants',
	]);
	expect(removed).toEqual(['amxts.d.ts', 'constants.ts', 'facade.ts', 'fs.ts', 'imports.d.ts']);
	expect(readdirSync(join(dir, 'plugins'))).toEqual(['myplugin.ts']);

	const server = await setup({ rootDir: dir });
	expect(server.native('my_slots')).toBe(64);

	// An author's file of such a name, without the core's first line, stays.
	writeFileSync(join(dir, 'plugins/hooks.ts'), 'export function my_hook(): number {\n\treturn 7;\n}\n');
	expect(upgradeProject(dir).removed).toEqual([]);
	expect(existsSync(join(dir, 'plugins/hooks.ts'))).toBe(true);
});

test('a project in the server\'s addons/amxts keeps the API the module writes into its plugins', () => {
	const dir = join(tmpdir(), 'amxts-upgrade-in-server', 'cstrike', 'addons', 'amxts');
	rmSync(dirname(dirname(dirname(dir))), { recursive: true, force: true });
	made.push(dirname(dirname(dirname(dir))));
	mkdirSync(join(dir, 'plugins'), { recursive: true });
	writeFileSync(join(dir, 'amxts.config.ts'), 'export default defineConfig({ modules: [] });\n');
	writeFileSync(join(dir, 'plugins/constants.ts'), readFileSync(join(CORE_PLUGINS, 'constants.ts'), 'utf8'));
	expect(upgradeProject(dir).removed).toEqual([]);
	expect(existsSync(join(dir, 'plugins/constants.ts'))).toBe(true);
});

test('a menu\'s function is rewritten before the names in its body: the player it took is a Player', () => {
	const dir = join(tmpdir(), 'amxts-upgrade-menu-names');
	rmSync(dir, { recursive: true, force: true });
	made.push(dir);
	const files: Record<string, string> = {
		'package.json': '{ "name": "myserver", "private": true }\n',
		'amxts.config.ts': 'export default defineConfig({ modules: [] });\n',
		'plugins/shop.ts': [
			'const shop = menus.create("SHOP", { title: (player) => `$${player.account}` });',
			'shop.addItem((player) => `Money ${player.account}`, { enabled: (player) => player.account >= 100 });',
			'',
		].join('\n'),
	};
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}

	expect(upgradeProject(dir).left).toEqual([]);
	expect(readFileSync(join(dir, 'plugins/shop.ts'), 'utf8')).toBe([
		'const shop = menus.create("SHOP", { title: ({ player }) => `$${player.money}` });',
		'shop.addItem({ title: ({ player }) => `Money ${player.money}`, enabled: ({ player }) => player.money >= 100 });',
		'',
	].join('\n'));
});

test('a command handler takes one object - but one of the player, in place or by name, for a command without arguments; one that reads the words is left', () => {
	const source = [
		'server.addCommand("/hp <what>", (player) => print(player, "hp"));',
		'server.addCommand("/hi [who]", player => print(player, "hi"));',
		'server.addCommand<MeArgs>("/me", async (who: Player) => print(who, "me"));',
		'server.addCommand("/rules", showRules);',
		'server.addCommand("/give", (player, args) => print(player, args[0]));',
		'server.addCommand("/new", ({ player }) => print(player, "new"));',
		'server.addServerCommand("myplugin_reset", () => reset());',
		'server.addServerCommand("myplugin_set", (args) => set(args[0]));',
		'server.addCommand("/top", (player, args) => print(player, "top"));',
		'server.addCommand(["/cp", "cp"], (player) => print(player, "cp"));',
		'function showRules(player: Player) {}',
		'',
	].join('\n');
	const { text, changes, left } = upgradeHandlers('plugins/a.ts', source);

	expect(text.split('\n').slice(0, 10)).toEqual([
		'server.addCommand("/hp <what>", ({ player }) => print(player, "hp"));',
		'server.addCommand("/hi [who]", ({ player }) => print(player, "hi"));',
		'server.addCommand<MeArgs>("/me", async ({ player: who }) => print(who, "me"));',
		'server.addCommand("/rules", showRules);',
		'server.addCommand("/give", (player, args) => print(player, args[0]));',
		'server.addCommand("/new", ({ player }) => print(player, "new"));',
		'server.addServerCommand("myplugin_reset", () => reset());',
		'server.addServerCommand("myplugin_set", (args) => set(args[0]));',
		'server.addCommand("/top", ({ player }) => print(player, "top"));',
		'server.addCommand(["/cp", "cp"], (player) => print(player, "cp"));',
	]);
	expect(changes.map(change => `${change.line} ${change.from} -> ${change.to}`)).toEqual(['1 player -> { player }', '2 player -> ({ player })', '3 who: Player -> { player: who }', '9 player, args -> { player }']);
	expect(left.map(each => each.line)).toEqual([5, 8]);
	expect(upgradeHandlers('plugins/a.ts', text).changes).toEqual([]);
});

test('an import of fetch from @amxts/core/http goes - fetch is a global - and the file is listed to read its response anew', () => {
	const source = [
		'import { fetch, Response } from "@amxts/core/http";',
		'import { fetch as get } from "~/modules/http";',
		'const text = "@amxts/core/http";',
		'',
	].join('\n');
	const { text, changes, left } = dropHttpImports('plugins/a.ts', source);

	expect(text).toBe('const text = "@amxts/core/http";\n');
	expect(changes.map(change => `${change.line} ${change.from} -> ${change.to}`)).toEqual(['1 @amxts/core/http -> fetch, a global', '2 ~/modules/http -> fetch, a global']);
	expect(left.map(each => each.line)).toEqual([1]);
	expect(left[0].why).toContain('await response.text()');
	expect(dropHttpImports('plugins/a.ts', text)).toEqual({ text, changes: [], left: [] });
});

test('Player.all is server.players and a filter; a player\'s account is his money; the round and money events by their new names', () => {
	const source = [
		'import type { AddAccountEvent } from "@amxts/core";',
		'const everyone = Player.all();',
		'const cts = Player.all({ alive: true, team: "CT", humans: false });',
		'const dead = Player.all({ dead: true, bots: true }).length;',
		'const some = Player.all(options);',
		'const later = Player.all;',
		'game.addEventListener("addAccount", (event: AddAccountEvent) => print(event.player, `${event.player.account}`));',
		'game.addEventListener("restartRound", () => {});',
		'game.removeEventListener(\'onRoundFreezeEnd\', reset);',
		'server.addCommand("/money", ({ player }) => print(player, `${player.account}`));',
		'server.addCommand("/pay", (player, args) => print(player, `${player.account} ${args[0]}`));',
		'for (const each of Player.all()) each.account = 0;',
		'Player.all().filter(one => one.account > 0).forEach(one => { one.account -= 1; });',
		'function pay(who: Player | null, bank: Bank) { if (who) who.account += bank.account; }',
		'const rich = everyone.find(one => one.account > 9000)?.account;',
		'const text = "Player.all() and addAccount";',
		'',
	].join('\n');
	const { text, changes, left } = upgradeNames('plugins/a.ts', source);

	expect(text.split('\n')).toEqual([
		'import type { AddMoneyEvent } from "@amxts/core";',
		'const everyone = server.players;',
		'const cts = server.players.filter(player => player.isAlive && player.team === "CT");',
		'const dead = server.players.filter(player => !player.isAlive && player.isBot).length;',
		'const some = Player.all(options);',
		'const later = Player.all;',
		'game.addEventListener("addMoney", (event: AddMoneyEvent) => print(event.player, `${event.player.money}`));',
		'game.addEventListener("newRound", () => {});',
		'game.removeEventListener(\'roundStart\', reset);',
		'server.addCommand("/money", ({ player }) => print(player, `${player.money}`));',
		'server.addCommand("/pay", (player, args) => print(player, `${player.money} ${args[0]}`));',
		'for (const each of server.players) each.money = 0;',
		'server.players.filter(one => one.money > 0).forEach(one => { one.money -= 1; });',
		'function pay(who: Player | null, bank: Bank) { if (who) who.money += bank.account; }',
		'const rich = everyone.find(one => one.money > 9000)?.money;',
		'const text = "Player.all() and addAccount";',
		'',
	]);
	expect(changes).toHaveLength(19);
	expect(left.map(each => each.line)).toEqual([5, 6, 14]);
	expect(left[2].why).toContain('`money` on a Player');
	expect(upgradeNames('plugins/a.ts', text).changes).toEqual([]);
});

test('Player.all\'s filter takes a name that hides none the code has: player, other, p', () => {
	const source = [
		'const alive = Player.all({ alive: true });',
		'server.addCommand("/alive", ({ player }) => print(player, `${Player.all({ alive: true }).length}`));',
		'server.addCommand("/cts", (player) => {',
		'\tconst other = player;',
		'\treturn Player.all({ team: "CT" }).filter(one => one !== other);',
		'});',
		'',
	].join('\n');
	const { text } = upgradeNames('plugins/a.ts', source);

	expect(text.split('\n')).toEqual([
		'const alive = server.players.filter(player => player.isAlive);',
		'server.addCommand("/alive", ({ player }) => print(player, `${server.players.filter(other => other.isAlive).length}`));',
		'server.addCommand("/cts", (player) => {',
		'\tconst other = player;',
		'\treturn server.players.filter(p => p.team === "CT").filter(one => one !== other);',
		'});',
		'',
	]);
	expect(upgradeNames('plugins/a.ts', text).changes).toEqual([]);
});

test('fields, methods and events in the engine\'s words are the player\'s; one out of the API is listed with its native', () => {
	const source = [
		'game.addEventListener("flPlayerFallDamage", (event: FlPlayerFallDamageEvent) => event.result / 2, true);',
		'game.addEventListener("alloc", () => {});',
		'if (game.freezePeriod) game.numCtWins = game.numCtWins + 1;',
		'const weapon = event.player.activeItem;',
		'if (weapon != null && !weapon.inReload) weapon.timeWeaponIdle = 1;',
		'for (const item of event.player.items) item.clientClip = 0;',
		'function arm(player: Player) { player.armorValue = 100; player.takeHealth(10, []); player.addPoints(1, false); }',
		'console.log(`${new Player(1).teamName} ${game.inCareerGame}`);',
		'const somebody = load();',
		'somebody.numCtWins = 0;',
		'menus.menu.title = "x";',
		'',
	].join('\n');
	const { text, changes, left } = upgradeNames('plugins/a.ts', source);

	expect(text.split('\n')).toEqual([
		'game.addEventListener("fallDamage", (event: FallDamageEvent) => event.result / 2, true);',
		'game.addEventListener("alloc", () => {});',
		'if (game.isFreezeTime) game.ctWins = game.ctWins + 1;',
		'const weapon = event.player.activeItem;',
		'if (weapon != null && !weapon.isReloading) weapon.nextIdle = 1;',
		'for (const item of event.player.items) item.clipSent = 0;',
		'function arm(player: Player) { player.armor = 100; player.heal(10, []); player.addFrags(1, false); }',
		'console.log(`${new Player(1).teamName} ${game.inCareerGame}`);',
		'const somebody = load();',
		'somebody.numCtWins = 0;',
		'menus.menu.title = "x";',
		'',
	]);
	expect(changes).toHaveLength(11);
	expect(left.map(each => `${each.line} ${each.why.split(':')[0]}`)).toEqual([
		'2 "alloc" is not in the API',
		'8 teamName is not in the API',
		'8 inCareerGame is not in the API',
		'10 numCtWins is `ctWins` on the game',
	]);
	expect(left[1].why).toContain('get_member(id, m_szTeamName)');
	expect(upgradeNames('plugins/a.ts', text).changes).toEqual([]);
});

test('a game message is heard through addMessageListener, by its name in the player\'s words; one the game does not have is listed', () => {
	const source = [
		'server.addEventListener("message:DeathMsg", (event) => {',
		'	if (event.headshot) console.log("headshot");',
		'});',
		'server.addEventListener(\'message:SayText\', onChat);',
		'server.removeEventListener("message:SayText", onChat);',
		'server.addEventListener("message:BotProgress", (event: ClientMessage) => console.log(event.args.length));',
		'server.addEventListener("putinserver", () => console.log("message:DeathMsg"));',
		'server.addEventListener("message:MyModMsg", () => {});',
		'// server.addEventListener("message:Money", ...)',
		'',
	].join('\n');
	const { text, changes, left } = upgradeMessages('plugins/a.ts', source);

	expect(text.split('\n')).toEqual([
		'server.addMessageListener("death", (event) => {',
		'	if (event.headshot) console.log("headshot");',
		'});',
		'server.addMessageListener(\'chat\', onChat);',
		'server.removeMessageListener("chat", onChat);',
		'server.addMessageListener("botProgress", (event: ClientMessage) => console.log(event.args.length));',
		'server.addEventListener("putinserver", () => console.log("message:DeathMsg"));',
		'server.addEventListener("message:MyModMsg", () => {});',
		'// server.addEventListener("message:Money", ...)',
		'',
	]);
	expect(changes.map(change => `${change.line} ${change.from} ${change.to}`)).toEqual([
		'1 addEventListener addMessageListener',
		'1 message:DeathMsg death',
		'4 addEventListener addMessageListener',
		'4 message:SayText chat',
		'5 removeEventListener removeMessageListener',
		'5 message:SayText chat',
		'6 addEventListener addMessageListener',
		'6 message:BotProgress botProgress',
	]);
	expect(left.map(each => each.line)).toEqual([8]);
	expect(left[0].why).toContain('"message:MyModMsg" is not a message the game has');
	expect(upgradeMessages('plugins/a.ts', text)).toEqual({ text, changes: [], left });
});

test('a server event is named in the author\'s words; one that is a game event is heard through game; cstrike\'s buying is listed', () => {
	const source = [
		'server.addEventListener("putinserver", (event) => print(event.player, "hi"));',
		'server.addEventListener("client_putinserver", greet);',
		'server.addEventListener("cfg", () => {});',
		'server.addEventListener("PreThink", ({ player }) => player.health++);',
		'server.removeEventListener("infochanged", onInfo);',
		'function onInfo(event: ClientInfochangedEvent) {}',
		'server.addEventListener("pfn_touch", (event) => {});',
		'server.addEventListener("CS_OnBuy", (event) => {});',
		'server.addEventListener("kill", (event) => {});',
		'game.addEventListener("kill", (event) => {});',
		'server.addEventListener("playerchange", (event) => {}, { field: "ghost" });',
		'other.addEventListener("putinserver", () => {});',
		'',
	].join('\n');
	const { text, changes, left } = upgradeEvents('plugins/a.ts', source);

	expect(text.split('\n')).toEqual([
		'server.addEventListener("putInServer", (event) => print(event.player, "hi"));',
		'server.addEventListener("putInServer", greet);',
		'server.addEventListener("pluginsLoaded", () => {});',
		'game.addEventListener("preThink", ({ player }) => player.health++);',
		'game.removeEventListener("userInfoChange", onInfo);',
		'function onInfo(event: UserInfoChangeEvent) {}',
		'game.addEventListener("touch", (event) => {});',
		'server.addEventListener("CS_OnBuy", (event) => {});',
		'server.addEventListener("suicide", (event) => {});',
		'game.addEventListener("kill", (event) => {});',
		'server.addEventListener("playerChange", (event) => {}, { field: "ghost" });',
		'other.addEventListener("putinserver", () => {});',
		'',
	]);
	expect(changes).toHaveLength(12);
	expect(left.map(each => `${each.line} ${each.why.slice(0, 40)}`)).toEqual([
		'7 a touch hands toucher and touched as ent',
		'8 "CS_OnBuy" is not a server event: a purc',
	]);
	expect(upgradeEvents('plugins/a.ts', text)).toEqual({ text, changes: [], left: [left[1]] });
});

test('an event\'s field in Pawn\'s words is the author\'s where the code says which event it is', () => {
	const source = [
		'game.addEventListener("buyAmmo", (event) => console.log(`${event.weapon_entity}`));',
		'game.addEventListener("traceAttack", ({ dir, tracehandle: trace }) => console.log(`${dir.x} ${trace}`));',
		'game.addEventListener("precacheModel", onModel);',
		'const onModel = (event) => console.log(event.string);',
		'function shot(event: ShootEvent) { return event.src; }',
		'server.addEventListener("CS_InternalCommand", (event) => console.log(event.cmd));',
		'game.addEventListener("spawn", (event) => console.log(event.string));',
		'const event = { dir: 1, string: "" };',
		'console.log(event.dir, event.string.length);',
		'function count(total: number) { return total.toString(); }',
		'',
	].join('\n');
	const { text, left } = upgradeEvents('plugins/a.ts', source);

	expect(text.split('\n')).toEqual([
		'game.addEventListener("buyAmmo", (event) => console.log(`${event.weapon}`));',
		'game.addEventListener("traceAttack", ({ direction: dir, trace }) => console.log(`${dir.x} ${trace}`));',
		'game.addEventListener("precacheModel", onModel);',
		'const onModel = (event) => console.log(event.file);',
		'function shot(event: ShootEvent) { return event.start; }',
		'server.addEventListener("internalCommand", (event) => console.log(event.command));',
		'game.addEventListener("spawn", (event) => console.log(event.string));',
		'const event = { dir: 1, string: "" };',
		'console.log(event.dir, event.string.length);',
		'function count(total: number) { return total.toString(); }',
		'',
	]);
	expect(left).toEqual([]);
	expect(upgradeEvents('plugins/a.ts', text).changes).toEqual([]);
});

test('a player\'s authid is his steamId, on a Player, a Client, the authorized event and a test\'s player', () => {
	const source = [
		'server.addCommand("/id", ({ player }) => print(player, player.authid));',
		'function remember(client: Client) { return client.authid; }',
		'server.addEventListener("authorized", (event) => console.log(event.authid));',
		'server.addEventListener("authorized", ({ player, authid }) => console.log(authid));',
		'function heard(event: ClientAuthorizedEvent) { return event.authid; }',
		'const alice = server.join("Alice", { team: "CT", authid: "STEAM_0:0:42" });',
		'const bob = server.join("Bob", { authid });',
		'const ban = { authid: "STEAM_0:0:7" };',
		'console.log(ban.authid, ["a", "b"].join(","));',
	].join('\n');
	const names = upgradeNames('plugins/a.ts', source);
	const { text } = upgradeEvents('plugins/a.ts', names.text);

	expect(text.split('\n')).toEqual([
		'server.addCommand("/id", ({ player }) => print(player, player.steamId));',
		'function remember(client: Client) { return client.steamId; }',
		'server.addEventListener("authorized", (event) => console.log(event.steamId));',
		'server.addEventListener("authorized", ({ player, steamId: authid }) => console.log(authid));',
		'function heard(event: ClientAuthorizedEvent) { return event.steamId; }',
		'const alice = server.join("Alice", { team: "CT", steamId: "STEAM_0:0:42" });',
		'const bob = server.join("Bob", { steamId: authid });',
		'const ban = { authid: "STEAM_0:0:7" };',
		'console.log(ban.authid, ["a", "b"].join(","));',
	]);
	expect(names.left).toEqual([]);
});

test('the game\'s look-alike messages are upgraded to the one name that hears them all', () => {
	const source = [
		'server.addEventListener("message:BarTime", onBar);',
		'server.addEventListener("message:BarTime2", onBar);',
		'server.addEventListener("message:SpecHealth2", onHealth);',
		'server.addEventListener("message:HudTextArgs", onHint);',
		'server.addEventListener("message:HudTextPro", onHint);',
	].join('\n');

	expect(upgradeMessages('plugins/a.ts', source).text.split('\n')).toEqual([
		'server.addMessageListener("progressBar", onBar);',
		'server.addMessageListener("progressBar", onBar);',
		'server.addMessageListener("spectatedHealth", onHealth);',
		'server.addMessageListener("hint", onHint);',
		'server.addMessageListener("hint", onHint);',
	]);
});

test('a menu-core item is one object, and every function of a menu takes the menu\'s context', () => {
	const source = [
		'const shop = menus.create("SHOP", { title: (player) => `Shop, ${player.name}`, activeWhen: player => player.isAlive });',
		'shop.addItem("Armor", { onSelect: buyArmor });',
		'shop.addItem((player) => `Heal (${player.health} HP)`, { visible: (player, target) => player.isAlive, onSelect: (player, target) => heal(player) });',
		'shop.addItem("Close", { action: "CLOSE_MENU" });',
		'shop.addFixedItem(7, "Back");',
		'shop.addItem("Helmet", {',
		'\tenabled: [{ when: (player) => player.armor < 100, message: (player) => `${player.armor}` }],',
		'\tonSelect: (player) => {',
		'\t\tplayer.armor = 100;',
		'\t},',
		'});',
		'shop.show(player, { target: bob.id });',
		'const core = new Menu("Core");',
		'core.addItem({ title: "Wave", onSelect: ({ player }) => heal(player) });',
		'player.addItem(knife);',
		'function buyArmor(player: Player) {}',
		'function heal(player: Player) {}',
	].join('\n');

	const { text, changes, left } = upgradeMenus('plugins/shop.ts', source);
	expect(text.split('\n')).toEqual([
		'const shop = menus.create("SHOP", { title: ({ player }) => `Shop, ${player.name}`, activeWhen: ({ player }) => player.isAlive });',
		'shop.addItem({ title: "Armor", onSelect: ({ player }) => buyArmor(player) });',
		'shop.addItem({ title: ({ player }) => `Heal (${player.health} HP)`, visible: ({ player }) => player.isAlive, onSelect: ({ player }) => heal(player) });',
		'shop.addItem({ title: "Close", action: "CLOSE_MENU" });',
		'shop.addFixedItem(7, { title: "Back" });',
		'shop.addItem({',
		'\ttitle: "Helmet",',
		'\tenabled: [{ when: ({ player }) => player.armor < 100, message: ({ player }) => `${player.armor}` }],',
		'\tonSelect: ({ player }) => {',
		'\t\tplayer.armor = 100;',
		'\t},',
		'});',
		'shop.show(player, { target: bob });',
		'const core = new Menu("Core");',
		'core.addItem({ title: "Wave", onSelect: ({ player }) => heal(player) });',
		'player.addItem(knife);',
		'function buyArmor(player: Player) {}',
		'function heal(player: Player) {}',
	]);
	expect(changes.length).toBe(14);
	expect(left).toEqual([]);
	expect(upgradeMenus('plugins/shop.ts', text)).toEqual({ text, changes: [], left: [] });
});

test('a target that was a number is the context\'s target where it was made a Player, its row where it was read as a number', () => {
	const source = [
		'const players = menus.create("LIST_PLAYERS", { title: "Who" });',
		'players.addFilter((row, viewer) => row.id != viewer.id, "Nobody");',
		'players.addItem(rowText, { onSelect: greet });',
		'players.addItem("Greet", { onSelect: (player, target) => print(new Player(target), `${player.name} says hello`) });',
		'players.addItem("Log", { onSelect: (player, target) => log(`${target}`) });',
		'function rowText(player: Player, target: number) { return new Player(target).name; }',
		'function greet(player: Player, target: number) {}',
	].join('\n');

	expect(upgradeMenus('plugins/players.ts', source).text.split('\n')).toEqual([
		'const players = menus.create("LIST_PLAYERS", { title: "Who" });',
		'players.addFilter(({ target: row, player: viewer }) => row.id != viewer.id, "Nobody");',
		'players.addItem({ title: ({ player, row }) => rowText(player, row), onSelect: ({ player, row }) => greet(player, row) });',
		'players.addItem({ title: "Greet", onSelect: ({ player, target }) => print(target, `${player.name} says hello`) });',
		'players.addItem({ title: "Log", onSelect: ({ row: target }) => log(`${target}`) });',
		'function rowText(player: Player, target: number) { return new Player(target).name; }',
		'function greet(player: Player, target: number) {}',
	]);
});

test('what menu files and Pawn plugins name takes the context too; a condition keeps its parameters; what upgrade cannot be sure of is listed', () => {
	const source = [
		'import * as m from "@amxts/menu-core";',
		'm.addAction("PICK", (player, target, name) => {',
		'\tchosen = `${player.name}:${name}`;',
		'});',
		'm.addPlaceholder("hp", player => `${player.health}`);',
		'm.addRestriction("VIP", (player, name, target) => target > 0);',
		'm.addActionCheck("SHOP", "", (player, menu, action) => menu == "SHOP");',
		'm.addCondition("ALIVE", (player) => player.isAlive);',
		'm.setListSource("LIST_X", rows);',
		'm.addAction("ELSE", fromElsewhere);',
		'm.runActions(player, "CLOSE_MENU");',
		'function rows(viewer: Player) {',
		'\treturn null;',
		'}',
	].join('\n');

	const { text, left } = upgradeMenus('plugins/names.ts', source);
	expect(text.split('\n').slice(1, 10)).toEqual([
		'm.addAction("PICK", ({ player, name }) => {',
		'\tchosen = `${player.name}:${name}`;',
		'});',
		'm.addPlaceholder("hp", ({ player }) => `${player.health}`);',
		'm.addRestriction("VIP", ({ row: target }) => target > 0);',
		'm.addActionCheck("SHOP", "", ({ menu }) => menu == "SHOP");',
		'm.addCondition("ALIVE", (player) => player.isAlive);',
		'm.setListSource("LIST_X", ({ player }) => rows(player));',
		'm.addAction("ELSE", fromElsewhere);',
	]);
	expect(left.map(each => each.line)).toEqual([7, 10, 11]);
	expect(left[0].why).toContain('read menu.name');
	expect(left[1].why).toContain('fromElsewhere is declared elsewhere');
	expect(left[2].why).toContain('menu.runActions');
	expect(upgradeMenus('plugins/names.ts', text).text).toBe(text);
});

test('a flag\'s name is lowerCamelCase where the code says it is one; the rest stays, what is not said is listed', () => {
	const source = [
		'import { given } from "./parts";',
		'player.hideHud = ["Money", "Timer"];',
		'player.hideHud.push("Flashlight");',
		'if (player.buttons.includes("Jump") && player.flags.includes("OnGround")) jump(player);',
		'player.hideHud = player.hideHud.filter(part => part != "Money");',
		'event.flags = event.flags.concat(["Bomb"]);',
		'bot.move({ forward: 250, buttons: ["Jump", "Duck"] });',
		'server.addCommand("/kick", kick, { access: "Kick" });',
		'player.screen.hideHud(["Money"]);',
		'if (player.access.includes("LevelA")) give(player);',
		'for (const state of weapon.weaponState) if (state == "UspSilenced") silenced = true;',
		'switch (player.buttons[0]) { case "Attack2": break; }',
		'const parts: HideHud[] = ["Crosshair"];',
		'const buttons = ["Use"];',
		'bot.move({ buttons });',
		'function press(player: Player, button: Button = "Reload") { return player.buttons.includes(button); }',
		'press(player, "Score");',
		'cmd("amxts_x", handler, "LEVEL_A");',
		'player.hideHud = given;',
		'const title = "Money";',
		'if (player.name == "Admin") server.join("Admin", { flags: "abc" });',
		'const access = player.access;',
		'const admin = access.length > 0 && !access.includes("User");',
	].join('\n');

	const { text, changes, left } = upgradeFlags('plugins/flags.ts', source);
	expect(text).toBe([
		'import { given } from "./parts";',
		'player.hideHud = ["money", "timer"];',
		'player.hideHud.push("flashlight");',
		'if (player.buttons.includes("jump") && player.flags.includes("onGround")) jump(player);',
		'player.hideHud = player.hideHud.filter(part => part != "money");',
		'event.flags = event.flags.concat(["bomb"]);',
		'bot.move({ forward: 250, buttons: ["jump", "duck"] });',
		'server.addCommand("/kick", kick, { access: "kick" });',
		'player.screen.hideHud(["money"]);',
		'if (player.access.includes("levelA")) give(player);',
		'for (const state of weapon.weaponState) if (state == "uspSilenced") silenced = true;',
		'switch (player.buttons[0]) { case "attack2": break; }',
		'const parts: HideHud[] = ["crosshair"];',
		'const buttons = ["use"];',
		'bot.move({ buttons });',
		'function press(player: Player, button: Button = "reload") { return player.buttons.includes(button); }',
		'press(player, "score");',
		'cmd("amxts_x", handler, "levelA");',
		'player.hideHud = given;',
		'const title = "Money";',
		'if (player.name == "Admin") server.join("Admin", { flags: "abc" });',
		'const access = player.access;',
		'const admin = access.length > 0 && !access.includes("user");',
	].join('\n'));
	expect(changes).toHaveLength(20);
	expect(changes[0]).toEqual({ file: 'plugins/flags.ts', line: 2, from: 'Money', to: 'money' });
	expect(left.map(each => each.line)).toEqual([19]);
	expect(left[0].why).toContain('`given`');

	const again = upgradeFlags('plugins/flags.ts', text);
	expect(again.text).toBe(text);
	expect(again.changes).toEqual([]);
});

test('a file without flags is left as it is', () => {
	const source = 'const title = "Money";\nprint(player, "Jump");';
	expect(upgradeFlags('plugins/plain.ts', source)).toEqual({ text: source, changes: [], left: [] });
});

test('a death message\'s flags are lowerCamelCase too', () => {
	const source = 'game.addEventListener("sendDeathMessage", (event) => {\n\tif (event.rarity.includes("Headshot") && !event.rarity.includes("ThruSmoke")) event.flags = ["Position", "KillRarity"];\n});\n';
	const { text } = upgradeFlags('plugins/a.ts', source);
	expect(text).toBe('game.addEventListener("sendDeathMessage", (event) => {\n\tif (event.rarity.includes("headshot") && !event.rarity.includes("throughSmoke")) event.flags = ["position", "killRarity"];\n});\n');
	expect(upgradeFlags('plugins/a.ts', text).changes).toEqual([]);
});

test('calls of a changed shape: print to a player and to everyone, removeAllItems\'s suit, a Storage\'s missing value, give\'s cast, a model\'s file', () => {
	const imports = [
		'import type { ItemName } from "@amxts/core";',
		'import { type Player, type WeaponName, server } from "@amxts/core";',
	];
	// Every free print rewritten: its import goes; one left keeps it.
	const printed = 'import { print, server } from "@amxts/core";\nprint(0, "a");\nprint(player, "b");\n';
	expect(upgradeCalls('plugins/a.ts', printed).text).toBe('import { server } from "@amxts/core";\nserver.print("a");\nplayer.print("b");\n');
	expect(upgradeCalls('plugins/a.ts', `${printed}print(5, "c");\n`).text).toStartWith('import { print, server } from "@amxts/core";');
	// An import alone at the top goes with the blank line under it.
	expect(upgradeCalls('plugins/a.ts', 'import type { ItemName } from "@amxts/core";\n\nplayer.give("x" as ItemName);\n').text).toBe('player.give("x");\n');
	const source = [
		...imports,
		'const points = new Storage("myplugin_points");',
		'print(0, `Round ${round}`);',
		'print(0, "Go!", "center");',
		'print({ id: 0, variant: "center" }, "Go!");',
		'print({ id: player.id, variant: "center" }, "Done");',
		'print({ id: player.id, color: "red" }, "Odd");',
		'print(player, "Hi");',
		'print(event.player, "Hi", "center");',
		'print(player.id, "Hi");',
		'print(new Player(target), "Hi");',
		'print(killer ?? victim, "Hi");',
		'print(5, "Hi");',
		'player.removeAllItems(true);',
		'player.removeAllItems(false);',
		'player.removeAllItems(keepSuit);',
		'player.removeAllItems();',
		'const saved: string | null = points.get(player.steamId);',
		'if (saved == null) print(0, points.get("x") === null ? "none" : "some");',
		'player.give(<ItemName>name);',
		'player.give(name as WeaponName);',
		'server.vault("myplugin_points").set("STEAM_0:0:1", "6");',
		'player.viewModel = 0;',
		'if (weapon.weaponModel != 0) player.weaponModel = 5;',
		'',
	].join('\n');

	const { text, left } = upgradeCalls('plugins/a.ts', source);

	expect(text.split('\n')).toEqual([
		'import { type Player, server } from "@amxts/core";',
		'const points = new Storage("myplugin_points");',
		'server.print(`Round ${round}`);',
		'server.print("Go!", "center");',
		'server.print("Go!", "center");',
		'player.print("Done", "center");',
		'print({ id: player.id, color: "red" }, "Odd");',
		'player.print("Hi");',
		'event.player.print("Hi", "center");',
		'player.print("Hi");',
		'(new Player(target)).print("Hi");',
		'(killer ?? victim).print("Hi");',
		'print(5, "Hi");',
		'player.removeAllItems({ suit: true });',
		'player.removeAllItems();',
		'player.removeAllItems({ suit: keepSuit });',
		'player.removeAllItems();',
		'const saved: string | undefined = points.get(player.steamId);',
		'if (saved == undefined) server.print(points.get("x") === undefined ? "none" : "some");',
		'player.give(name);',
		'player.give(name);',
		'server.storage("myplugin_points").set("STEAM_0:0:1", "6");',
		'player.viewModel = "";',
		'if (weapon.weaponModel != "") player.weaponModel = 5;',
		'',
	]);
	expect(left.map(each => [each.line, each.why])).toEqual([
		[8, 'print takes a player now, and the place as its second argument: player.print(text, "center"); everyone is server.print(text, "center")'],
		[14, 'print takes a player now: `player.print(text)`'],
		[25, 'weaponModel is the model\'s file now, text: "models/v_knife.mdl"'],
	]);
	// A second run changes nothing.
	expect(upgradeCalls('plugins/a.ts', text).text).toBe(text);
});

test('calls 0.3 changed: cmd\'s info goes; a gone event, reapi\'s hook switches and a const string\'s cells are listed', () => {
	const source = [
		'cmd("myplugin_go", onGo, "all", "Starts it");',
		'cmdWide("myplugin_say", onSay, "all", "Says it");',
		'cmd("myplugin_stop", onStop);',
		'server.addEventListener("pause", () => {});',
		'DisableHookChain(handle);',
		'get_players(ids, count, cells("h"), cells(""));',
		'',
	].join('\n');
	const { text, left } = upgradeCalls('plugins/a.ts', source);
	expect(text.split('\n').slice(0, 3)).toEqual([
		'cmd("myplugin_go", onGo, "all");',
		'cmdWide("myplugin_say", onSay, "all");',
		'cmd("myplugin_stop", onStop);',
	]);
	expect(left.map(each => [each.line, each.why])).toEqual([
		[4, 'the server event "pause" is gone: AMX Mod X raises it for a Pawn plugin about itself alone - remove the listener'],
		[5, 'a hook() handle is the module\'s: take the hook off with unhook(handle), and hook() again to put it back'],
		[6, 'a raw native takes a const string as it is: "h", not cells("h")'],
		[6, 'a raw native takes a const string as it is: "", not cells("")'],
	]);
	expect(upgradeCalls('plugins/a.ts', text).text).toBe(text);
});
