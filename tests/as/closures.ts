// Тестовый плагин tests/closures.test.ts: обработчики, которые используют
// переменные вокруг себя - замыкания.

const greeting = "Welcome";

server.addEventListener("putinserver", (event) => {
	const player = event.player;
	setTimeout(() => print(player, `${greeting}, ${player.name}!`), 2000);
});

interface CountArgs {
	from?: number;
}

server.addCommand<CountArgs>("/count [from]", ({ player, from }) => countdown(player, from ?? 3));

function countdown(player: Player, from: number) {
	let left = from;
	const handle = setInterval(() => {
		print(player, `${left}`);
		if (--left == 0) clearInterval(handle);
	}, 1000);
}

// Each player of the loop gets a timer of his own, with his own name in it.
server.addCommand("/wave", () => {
	let order = 0;
	for (const player of server.players) {
		order++;
		const place = order;
		setTimeout(() => print(player, `${player.name} is #${place} of ${order}`), place * 100);
	}
});

// A counter the listener and the command share.
class Scoreboard {
	hits = 0;

	listen() {
		game.addEventListener("takeDamage", (event) => {
			this.hits++;
			if (event.damage > 50) event.preventDefault();
		});
		server.addCommand("/hits", ({ player }) => print(player, `${this.hits} hits`));
	}
}

new Scoreboard().listen();
