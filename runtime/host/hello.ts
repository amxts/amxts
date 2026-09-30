// The example a server writes out on its first start, and a working plugin.
//
// Put a file like this in addons/amxts/plugins, name it in plugins.ini, and
// save: the server compiles it and loads it without a map change.

plugin({
	name: "Hello",
	version: "1.0.0",
	author: "you",
	description: "An example to edit",
});

server.addCommand("/hp", sayHp, { description: "Show health" });

// The event's type comes from its name: `event.player` is a Player. A listener
// is a closure, as in JavaScript: it may use the variables around it.
server.addEventListener("putinserver", (event) => {
	const player = event.player;

	console.log(`${player.name} connected`);
	print(0, `${player.name} joined`);
	print(player, "Welcome to the server!");
});

// Declared below what uses it, the way a TypeScript file reads.
function sayHp(player: Player) {
	print(player, `${player.name}, your HP: ${player.health}`);

	if (player.health < 50) {
		player.health = 100;
		print(player, "Health restored!", "center");
	}
}
