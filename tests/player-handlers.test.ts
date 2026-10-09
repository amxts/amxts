/**
 * A handler typed `Context & Player`: a function of the player - in place,
 * `(player: Player)`, or by its name - is handed the context's player; one of
 * the context, `({ player, name })` or `(context) => context.player`, gets the
 * context. In a call, and as a value of a `Record<string, V>` literal.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { probe } from './probe';

test('a function of the player or of the context, where either is declared', async () => {
	const { error, exports } = await probe({ 'probe.ts': `
class Player { constructor(public id: i32) {} }
class Ctx { constructor(public player: Player, public name: string) {} }
type Action = (context: Ctx & Player) => void;
type Text = (context: Ctx & Player) => string;
let total = 0;
const actions = new Map<string, Action>();
function addAction(name: string, run: Action): void { actions.set(name, run); }
function addActions(list: Record<string, Action>): void { for (const key of Object.keys(list)) actions.set(key, list[key]); }
let label: Text = ({ name }) => name;
function setLabel(text: Text): void { label = text; }
function checkpoint(player: Player): void { total += player.id; }
function nameOf(player: Player): string { return "p" + player.id.toString(); }
export function run(): i32 {
	const k = 100;
	addAction("A", checkpoint);
	addAction("B", (player) => { total += player.id * k; });
	addAction("C", ({ player, name }) => { total += player.id * 1000 + name.length; });
	addAction("D", (context) => { total += context.player.id * 10000; });
	addAction("E", (player: Player) => { total += player.id * 100000; });
	addActions({ F: checkpoint, G: (player) => { total += player.id * 1000000; } });
	const c = new Ctx(new Player(1), "xy");
	for (const key of ["A", "B", "C", "D", "E", "F", "G"]) actions.get(key)(c);
	setLabel(nameOf);
	const one = label(c);
	setLabel((player) => "q" + player.id.toString());
	return total + (label(c) == "q1" && one == "p1" ? 10000000 : 0);
}
` });
	expect(error).toBe('');
	expect(exports.run()).toBe(1 + 100 + 1002 + 10000 + 100000 + 1 + 1000000 + 10000000);
});
