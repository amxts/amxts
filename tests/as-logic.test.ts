import { resolve } from 'node:path';
/**
 * The facade's text logic - the colour tags of chat and menus - compiled and
 * run.
 *
 * This compiles AssemblyScript the way a plugin is compiled and runs it under
 * bun's WebAssembly, so the code under test is the code that ships. Every
 * `env` import is stubbed: the module declares hundreds of natives and none
 * of them is reached by a function that only looks at a string.
 */
// @ts-ignore - bun:test types not available during type checking
import { beforeAll, describe, expect, test } from 'bun:test';
import { ascMain } from '../scripts/asc';
import { playerFieldsBuild } from '../scripts/player-fields';
import { ascPath, sourcesFor } from '../scripts/project';

// The repository's tsconfig takes node's globals and nothing else, on purpose:
// the DOM library would bring a console this project does not use. WebAssembly
// lives in that library, and bun runs the real one either way.
declare const WebAssembly: any;

const root = resolve('as');

let exports: any;

// Player's fields that plugins add (scripts/player-fields.ts).
const playerFields = playerFieldsBuild();

// The modules by their package names, as scripts/project.ts reads them.
const sources = sourcesFor(root);

/** Reads a module the way scripts/compile.ts does, `~/` and all. */
function readFile(filename: string, baseDir: string): string | null {
	const path = ascPath(root, filename, baseDir);
	const text = sources.read(path);
	return text === null ? null : playerFields.read(path, text);
}

beforeAll(async () => {
	let binary: Uint8Array | undefined;

	const { error, stderr } = await ascMain(
		[
			'../tests/as/logic.ts',
			'--outFile',
			'logic.wasm',
			'--exportRuntime',
		],
		{
			readFile,
			// asc writes the text map as a string when asked for one; only the
			// binary is wanted here.
			writeFile(_: string, contents: string | Uint8Array) {
				if (typeof contents !== 'string') binary = contents;
			},
			listFiles: () => [],
			transforms: [playerFields.transform],
		},
	);

	if (error) throw new Error(stderr.toString());

	const module = new WebAssembly.Module(binary!);

	// One stub per import: the logic under test calls none of them, and a
	// missing import is a link error rather than a silent zero.
	const imports: Record<string, Record<string, (...args: number[]) => number>> = {};
	for (const { module: name, name: fn } of WebAssembly.Module.imports(module)) {
		(imports[name] ??= {})[fn] = () => 0;
	}

	// A dictionary that has every key but NO_* as itself: lang.translate's
	// line is the key it was given - the plugin's string in, UTF-8 bytes up
	// to a zero back into its buffer, and their count and hash in the eight
	// bytes before it, as the module's thunk crosses them (Frame::backText).
	imports.env.LookupLangKey = (out, size, key) => {
		const line = text(key);
		if (line.startsWith('NO_')) return 0;
		const bytes = new TextEncoder().encode(line).subarray(0, size);
		new Uint8Array(exports.memory.buffer).set([...bytes, 0], out);
		let hash = 0;
		let bits = 0;
		for (const byte of bytes) {
			hash = (Math.imul(hash, 31) + byte) >>> 0;
			bits |= byte;
		}
		const head = new DataView(exports.memory.buffer);
		head.setUint32(out - 8, (bytes.length | (bits >= 0x80 ? 0x80000000 : 0)) >>> 0, true);
		head.setUint32(out - 4, hash, true);
		return 1;
	};

	exports = new WebAssembly.Instance(module, imports).exports;
});

/**
 * A string in the module's memory, for a function that takes one.
 *
 * `--exportRuntime` gives an allocator and nothing that knows what a string
 * is, so the two conversions are here: AssemblyScript stores UTF-16 with its
 * byte length in the word before the data.
 */
function str(value: string): number {
	const pointer = exports.__new(value.length << 1, exports.STRING_ID.value);
	const memory = new Uint16Array(exports.memory.buffer);

	for (let i = 0; i < value.length; i++) {
		memory[(pointer >>> 1) + i] = value.charCodeAt(i);
	}

	return pointer;
}

function text(pointer: number): string {
	if (!pointer) return '';

	const header = new Uint32Array(exports.memory.buffer);
	const length = header[(pointer - 4) >>> 2] >>> 1;
	const memory = new Uint16Array(exports.memory.buffer);

	let out = '';
	for (let i = 0; i < length; i++) out += String.fromCharCode(memory[(pointer >>> 1) + i]);

	return out;
}

describe('the colour tags', () => {
	// The control bytes the client reads: 0x01 yellow, 0x03 the sender's team
	// colour, 0x04 green.
	test('become the bytes the client reads', () => {
		expect(text(exports.paint(str('!gGreen !yYellow'))))
			.toBe('\x04Green \x01Yellow');
	});

	test('leave a tag that is not one alone', () => {
		expect(text(exports.paint(str('!qnot a tag')))).toBe('!qnot a tag');
		expect(text(exports.paint(str('no tags at all')))).toBe('no tags at all');
	});

	// One letter, one colour, in chat and in menus alike: case matters.
	test('read a tag by its case', () => {
		expect(text(exports.paint(str('!Gnot green, !Ynot yellow')))).toBe('!Gnot green, !Ynot yellow');
	});

	test('drop a menu\'s tag from a chat line', () => {
		expect(text(exports.paint(str('!wWhite !RRight')))).toBe('White Right');
	});

	test('make !d grey, as in a menu', () => {
		exports.paint(str('!dGrey'));
		expect(text(exports.swapTeam.value)).toBe('SPECTATOR');
	});

	/**
	 * One team colour to a line, and the first tag decides it: red, blue, grey
	 * and !t are the same byte, and what differs is the team the recipient is
	 * told the sender is on - one swap per message.
	 */
	test('let the first colour decide the team swap', () => {
		exports.paint(str('!rRed first, !bBlue second'));
		expect(text(exports.swapTeam.value)).toBe('TERRORIST');

		exports.paint(str('!bBlue first, !rRed second'));
		expect(text(exports.swapTeam.value)).toBe('CT');

		exports.paint(str('!gGreen only'));
		expect(text(exports.swapTeam.value)).toBe('');
	});
});

describe('the menu colour tags', () => {
	test('become the codes the game draws', () => {
		expect(text(exports.menuColors(str('!y[1]!w Buy !R!d]!r5!d[')))).toBe(String.raw`\y[1]\w Buy \R\d]\r5\d[`);
	});

	test('drop chat\'s own tags', () => {
		expect(text(exports.menuColors(str('!gGreen !bBlue !tTeam')))).toBe('Green Blue Team');
	});

	test('drop the game\'s own codes written into the text: text is written with tags', () => {
		expect(text(exports.menuColors(str(String.raw`\yOld \r[1]\w and !ynew`)))).toBe(String.raw`Old [1] and \ynew`);
	});

	test('leave anything else alone', () => {
		expect(text(exports.menuColors(str(String.raw`!IS_ALIVE, !qx, \n and a\ b`)))).toBe(String.raw`!IS_ALIVE, !qx, \n and a\ b`);
	});
});

describe('Pawn\'s colour codes', () => {
	test('a menu\'s codes become the same letter\'s tags', () => {
		expect(text(exports.colorTags(str(String.raw`\d[\yChartulia\d] \r1.\w X \R\d`)))).toBe('!d[!yChartulia!d] !r1.!w X !R!d');
	});

	test('chat\'s bytes become tags: ^1 yellow, ^3 the team\'s, ^4 green', () => {
		expect(text(exports.colorTags(str('\x04[Log] \x01jumped \x03twice')))).toBe('!g[Log] !yjumped !ttwice');
	});

	test('anything else stays as written', () => {
		expect(text(exports.colorTags(str(String.raw`\t%s \g a\ b !y 100%`)))).toBe(String.raw`\t%s \g a\ b !y 100%`);
	});
});

describe('a dictionary line', () => {
	test('is filled from its arguments in order, a number read out of its text', () => {
		expect(text(exports.translateKey(str('%s #%d, %.2f%% and %s'), str('Bob'), str('3.9'), str('2.456')))).toBe('Bob #3, 2.46% and %s');
	});

	test('writes %f of a number past 32 bits whole, and a rounded-away minus not at all', () => {
		expect(text(exports.translateKey(str('%.0f %.2f %.1f'), str('5000000000'), str('-0.001'), str('-2.25')))).toBe('5000000000 0.00 -2.3');
	});

	test('keeps a placeholder the call passed no argument for as written', () => {
		expect(text(exports.translateKey(str('%s%s%s [%d] [%.1f] [%5s] %name%'), str('a'), str('b'), str('c')))).toBe('abc [%d] [%.1f] [%5s] %name%');
	});

	test('of a key no dictionary has is the key itself, as written', () => {
		expect(text(exports.translateKey(str(String.raw`NO_SUCH_KEY \y%s`), str('a'), str(''), str('')))).toBe(String.raw`NO_SUCH_KEY \y%s`);
	});

	test('takes a width, a zero pad and the left edge', () => {
		expect(text(exports.translateKey(str('[%02d] [%-4s] [%4s]'), str('7'), str('ab'), str('cd')))).toBe('[07] [ab  ] [  cd]');
	});

	test('gives its codes as tags, and leaves the arguments as they are', () => {
		expect(text(exports.translateKey(str(String.raw`\y%s\d [%s]`), str(String.raw`\rname`), str(''), str('')))).toBe(String.raw`!y\rname!d []`);
	});
});

describe('toFixed', () => {
	// value, places - each written as JavaScript itself writes it.
	const cases: [number, number][] = [
		[1.45, 1],
		[1.005, 2],
		[2.5, 0],
		[0.5, 0],
		[-1.5, 0],
		[-2.5, 0],
		[1e20, 2],
		[1e21, 2],
		[123.456, 10],
		[0.000001, 7],
		[Number.MAX_VALUE, 0],
		[-0, 2],
		[Number.NaN, 2],
		[Infinity, 2],
		[-Infinity, 0],
		[2.456, 2],
		[-0.004, 2],
		[5, 2],
		[26.7, 0],
		[-1.25, 1],
		[0.1, 20],
		[9.995, 2],
		[Number.MIN_VALUE, 100],
		[1.23e-10, 100],
		[0.3, 100],
		[999999999999999.9, 3],
		[4503599627370497, 0],
		// The places are an integer as JavaScript makes one: cut toward zero, NaN is 0.
		[1.456, 2.7],
		[1.5, Number.NaN],
		[1.5, -0.5],
	];

	test.each(cases)('(%p).toFixed(%p) is what JavaScript writes', (value: number, places: number) => {
		expect(text(exports.fixedText(value, places))).toBe(value.toFixed(places));
	});

	test.each([-Infinity, Infinity, 2 ** 32 + 2, 101, -1])('toFixed(%p) throws, as in JavaScript', (places: number) => {
		expect(() => (1).toFixed(places)).toThrow(RangeError);
		expect(() => exports.fixedText(1, places)).toThrow();
	});
});

describe('a second team colour in one line', () => {
	test('is the first one again, which is all the engine can do', () => {
		const line = text(exports.paint(str('!rRed !bBlue')));

		// Both are 0x03; only the swap says which colour that is.
		expect(line).toBe('Red Blue');
		expect(text(exports.swapTeam.value)).toBe('TERRORIST');
	});
});
