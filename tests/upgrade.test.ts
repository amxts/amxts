import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
// `amxts upgrade` (scripts/upgrade.ts): imports of the core's API by `~/`
// become imports by the package's name, a module package's place in the
// build's tree its name; the project's own files, strings and comments stay.
// @ts-ignore - bun:test types not available during type checking
import { afterEach, expect, test } from 'bun:test';
import { setProjectDir } from '../scripts/project';
import { dropHttpImports, renamesFor, upgradeHandlers, upgradeMessages, upgradeNames, upgradeProject, upgradeText } from '../scripts/upgrade';

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

	const { changes } = upgradeProject(dir);
	expect(changes.map(change => `${change.file}:${change.line} ${change.to}`)).toEqual([
		'plugins/modules/greeter.ts:1 @amxts/core/fs',
		'plugins/myplugin.ts:1 @amxts/core/natives',
		'test/fixtures/probe.ts:1 @amxts/core',
	]);
	expect(readFileSync(join(dir, 'plugins/myplugin.ts'), 'utf8')).toBe('import { user_slap } from "@amxts/core/natives";\nimport { twice } from "~/lib/twice";\n');
	// What the build wrote is not the project's code.
	expect(readFileSync(join(dir, 'dist/old.ts'), 'utf8')).toBe(files['dist/old.ts']);
	expect(upgradeProject(dir)).toEqual({ changes: [], left: [] });
});

test('a command handler takes one object: the player by name, a function by its name too; one that reads the words is left', () => {
	const source = [
		'server.addCommand("/hp", (player) => print(player, "hp"));',
		'server.addCommand("/hi", player => print(player, "hi"));',
		'server.addCommand("/me", async (who: Player) => print(who, "me"));',
		'server.addCommand("/rules", showRules);',
		'server.addCommand("/give", (player, args) => print(player, args[0]));',
		'server.addCommand("/new", ({ player }) => print(player, "new"));',
		'server.addServerCommand("myplugin_reset", () => reset());',
		'server.addServerCommand("myplugin_set", (args) => set(args[0]));',
		'server.addCommand("/top", (player, args) => print(player, "top"));',
		'function showRules(player: Player) {}',
		'',
	].join('\n');
	const { text, changes, left } = upgradeHandlers('plugins/a.ts', source);

	expect(text.split('\n').slice(0, 9)).toEqual([
		'server.addCommand("/hp", ({ player }) => print(player, "hp"));',
		'server.addCommand("/hi", ({ player }) => print(player, "hi"));',
		'server.addCommand("/me", async ({ player: who }) => print(who, "me"));',
		'server.addCommand("/rules", ({ player }) => showRules(player));',
		'server.addCommand("/give", (player, args) => print(player, args[0]));',
		'server.addCommand("/new", ({ player }) => print(player, "new"));',
		'server.addServerCommand("myplugin_reset", () => reset());',
		'server.addServerCommand("myplugin_set", (args) => set(args[0]));',
		'server.addCommand("/top", ({ player }) => print(player, "top"));',
	]);
	expect(changes.map(change => `${change.line} ${change.from} -> ${change.to}`)).toEqual(['1 player -> { player }', '2 player -> ({ player })', '3 who: Player -> { player: who }', '4 showRules -> ({ player }) => showRules(player)', '9 player, args -> { player }']);
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
