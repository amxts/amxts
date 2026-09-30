/**
 * Regular expressions as JavaScript has them, each case checked against
 * JavaScript's own RegExp: test, exec, and String's match, matchAll,
 * replace, replaceAll, search and split with one.
 */
// @ts-ignore - bun:test types not available during type checking
import { beforeAll, expect, test } from 'bun:test';
import { probe } from './probe';

/** Pattern, flags, text: what each case matches. */
const cases: [string, string, string][] = [
	['abc', '', 'xxabcxx'],
	['a.c', '', 'abc a\nc'],
	['a.c', 's', 'a\nc'],
	['^\\d+$', '', '12345'],
	['^\\d+$', '', '123a'],
	['(\\w+)@(\\w+)\\.com', '', 'mail ann@site.com now'],
	['colou?r', 'g', 'color colour colouur'],
	['[a-c]+', 'i', 'xxABCabcd'],
	['[^a-z\\s]+', '', 'abc DEF 123'],
	['\\bcat\\b', 'g', 'cat concat cat.'],
	['(a|b|cd)+?x', '', 'abcdx'],
	['a{2,3}', 'g', 'a aa aaa aaaa'],
	['a{2,}', '', 'caaaaat'],
	['x{1}y', '', 'xxy'],
	['(\\w)\\1', '', 'hello'],
	['^(?:ab)*$', '', 'ababab'],
	['foo(?=bar)', '', 'foobaz foobar'],
	['foo(?!bar)', '', 'foobar foobaz'],
	['^line', 'gm', 'line1\nline2\nxline'],
	['(\\d+)-(\\d+)?', '', '10-'],
	['[\\d.]+', 'g', 'v1.2.3 and 4'],
	['\\s+', 'g', 'a  b\tc'],
	['(?:)', 'g', 'ab'],
	['Привет', 'i', 'привет мир'],
	['\\u0041\\x42', '', 'xAB'],
	['[\\]\\-]', 'g', 'a]b-c'],
	['a*', 'g', 'baaac'],
	['(a)|(b)', 'g', 'ab'],
	['<.+?>', 'g', '<a><bb>'],
	['<.+>', '', '<a><bb>'],
	['^$', '', ''],
	['\\d{2,4}?', 'g', '123456'],
	['\\Bo\\B', 'g', 'foo boo o'],
	['((a)|b)+', '', 'abab'],
	['(?:a|b)*c', '', 'ababababx'],
	['[а-я]+', 'gi', 'Привет, МИР'],
	['(\\w+)\\s(\\w+)', 'g', 'John Smith, Jane Doe'],
];

let run: (index: number) => string;

beforeAll(async () => {
	const list = cases.map(([pattern, flags, text]) => `[${JSON.stringify(pattern)}, ${JSON.stringify(flags)}, ${JSON.stringify(text)}]`).join(',\n\t');
	const { error, exports, string } = await probe({ 'probe.ts': `
const cases: string[][] = [
	${list}
];
function describe(found: RegExpExecArray | null): string {
	if (!found) return "null";
	return found.index.toString() + ":" + found.join("|");
}
export function run(index: i32): string {
	const [pattern, flags, text] = cases[index];
	const re = new RegExp(pattern, flags);
	let out = re.test(text) ? "T" : "F";
	re.lastIndex = 0;
	out += " exec " + describe(re.exec(text));
	re.lastIndex = 0;
	const matched = text.match(re);
	out += " match " + (matched ? matched.join("|") : "null");
	out += " search " + text.search(re).toString();
	out += " replace " + text.replace(re, "<$&>") + " " + text.replace(re, "$2-$1$$");
	out += " split " + text.split(re).join("|");
	if (re.global) {
		let all = "";
		for (const found of text.matchAll(re)) all += "[" + found.index.toString() + ":" + found[0] + "]";
		out += " all " + all;
	}
	return out;
}
` });
	if (error) throw new Error(error);
	run = index => string(exports.run(index));
});

/** The same, as JavaScript does it - an unmatched group reads as "", as it does in a plugin. */
function javascript([pattern, flags, text]: [string, string, string]): string {
	const re = new RegExp(pattern, flags);
	const describe = (found: RegExpExecArray | null) => found ? `${found.index}:${[...found].map(part => part ?? '').join('|')}` : 'null';
	let out = re.test(text) ? 'T' : 'F';
	re.lastIndex = 0;
	out += ` exec ${describe(re.exec(text))}`;
	re.lastIndex = 0;
	const matched = text.match(re);
	out += ` match ${matched ? [...matched].map(part => part ?? '').join('|') : 'null'}`;
	out += ` search ${text.search(re)}`;
	out += ` replace ${text.replace(re, '<$&>')} ${text.replace(re, '$2-$1$$')}`;
	out += ` split ${text.split(re).map(part => part ?? '').join('|')}`;
	if (re.global) out += ` all ${[...text.matchAll(re)].map(found => `[${found.index}:${found[0]}]`).join('')}`;
	return out;
}

for (const [index, item] of cases.entries()) {
	test(`/${item[0]}/${item[1]} on ${JSON.stringify(item[2])}`, () => {
		expect(run(index)).toBe(javascript(item));
	});
}

test('a literal, a replacer function, replaceAll, sticky, and a bad pattern', async () => {
	const { error, exports, string } = await probe({ 'probe.ts': `
export function text(): string {
	const tag = /\\[(\\w+)\\]/g;
	let out = "[a] b [cd]".replace(tag, (match, name) => name.toUpperCase());
	out += " " + "x1y22".replace(/\\d+/g, (digits) => (digits.length).toString());
	out += " " + "a-b-c".replaceAll(/-/g, "+");
	out += " " + /^!(\\w+)\\s*(.*)$/.exec("!kick bob now")!.join(",");
	const sticky = /a/y;
	out += " " + sticky.test("ba").toString() + sticky.lastIndex.toString();
	out += " " + tag.toString() + tag.flags + tag.source;
	try {
		new RegExp("(a");
	} catch (error) {
		out += " " + error.name;
	}
	return out;
}
` });
	expect(error).toBe('');
	expect(string(exports.text())).toBe('A b CD x1y2 a+b+c !kick bob now,kick,bob now false0 /\\[(\\w+)\\]/gg\\[(\\w+)\\] SyntaxError');
});
