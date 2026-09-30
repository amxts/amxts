// Checks for the api-* plugins: each one exercises a piece of the plugin API
// on a live server and logs what it expected beside what it got.
//
//   const check = new Checks("api-async", player);
//   check.expect(`${response.status}`, "status").toBe("200");
//   check.expect(player.gravity, "gravity").toBeCloseTo(0.5);
//   check.done();
//
// Written like `expect` in bun:test and vitest, the second argument being
// vitest's message. Every line goes to the server console with the plugin's
// tag, so one grep of the log answers "does this part of the API work":
// `[api-async] ok ...` or `[api-async] FAIL ...`. The player who ran the check
// gets the total in chat.
//
// A check nobody ran in the game - a suite of `bun run test:server`, started
// over rcon - is made without a player, and its total goes to the log alone:
//
//   const check = new Checks("cvar");
import { Player, print } from "~/facade";

/**
 * Checks of one piece of the API on a live server. Each goes to the server
 * console with the tag, as `[tag] ok ...` or `[tag] FAIL ...`; the player
 * who ran them gets the total in chat.
 *
 * ```ts
 * const check = new Checks("api-async", player);
 * check.expect(player.gravity, "gravity").toBeCloseTo(0.5);
 * check.done();
 * ```
 */
export class Checks {
	/** The number of checks passed so far. */
	passed = 0;
	/** The number of checks failed so far. */
	failed = 0;

	constructor(
		/** The checks' tag: every log line starts with it, `[cvar]`. */
		public tag: string,
		/** The player who ran the checks, if any: the total is printed to him too. */
		public player?: Player,
	) {
		console.log(player != null ? `[${tag}] --- run by ${player.name}` : `[${tag}] --- run`);
	}

	/** Starts a check of a value; `what` names it in the log: `check.expect(player.gravity, "gravity")`. */
	expect<T>(got: T, what?: string) {
		return new Expectation<T>(this, got, what ?? "");
	}

	/** Prints the total, to the log and to the player. */
	done() {
		const line = `[${this.tag}] ${this.passed} ok, ${this.failed} failed`;
		console.log(line);
		if (this.player != null) print(this.player, line);
	}

	/** @hidden */
	record(what: string, ok: boolean, got: string, expected: string) {
		if (ok) {
			this.passed++;
			console.log(`[${this.tag}] ok   ${what}: ${got}`);
			return;
		}

		this.failed++;
		console.log(`[${this.tag}] FAIL ${what}: got ${got}, expected ${expected}`);
	}
}

/** One value under check, from `check.expect(...)`: `toBe` or `toBeCloseTo` logs the result. */
export class Expectation<T> {
	constructor(private checks: Checks, private got: T, private what: string) {}

	/** Checks the value equals `expected`: the same number, text or boolean. */
	toBe(expected: T) {
		this.checks.record(this.what, this.got == expected, `${this.got}`, `${expected}`);
	}

	/** Checks the number is within `0.001` of `expected`: a value the game stores comes back rounded (`0.5` as `0.49999`). */
	toBeCloseTo(expected: number) {
		const got = this.got as number;
		this.checks.record(this.what, Math.abs(got - expected) < 0.001, `${got}`, `${expected}`);
	}
}
