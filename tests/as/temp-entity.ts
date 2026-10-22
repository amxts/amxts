// A fixture for tests/temp-entity.test.ts: the game's temporary effects
// heard with what made them - a spray's decal is the spray can's, a
// player's own the player's - and a hidden player's decals kept from the
// players who hide others.

import { TE_DECAL } from "@amxts/core/constants";

const hidesOthers = new Set<number>();

server.addMessageListener("tempEntity", (event) => {
	const source = event.source;
	const maker = source == null ? 0 : source instanceof Player ? source.id : source.owner;
	console.log(`heard ${event.type} ${event.args.number(1)} from ${maker}, owner ${event.source?.owner ?? 0}`);
	if (event.type == TE_DECAL && maker != 0) event.recipients = server.players.filter(p => p.id == maker || !hidesOthers.has(p.id));
});

server.addCommand("hide", ({ player }) => {
	hidesOthers.add(player.id);
});
