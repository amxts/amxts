import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { evalInt, IncludeParser } from '../src/parser/include-parser';

test('a multi-tag {Float,_}:value does not leak into the parameter name', () => {
	const parsed = new IncludeParser('native foo({Float,_}:value);').parse();

	expect(parsed.natives[0].params[0]).toMatchObject({ name: 'value', type: 'Float' });
});

test('a const scalar parameter is read-only, not an array', () => {
	const parsed = new IncludeParser('native foo(const index);').parse();

	expect(parsed.natives[0].params[0]).toMatchObject({ isConst: true, isArray: false });
});

test('a const array parameter is both const and an array', () => {
	const parsed = new IncludeParser('native foo(const message[]);').parse();

	expect(parsed.natives[0].params[0]).toMatchObject({ isConst: true, isArray: true });
});

test('a fixed-size array parameter records its size', () => {
	const parsed = new IncludeParser('native foo(origin[3]);').parse();

	expect(parsed.natives[0].params[0].arraySize).toBe('3');
});

test('a trailing ... parameter is marked as rest', () => {
	const parsed = new IncludeParser('native foo(a, ...);').parse();
	const params = parsed.natives[0].params;

	expect(params[params.length - 1].isRest).toBe(true);
});

test('a parameter default naming a constant is carried through unevaluated', () => {
	const parsed = new IncludeParser('native foo(vol = VOL_NORM);').parse();

	expect(parsed.natives[0].params[0].defaultValue).toBe('VOL_NORM');
});

test('a #define with a tab after it is a constant too, as message_const.inc writes MSG_ONE', () => {
	const parsed = new IncludeParser('#define\tMSG_ONE                     1        // Reliable to one (msg_entity)').parse();

	expect(parsed.constants.map(c => c.name)).toEqual(['MSG_ONE']);
});

test('a function-like macro is expanded into a plain #define value', () => {
	const src = `
#define BIT(%0) (1<<(%0))
#define SF_X BIT(3)
`;
	const parsed = new IncludeParser(src).parse();
	const sfX = parsed.constants.find(c => c.name === 'SF_X');

	expect(sfX?.value).toBe('(1<<(3))');
});

test('macro expansion also reaches enum member values', () => {
	const src = `
#define WRAP(%0) (%0 * 2)
enum E {
	A = WRAP(5),
};
`;
	const parsed = new IncludeParser(src).parse();
	const a = parsed.enums[0].members.find(m => m.name === 'A');

	expect(a?.value).toBe('(5 * 2)');
});

test('collectMacrosFrom shares macros across a Map passed to two parsers', () => {
	const macros = new Map();

	// reapi.inc declares the macro...
	new IncludeParser('#define BEGIN_FUNC_REGION(%0) (%0 + 1)', macros).parse();

	// ...and reapi_gamedll_const.inc uses it, with only the shared table in common.
	const b = new IncludeParser('#define USES_REGION BEGIN_FUNC_REGION(7)', macros).parse();
	const usesRegion = b.constants.find(c => c.name === 'USES_REGION');

	expect(usesRegion?.value).toBe('(7 + 1)');
});

test('enum members with no explicit value auto-increment from 0', () => {
	const src = `
enum E {
	A,
	B,
	C
};
`;
	const parsed = new IncludeParser(src).parse();
	const values = parsed.enums[0].members.map(m => m.value);

	expect(values).toEqual(['0', '1', '2']);
});

test('auto-increment continues from an arithmetic member value, not from zero', () => {
	// reapi numbers its hookchains in regions: RG_GetForceCamera is
	// BEGIN_FUNC_REGION(gamedll) == (1024 * 1), and the members after it are
	// 1025, 1026... Restarting the count here made hook() register an unrelated
	// hookchain for roughly 140 of the 164 hooks.
	const src = `
enum E {
	A = (1024 * 1),
	B,
	C
};
`;
	const parsed = new IncludeParser(src).parse();
	const values = parsed.enums[0].members.map(m => m.value);

	expect(values).toEqual(['(1024 * 1)', '1025', '1026']);
});

test('auto-increment continues from a bitshift member value', () => {
	const src = `
enum E {
	A = 1<<3,
	B
};
`;
	const parsed = new IncludeParser(src).parse();
	const values = parsed.enums[0].members.map(m => m.value);

	expect(values).toEqual(['1<<3', '9']);
});

test('an enum with (<<= 1) doubles each next member, as amxconst.inc numbers its flags', () => {
	const src = readFileSync(new URL('../amxmodx/base/include/amxconst.inc', import.meta.url), 'utf8');
	const enums = new IncludeParser(src).parse().enums;
	const values = (name: string) => enums.find(e => e.name === name)?.members.map(m => evalInt(m.value ?? ''));

	expect(values('SetTaskFlags')).toEqual([0, 1, 2, 4, 8]);
	expect(values('GetPlayersFlags')).toEqual([0, 1, 2, 4, 8, 16, 32, 64, 128, 256]);
});

test('an enum with (+= n) or (*= n) steps by n', () => {
	const src = `
enum Add (+= 5) { A, B, C };
enum Mul (*= 3) { D = 1, E, F };
`;
	const members = new IncludeParser(src).parse().enums.flatMap(e => e.members.map(m => m.value));

	expect(members).toEqual(['0', '5', '10', '1', '3', '9']);
});

test('auto-increment stops guessing after a member value it cannot evaluate', () => {
	const src = `
enum E {
	A = SOME_UNRESOLVED_THING,
	B
};
`;
	const parsed = new IncludeParser(src).parse();
	const values = parsed.enums[0].members.map(m => m.value);

	expect(values).toEqual(['SOME_UNRESOLVED_THING', undefined]);
});

// An include a server has, as a project reads it for the forwards its plugins
// declare: a one-line enum after a multi-line one, then natives and forwards
// with no `};` line after it. The parser once went back to the first enum's end
// for ever, and a build grew by gigabytes a minute - so it runs in a process of
// its own here, killed after a few seconds.
const ONE_LINE_AFTER_BLOCK = `
enum BmSetting {
	BM_SET_WEAPON = 0,  // weapon selector
	BM_SET_NAME         // custom block name
};

// Maxspeed arbitration source.
enum BmSpeedSrc { BM_SPD_NONE = 0, BM_SPD_ICE, BM_SPD_HONEY, BM_SPD_BOOTS };

native myplugin_set_speed(id, BmSpeedSrc:src, Float:fSpeed);
forward myplugin_on_touch(id, iEntity, bool:bOnTop);
`;

test('a one-line enum ends at its brace, and the include after it is read once', () => {
	const script = [
		`import { IncludeParser } from ${JSON.stringify(fileURLToPath(new URL('../src/parser/include-parser.ts', import.meta.url)))};`,
		`const parsed = new IncludeParser(${JSON.stringify(ONE_LINE_AFTER_BLOCK)}).parse();`,
		'console.log(JSON.stringify(parsed));',
	].join('\n');
	const run = spawnSync(process.execPath, ['-e', script], { encoding: 'utf-8', timeout: 5000 });

	expect(run.signal).toBeNull();
	expect(run.status).toBe(0);
	const parsed = JSON.parse(run.stdout);
	expect(parsed.enums.map((e: any) => e.name)).toEqual(['BmSetting', 'BmSpeedSrc']);
	expect(parsed.enums[1].members.map((m: any) => [m.name, m.value])).toEqual([
		['BM_SPD_NONE', '0'],
		['BM_SPD_ICE', '1'],
		['BM_SPD_HONEY', '2'],
		['BM_SPD_BOOTS', '3'],
	]);
	expect(parsed.natives.map((n: any) => n.name)).toEqual(['myplugin_set_speed']);
	expect(parsed.forwards.map((f: any) => f.name)).toEqual(['myplugin_on_touch']);
}, 15_000);

test('members after the brace and before the closing one are read', () => {
	const src = `
enum E { A = 4,
	B, C,
	D }
native after();
`;
	const parsed = new IncludeParser(src).parse();

	expect(parsed.enums[0].members.map(m => [m.name, m.value])).toEqual([['A', '4'], ['B', '5'], ['C', '6'], ['D', '7']]);
	expect(parsed.natives.map(n => n.name)).toEqual(['after']);
});

test('an enum with no closing brace is no enum, and what follows is still read', () => {
	const parsed = new IncludeParser('enum E {\n\tA,\nnative after();\n').parse();

	expect(parsed.enums).toEqual([]);
	expect(parsed.natives.map(n => n.name)).toEqual(['after']);
});

test('a comment after a member that runs on to the next lines adds no members', () => {
	// ns_const.inc's NSGameplay, whose comments read as members "entity", "but" and "determine".
	const src = `
enum NSGameplay
{
	NSGame_CantTell,		/**< It is too soon to tell (can't find avhgameplay
								 entity or it doesn't have private data) */

	NSGame_MarineVAlien,	/**< Marine vs Aliens (standard) gameplay */
	NSGame_Unknown,			/**< Can find the gameplay entity, but can't
								 determine gameplay type. */
};
`;
	const members = new IncludeParser(src).parse().enums[0].members.map(m => `${m.name}=${m.value}`);

	expect(members).toEqual(['NSGame_CantTell=0', 'NSGame_MarineVAlien=1', 'NSGame_Unknown=2']);
});
