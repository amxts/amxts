// A fixture for tests/timers.test.ts: a timer that arms itself again with no delay.

let fired = 0;

function again() {
	fired++;
	setTimeout(again, 0);
}

server.addCommand("chain_start", () => {
	setTimeout(again, 0);
});
server.addCommand("chain_count", ({ player }) => {
	player.print(`${fired}`, "console");
});
