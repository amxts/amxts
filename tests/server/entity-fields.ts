// Fields a plugin adds to Entity: what it writes reads back through another
// object of the same entity, an entity removed reads them as never written,
// and a player's go when he leaves.
import "@amxts/core";
import { Checks } from "@amxts/core/check";

declare module "@amxts/core" {
	interface Entity {
		testMark: "none" | "held";
		testSpeed: number;
	}
}

server.addServerCommand("amxts_test_entity_fields", run);

async function run() {
	const check = new Checks("entity-fields");

	const box = Entity.create("info_target");
	check.expect(box != null, "info_target is created").toBe(true);
	if (box == null) {
		check.done();
		return;
	}

	check.expect(box.testMark, "a field never written reads its first literal").toBe("none");
	box.testMark = "held";
	box.testSpeed = 250;
	const same = new Entity(box.id);
	check.expect(same.testMark, "a union field reads back").toBe("held");
	check.expect(same.testSpeed, "a number field reads back").toBe(250);

	box.remove();
	await sleep(200);
	check.expect(same.testSpeed, "an entity removed reads its fields as never written").toBe(0);

	const bot = server.addBot("amxts fields");
	check.expect(bot != null, "a bot to keep a field on").toBe(true);
	if (bot != null) {
		bot.testSpeed = 1.5;
		check.expect(bot.testSpeed, "a player has the entity's fields").toBe(1.5);
		const slot = bot.id;
		bot.kick();
		await sleep(300);
		const left = new Entity(slot);
		check.expect(left.testSpeed, "a player's fields go when he leaves").toBe(0);
	}

	check.done();
}
