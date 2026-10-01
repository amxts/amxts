// The game events reapi alone delivers - ReGameDLL's and ReHLDS's own
// functions, which no stock module hooks - and the build's refusal of a
// listener for one in a project for plain HLDS.
//
// A server without reapi hears every other game event through Ham Sandwich
// (as/hooks.ts picks it once, by hasModule); a listener for one of these is
// only a line in its console. A project whose amxts.config.ts says
// `target: "hlds"` has said there is no reapi, so the build stops at such a
// listener instead, with the file and the line.
import { join } from 'node:path';
// @ts-ignore - shipped as JavaScript, with types beside it we do not need here
import * as asc from '../runtime/deps/assemblyscript/dist/assemblyscript.js';
import { CORE_PLUGINS } from './project';
import { readFileSync } from './tracked-fs';

let cached: { text: string; events: Set<string> } | null = null;

/**
 * The events of as/hooks.ts's GameEventMap reapi alone delivers: an event
 * class with no Ham Sandwich function behind it (`private static readonly
 * ham`) is a hookchain's alone.
 */
export function reapiEvents(hooksText = readFileSync(join(CORE_PLUGINS, 'hooks.ts'), 'utf8')): Set<string> {
	if (cached?.text === hooksText) return cached.events;

	const reapiClasses = new Set<string>();
	for (const [, name, body] of hooksText.matchAll(/^export class (\w+) extends HookEvent \{\n([\s\S]*?)\n\}\n/gm)) {
		if (!body.includes('private static readonly ham:')) reapiClasses.add(name);
	}
	const map = hooksText.slice(hooksText.indexOf('export interface GameEventMap'));
	const events = new Set<string>();
	for (const [, event, name] of map.slice(0, map.indexOf('\n}\n')).matchAll(/^\t(\w+): (\w+);/gm)) {
		if (reapiClasses.has(name)) events.add(event);
	}

	cached = { text: hooksText, events };
	return events;
}

/** The event a `game.addEventListener("name", ...)` call listens for; undefined for any other call. */
function gameEventOf(call: any): string | undefined {
	const callee = call.expression;
	if (callee.kind !== asc.NodeKind.PropertyAccess || callee.property.text !== 'addEventListener') return undefined;
	if (callee.expression.kind !== asc.NodeKind.Identifier || callee.expression.text !== 'game') return undefined;
	const type = call.args[0];
	return type?.kind === asc.NodeKind.Literal && type.literalKind === asc.LiteralKind.String ? type.value : undefined;
}

/** Calls `visit` on every node under `node`. */
function walk(node: any, visit: (node: any) => void) {
	if (Array.isArray(node)) {
		for (const each of node) walk(each, visit);
		return;
	}
	if (!node || typeof node !== 'object' || typeof node.kind !== 'number') return;
	visit(node);
	for (const key in node) {
		if (key !== 'range') walk(node[key], visit);
	}
}

/** The listeners for reapi's events in a compile's sources, each where it is written. */
export function reapiListeners(sources: any[], events = reapiEvents()): string[] {
	const found: string[] = [];
	for (const source of sources) {
		if (source.normalizedPath.startsWith('~lib/') || !source.text.includes('addEventListener')) continue;
		walk(source.statements, (node) => {
			if (node.kind !== asc.NodeKind.Call) return;
			const event = gameEventOf(node);
			if (event === undefined || !events.has(event)) return;
			const line = source.text.slice(0, node.range.start).split('\n').length;
			found.push(`${source.normalizedPath}:${line}: "${event}" needs ReAPI, and amxts.config.ts's target is "hlds" - plain HLDS has no ReAPI to deliver it. Listen for another event, or set target: "rehlds"`);
		});
	}
	return found;
}

/** The transform that stops a plugin for plain HLDS at a listener reapi alone could call. */
function hldsTransform() {
	return class {
		afterParse(parser: any): void {
			const problems = reapiListeners(parser.sources);
			if (problems.length) throw new Error(problems.join('\n'));
		}
	};
}

/** What a project's target adds to a compile: for plain HLDS, the refusal of reapi's events. */
export function targetTransforms(target: string | undefined) {
	return target === 'hlds' ? [hldsTransform()] : [];
}
