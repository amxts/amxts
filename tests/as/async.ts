// The fixture tests/async.test.ts runs under its own copy of the module's
// scheduler (tests/async-host.ts). Each export is one scenario; what it
// prints is what the test reads.

async function tick(name: string, ms: number) {
	console.log(`${name} start`);
	await sleep(ms);
	console.log(`${name} after ${ms}`);
	return ms * 2;
}

/** Two coroutines, the second finishing first; neither call waits. */
export function ordering(): void {
	tick("a", 200);
	tick("b", 100);
	console.log("sync end");
}

async function twice() {
	const doubled = await tick("inner", 50);
	console.log(`inner gave ${doubled}`);
	return `${doubled}!`;
}

/** An async function's value through await, and a chain of them. */
export function values(): void {
	twice().then(text => console.log(`then got ${text}`));
}

async function both() {
	const [first, second] = await Promise.all([tick("x", 30), tick("y", 10)]);
	console.log(`all: ${first} ${second}`);
	const fastest = await Promise.race([tick("slow", 40), tick("fast", 20)]);
	console.log(`race: ${fastest}`);
}

/** Promise.all in order of the list, Promise.race to the first. */
export function combinators(): void {
	both();
}

async function plainValues() {
	const five = await 5;
	const [slow, plain] = await Promise.all([tick("p", 10), 7]);
	let total = 0;
	for await (const value of [tick("q", 20), tick("r", 10)]) total += value;
	for await (const text of ["a", "b"]) console.log(`for await: ${text}`);
	const numbers = [1, 2, 3];
	const copied = await Promise.all(numbers);
	console.log(`plain: ${five} ${slow} ${plain} ${total} ${copied.length}`);
}

/** await of a value that is not a promise, Promise.all with one, for await over a list. */
export function plain(): void {
	plainValues();
}

async function fails(message: string) {
	await sleep(10);
	if (message.length > 0) return Promise.reject<number>(new Error(message));
	return 1;
}

async function passesOn() {
	const value = await fails("deep");
	console.log(`never here ${value}`);
}

/** reject -> .catch; an await of a rejection rejects the awaiting function too. */
export function rejections(): void {
	fails("caught").catch(error => console.log(`catch: ${error.message}`));
	passesOn().catch(error => console.log(`passed on: ${error.message}`));
}

async function refuses(message: string) {
	await sleep(5);
	if (message.length > 0) throw new RangeError(message);
	return 1;
}

async function refusesAtOnce() {
	throw new Error("at once");
}

async function awaitsRefusal() {
	const value = await refuses("awaited");
	console.log(`never here ${value}`);
}

/** throw in an async function rejects its promise with the error thrown. */
export function throws(): void {
	refuses("thrown").catch(error => console.log(`catch: ${error.name} ${error.message}`));
	refusesAtOnce().catch(error => console.log(`catch: ${error.message}`));
	awaitsRefusal().catch(error => console.log(`passed on: ${error.message}`));
}

function rejectedNow() {
	return Promise.reject<string>(new Error("ENOENT: gone"));
}

async function recovers() {
	const text = await rejectedNow().catch(error => `recovered: ${error.message}`);
	console.log(text);
	const late = await fails("later").catch(() => -1);
	console.log(`late: ${late}`);
}

/** .catch that answers with a value, awaited - on a promise rejected already and on a later one. */
export function recovery(): void {
	recovers();
}

/** Nobody catches: one line when the jobs run out. */
export function unhandled(): void {
	fails("nobody");
}

async function guarded(label: string) {
	try {
		const value = await fails(label);
		console.log(`guarded value ${value}`);
		return value;
	} catch (error) {
		console.log(`guarded caught ${error.message}`);
		return -1;
	} finally {
		console.log(`guarded finally ${label}`);
	}
}

async function throwsInside() {
	try {
		await sleep(5);
		throw new RangeError("inside");
	} catch (error) {
		console.log(`inside caught ${error.name} ${error.message}`);
	}
	try {
		await refuses("again");
	} catch (error) {
		console.log(`again caught ${error.message}`);
	}
	await sleep(5);
	throw new Error("after the tries");
}

/** try/catch/finally around await: a rejection reaches the catch, finally runs, a value returns. */
export function tryAwait(): void {
	guarded("").then(value => console.log(`first gave ${value}`));
	guarded("bad").then(value => console.log(`second gave ${value}`));
	throwsInside().catch(error => console.log(`rejected with ${error.message}`));
}

// A callback API wrapped in a Promise: the resolve is kept for later.
let answer: ((value?: string) => void) | null = null;

function ask() {
	return new Promise<string>((resolve) => {
		answer = resolve;
	});
}

async function waitForAnswer() {
	const said = await ask();
	console.log(`answered: ${said}`);
}

export function wrapped(): void {
	waitForAnswer();
	console.log("asked");
}

export function reply(): void {
	const resolve = answer;
	if (resolve) resolve("yes");
}

/** A sleep given up by its signal, and one by a timeout. */
export function aborts(): void {
	const controller = new AbortController();
	controller.signal.addEventListener("abort", event => console.log(`listener: ${event.type}`));
	sleep(1000, { signal: controller.signal })
		.then(() => console.log("slept anyway"))
		.catch(error => console.log(`sleep: ${error.name}`));
	controller.abort();

	sleep(1000, { signal: AbortSignal.timeout(50) }).catch(error => console.log(`timeout: ${error.name}`));
}

async function slowGreeting(player: Player) {
	console.log(`greeting ${player.id}`);
	await sleep(500);
	console.log(`still here ${player.id}`);
}

/** A coroutine started for a player ends quietly when that player leaves. */
export function forPlayer(): void {
	__co_ambient_player = 7;
	slowGreeting(new Player(7));
	__co_ambient_player = 0;
	slowGreeting(new Player(8));
}

// Objects held across an await survive a collection while parked.
class Box {
	constructor(public label: string) {}
}

async function holds() {
	const box = new Box(`kept ${40 + 2}`);
	const list = [new Box("one"), new Box("two")];
	await sleep(10);
	console.log(`${box.label} ${list[1].label}`);
}

export function survives(): void {
	holds();
	holds();
}

export function collect(): void {
	__collect();
	const junk: string[] = [];
	for (let i = 0; i < 2000; i++) junk.push(`garbage ${i}`);
	__collect();
}

// A named async function passed where a listener returning nothing goes.
const listeners: ((id: number) => void)[] = [];

async function listen(id: number) {
	await sleep(5);
	console.log(`listener ${id}`);
}

export function asListener(): void {
	listeners.push(listen);
	listeners.push(async (id) => {
		console.log(`arrow ${id} before`);
		await sleep(5);
		console.log(`arrow ${id} after`);
	});
	for (const listener of listeners) listener(3);
}

class Counter {
	count = 0;

	async add(amount: number) {
		await sleep(5);
		this.count += amount;
		return this.count;
	}
}

export function method(): void {
	const counter = new Counter();
	counter.add(2).then(total => console.log(`counter ${total}`));
}

async function crashes() {
	await sleep(5);
	unreachable();
}

export function trap(): void {
	crashes();
}

async function outOfRange() {
	await sleep(5);
	const list: string[] = [];
	console.log(list[3]);
}

/** An error the library throws in an async function rejects its promise with it. */
export function rangeError(): void {
	outOfRange().catch(error => console.log(`rejected: ${error.name}`));
}

// An async game listener: its answer counts if it gave one before its first await.
let fallMode = "";

game.addEventListener("fallDamage", async () => {
	if (fallMode == "") return;
	if (fallMode == "early") return 0;
	await sleep(10);
	console.log("late answer given");
	return 0;
});

export function answerEarly(): void {
	fallMode = "early";
}

export function answerLate(): void {
	fallMode = "late";
}

// Promise.all, allSettled, race and any over promises of different types.
async function named(name: string, ms: number) {
	await sleep(ms);
	return name;
}

async function mixedAll() {
	const [count, name] = await Promise.all([tick("n", 20), named("s", 10)]);
	console.log(`all mixed: ${count} ${name}`);
	const [value, _] = await Promise.all([named("v", 5), sleep(10)]);
	console.log(`all with a sleep: ${value}`);
	const same = await Promise.all([named("a", 5), named("b", 1)]);
	console.log(`all of one type: ${same.join(",")} (${same.length})`);
}

export function tuples(): void {
	mixedAll();
	Promise.all([fails("tuple"), named("never", 5)]).catch(error => console.log(`all rejected: ${error.message}`));
}

class Animal {
	constructor(public name: string) {}
}

class Dog extends Animal {}

class Cat extends Animal {}

async function dog(ms: number) {
	await sleep(ms);
	return new Dog("rex");
}

async function cat(ms: number) {
	await sleep(ms);
	return new Cat("tom");
}

async function box(ms: number) {
	await sleep(ms);
	return new Box("boxed");
}

async function races() {
	const first = await Promise.race([box(30), sleep(10)]);
	console.log(first ? `race: ${first.label}` : "race: timed out");
	const second = await Promise.race([box(5), sleep(20)]);
	console.log(second ? `race: ${second.label}` : "race: timed out");
	const pet = await Promise.race([cat(5), dog(10)]);
	console.log(`race of a base class: ${pet.name}`);
}

export function mixedRace(): void {
	races();
}

async function half(ms: number) {
	await sleep(ms);
	return ms / 2;
}

async function numberRaces() {
	const counted = [1, 2, 3];
	const first = await Promise.race([sleep(5).then(() => counted.length), half(10)]);
	const second = await Promise.race([sleep(20).then(() => counted.length), half(10)]);
	const any = await Promise.any([sleep(5).then(() => counted.length), half(10)]);
	console.log(`race of numbers: ${first} ${second} ${any}`);
}

/** A count (an integer underneath) and a number race as numbers. */
export function numberRace(): void {
	numberRaces();
}

async function settle() {
	const results = await Promise.allSettled([fails("no"), tick("yes", 5)]);
	for (const result of results) {
		console.log(result.status == "fulfilled" ? `settled: ${result.value}` : `settled: ${result.reason.message}`);
	}
	const [count, name] = await Promise.allSettled([fails("bad"), named("good", 5)]);
	console.log(`settled mixed: ${count.status} ${count.reason.message}, ${name.status} ${name.value}`);
}

export function settled(): void {
	settle();
}

async function firstFulfilled() {
	const value = await Promise.any([fails("a"), tick("won", 20)]);
	console.log(`any: ${value}`);
	const pet = await Promise.any([cat(15), dog(5)]);
	console.log(`any of a base class: ${pet.name}`);
}

export function anyOf(): void {
	firstFulfilled();
	Promise.any([fails("x"), fails("y")]).catch((error) => {
		const all = error as AggregateError;
		console.log(`any rejected: ${error.name} ${all.errors.length} ${all.errors[1].message}`);
	});
}

export function find(): void {
	const pets = [new Animal("a"), new Dog("rex"), new Dog("max")];
	const dog = pets.find(one => one.name.length == 3);
	const last = pets.findLast(one => one.name.length == 3);
	const none = pets.find(one => one.name == "none");
	if (!dog || !last) return;
	console.log(`find: ${dog.name} ${last.name} ${none ? "found" : "none"}`);
}

// Closures: an async arrow using the variables around it, a closure inside an
// async function using its locals across an await, one held only by the
// coroutine it runs as, and an executor whose resolve a later callback calls.
export function closureAwaits(): void {
	const name = "closure";
	let runs = 0;
	const run = async (ms: number) => {
		await sleep(ms);
		runs++;
		console.log(`${name} ${runs} after ${ms}`);
	};
	run(20);
	run(10);
}

async function counts(label: string) {
	let seen = 0;
	const note = () => {
		seen++;
		return `${label} ${seen}`;
	};
	console.log(note());
	await sleep(10);
	console.log(note());
}

export function awaitsAroundClosure(): void {
	counts("async local");
}

export function parkedClosure(): void {
	const box = new Box(`held ${7 * 6}`);
	const later = async () => {
		await sleep(10);
		console.log(box.label);
	};
	later();
}

export function executorClosure(): void {
	const label = "late";
	const promise = new Promise<string>((resolve) => {
		sleep(5).then(() => resolve(label));
	});
	promise.then(value => console.log(`resolved ${value}`));
}
