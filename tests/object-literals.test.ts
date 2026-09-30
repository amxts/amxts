/**
 * Object literals and object types as TypeScript has them: a literal whose
 * values say their types needs no type of its own, `{ x: number }` written
 * in two files is one type, and a plain object of the same fields goes into
 * an interface of them. At the default optimization and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

async function compile(files: Record<string, string>, optimize: boolean) {
	const { error, exports, string } = await probe(files, optimize ? ['-O3'] : []);
	return { error, exports, text: () => (error ? '' : string(exports.text())) };
}

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('an object literal without a type: numbers, text, booleans, arrays, nested literals, new', async () => {
			const { error, text } = await compile({ 'probe.ts': `
class Weapon { constructor(public name: string) {} }
export function text(): string {
	const point = { x: 1, y: -2.5 };
	const config = { title: "Shop", enabled: true, tags: ["a", "b"], size: { w: 3, h: 4 }, weapon: new Weapon("ak47") };
	point.x += 10;
	return point.x.toString() + point.y.toString() + config.title + config.enabled.toString()
		+ config.tags.join("") + (config.size.w * config.size.h).toString() + config.weapon.name + JSON.stringify(point);
}
` }, optimize);
			expect(error).toBe('');
			expect(text()).toBe('11-2.5Shoptrueab12ak47{"x":11,"y":-2.5}');
		});

		test('an object type written in two files is one type', async () => {
			const { error, text } = await compile({
				'probe.ts': `
import { describe } from "./other";
export function text(): string {
	const here: { x: number; y: number } = { x: 1, y: 2 };
	return describe(here) + describe({ x: 3, y: 4 });
}
`,
				'other.ts': `
export function describe(point: { x: number; y: number }): string {
	return point.x.toString() + ":" + point.y.toString();
}
`,
			}, optimize);
			expect(error).toBe('');
			expect(text()).toBe('1:23:4');
		});

		test('a literal of the same fields goes into an interface of them, a variable of the literal too', async () => {
			const { error, text } = await compile({ 'probe.ts': `
interface Point { x: number; y: number }
function length(point: Point): number {
	return Math.sqrt(point.x * point.x + point.y * point.y);
}
export function text(): string {
	const corner = { x: 3, y: 4 };
	const points: Point[] = [corner];
	return length(corner).toString() + " " + points.length.toString();
}
` }, optimize);
			expect(error).toBe('');
			expect(text()).toBe('5 1');
		});

		test('an object literal of names, fields and calls has the type its values have', async () => {
			const { error, text } = await compile({ 'probe.ts': `
class Player { constructor(public name: string, public health: number) {} }
interface Who { name: string; hp: number }
function greet(who: Who): string { return who.name + who.hp.toString(); }
function describe(player: Player) {
	return { name: player.name, hp: player.health, alive: player.health > 0, tags: ["a"], count: 3 };
}
export function text(): string {
	const player = new Player("ann", 90);
	const who = { name: player.name, hp: player.health };
	const info = describe(player);
	const nested = { owner: who, label: player.name.toUpperCase() };
	return greet(who) + " " + info.name + info.hp.toString() + (info.alive ? "!" : "") + info.tags.length.toString() +
		(info.count / 2).toString() + " " + nested.owner.name + nested.label + " " + JSON.stringify(who);
}
` }, optimize);
			expect(error).toBe('');
			expect(text()).toBe('ann90 ann90!11.5 annANN {"name":"ann","hp":90}');
		});

		test('a literal of the same fields in another order goes into an interface too, and keeps its order', async () => {
			const { error, text } = await compile({ 'probe.ts': `
interface Point { x: number; y: number }
interface Named { x: number; y: number; label?: string }
function describe(point: Point): string {
	return point.x.toString() + "," + point.y.toString();
}
function labelOf(named: Named): string {
	return named.label ?? "none";
}
export function text(): string {
	const corner = { y: 4, x: 3 };
	const named = { label: "a", y: 2, x: 1 };
	return describe(corner) + " " + labelOf(named) + " " + JSON.stringify(corner) + " " + Object.keys(named).join("");
}
` }, optimize);
			expect(error).toBe('');
			expect(text()).toBe('3,4 a {"y":4,"x":3} labelyx');
		});

		test('a class that implements an interface of fields goes where the interface does', async () => {
			const { error, text } = await compile({ 'probe.ts': `
interface Point { x: number; y: number }
interface Named { label(): string }
class Spot implements Point, Named {
	z = 3;
	constructor(public x: number, public y: number) {}
	label(): string { return "spot"; }
}
function sum(point: Point): number { return point.x + point.y; }
function name(named: Named): string { return named.label(); }
export function text(): string {
	const spot = new Spot(1, 2);
	const points: Point[] = [spot, { x: 10, y: 20 }];
	return (sum(spot) + sum(points[1]) + spot.z).toString() + " " + name(spot) + " " + JSON.stringify(spot);
}
` }, optimize);
			expect(error).toBe('');
			expect(text()).toBe('36 spot {"x":1,"y":2,"z":3}');
		});

		test('a class that implements an interface of fields leaves its optional fields undefined', async () => {
			const { error, text } = await compile({ 'probe.ts': `
interface Options { level: number; tag?: number; loud?: boolean }
class Built implements Options { level = 1; constructor() {} }
class Plain implements Options { level = 2; }
export function text(): string {
	const built = new Built();
	const plain = new Plain();
	return \`\${built.tag} \${plain.tag} \${built.loud ?? true} \${built.level + plain.level}\`;
}
` }, optimize);
			expect(error).toBe('');
			expect(text()).toBe('undefined undefined true 3');
		});

		test('an interface of fields that extends another is built by a literal, and goes where the base does', async () => {
			const { error, text } = await compile({
				'shapes.ts': `
export interface Base { x: number }
`,
				'probe.ts': `
import { Base } from "./shapes";
interface Point extends Base { y: number }
interface Point3 extends Point { z: number }
function xOf(base: Base): number { return base.x; }
export function text(): string {
	const point: Point = { x: 1, y: 2 };
	const deep: Point3 = { x: 4, y: 5, z: 6 };
	return (point.y + deep.z + xOf(point) + xOf(deep)).toString();
}
`,
			}, optimize);
			expect(error).toBe('');
			expect(text()).toBe('13');
		});
	});
}
