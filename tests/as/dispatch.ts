// A fixture for tests/dispatch.test.ts: listeners that take themselves, the
// next one or an earlier one off, or add another, while their event is being
// dispatched - a game event, a server event, a message, a touch, a cvar's
// change and a forward, nested too - and the Player an event hands out.

// What the listeners of the game and server events do this time: "self",
// "next", "earlier" or "add".
let mode = "";
let added = false;

server.addServerCommand("dispatch_mode <mode>", ({ mode: next }) => {
	mode = next;
	added = false;
});

// A game event: resetMaxSpeed.

function resetA() {
	console.log("reset a");
	if (mode == "self") game.removeEventListener("resetMaxSpeed", resetA);
	if (mode == "next") game.removeEventListener("resetMaxSpeed", resetB);
	if (mode == "add" && !added) {
		added = true;
		game.addEventListener("resetMaxSpeed", resetD);
	}
}

function resetB() {
	console.log("reset b");
}

function resetC() {
	console.log("reset c");
	if (mode == "earlier") game.removeEventListener("resetMaxSpeed", resetA);
}

function resetD() {
	console.log("reset d");
}

server.addServerCommand("reset_on", () => {
	game.addEventListener("resetMaxSpeed", resetA);
	game.addEventListener("resetMaxSpeed", resetB);
	game.addEventListener("resetMaxSpeed", resetC);
});

server.addServerCommand("reset_off", () => {
	game.removeEventListener("resetMaxSpeed", resetA);
	game.removeEventListener("resetMaxSpeed", resetB);
	game.removeEventListener("resetMaxSpeed", resetC);
	game.removeEventListener("resetMaxSpeed", resetD);
});

// A server event: impulse.

function impulseA() {
	console.log("impulse a");
	if (mode == "self") server.removeEventListener("impulse", impulseA);
	if (mode == "next") server.removeEventListener("impulse", impulseB);
	if (mode == "add" && !added) {
		added = true;
		server.addEventListener("impulse", impulseD);
	}
}

function impulseB() {
	console.log("impulse b");
}

function impulseC() {
	console.log("impulse c");
	if (mode == "earlier") server.removeEventListener("impulse", impulseA);
}

function impulseD() {
	console.log("impulse d");
}

server.addServerCommand("impulse_on", () => {
	server.addEventListener("impulse", impulseA);
	server.addEventListener("impulse", impulseB);
	server.addEventListener("impulse", impulseC);
});

server.addServerCommand("impulse_off", () => {
	server.removeEventListener("impulse", impulseA);
	server.removeEventListener("impulse", impulseB);
	server.removeEventListener("impulse", impulseC);
	server.removeEventListener("impulse", impulseD);
});

// A message, a touch and a cvar's change: the first listener takes itself
// and the next off.

function deathA() {
	console.log("death a");
	server.removeMessageListener("death", deathA);
	server.removeMessageListener("death", deathB);
}

function deathB() {
	console.log("death b");
}

function deathC() {
	console.log("death c");
}

server.addMessageListener("death", deathA);
server.addMessageListener("death", deathB);
server.addMessageListener("death", deathC);

function touchA() {
	console.log("touch a");
	game.removeEventListener("touch", touchA, { toucher: "player" });
	game.removeEventListener("touch", touchB, { toucher: "player" });
}

function touchB() {
	console.log("touch b");
}

function touchC() {
	console.log("touch c");
}

game.addEventListener("touch", touchA, { toucher: "player" });
game.addEventListener("touch", touchB, { toucher: "player" });
game.addEventListener("touch", touchC, { toucher: "player" });

const knob = new Cvar("dispatch_knob", "0");

function knobA() {
	console.log("knob a");
	knob.removeEventListener("change", knobA);
	knob.removeEventListener("change", knobB);
}

function knobB() {
	console.log("knob b");
}

function knobC() {
	console.log("knob c");
}

knob.addEventListener("change", knobA);
knob.addEventListener("change", knobB);
knob.addEventListener("change", knobC);

// A forward emitted again inside its own dispatch: the inner dispatch takes
// the outer one's next handler off, which the outer one then skips.
const nested = new Forward<number>("dispatch_nested");

function nestedA(depth: number) {
	console.log(`nested a ${depth}`);
	if (depth == 0) nested.emit(1);
}

function nestedB(depth: number) {
	console.log(`nested b ${depth}`);
	if (depth == 1) nested.unsubscribe(nestedC);
}

function nestedC(depth: number) {
	console.log(`nested c ${depth}`);
}

nested.subscribe(nestedA);
nested.subscribe(nestedB);
nested.subscribe(nestedC);

server.addServerCommand("nested_emit", () => {
	nested.emit(0);
});

// The Player an event hands out: the same object for the same player,
// a new one for the next player in his slot.
let kept: Player | null = null;

function keep(event: ClientImpulseEvent) {
	const player = event.player;
	const before = kept;
	if (before != null) console.log(`same player: ${before == player}, same id: ${before.id == player.id}`);
	kept = player;
}

server.addServerCommand("players_on", () => {
	server.addEventListener("impulse", keep);
});

// A game event a listener keeps: the next dispatch hands out the same object,
// which reads the call that runs then.
let keptReset: ResetMaxSpeedEvent | null = null;

function keepReset(event: ResetMaxSpeedEvent) {
	const before = keptReset;
	if (before != null) console.log(`kept event: same: ${before == event}, player ${before.player.id}`);
	keptReset = event;
}

server.addServerCommand("keep_on", () => {
	game.addEventListener("resetMaxSpeed", keepReset);
});

// A server event a listener keeps: the next call hands out the same object,
// which reads the call that runs then.
let keptImpulse: ClientImpulseEvent | null = null;

function keepImpulse(event: ClientImpulseEvent) {
	const before = keptImpulse;
	if (before != null) console.log(`kept impulse: same: ${before == event}, impulse ${before.impulse}`);
	keptImpulse = event;
}

server.addServerCommand("keep_impulse_on", () => {
	server.addEventListener("impulse", keepImpulse);
});

server.addServerCommand("keep_impulse_off", () => {
	server.removeEventListener("impulse", keepImpulse);
	keptImpulse = null;
});

// An async listener reads its event after the call: the event keeps its values.
async function waitImpulse(event: ClientImpulseEvent) {
	await sleep(100);
	console.log(`waited impulse ${event.impulse}, player ${event.player.id}`);
}

server.addServerCommand("wait_impulse_on", () => {
	server.addEventListener("impulse", waitImpulse);
});

server.addServerCommand("wait_impulse_off", () => {
	server.removeEventListener("impulse", waitImpulse);
});

// A listener that writes a field keeps the value, and the next call hands out another event.
let written: ClientImpulseEvent | null = null;

function writeImpulse(event: ClientImpulseEvent) {
	const before = written;
	if (before != null) console.log(`written impulse: same: ${before == event}, before ${before.impulse}, now ${event.impulse}`);
	if (event.impulse == 100) event.impulse = 7;
	written = event;
}

server.addServerCommand("write_impulse_on", () => {
	server.addEventListener("impulse", writeImpulse);
});

server.addServerCommand("write_impulse_off", () => {
	server.removeEventListener("impulse", writeImpulse);
	written = null;
});
