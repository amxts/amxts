// A fixture for tests/player-fields.test.ts: a plugin that hears the fields
// other plugins - and Pawn - write, each listener with the field's own types.
import "./player-state";
import "./data-fields";

server.addEventListener("playerchange", (event) => {
	console.log(`ghost ${event.player.name}: ${event.previous} -> ${event.value}`);
}, { field: "ghost" });

server.addEventListener("playerchange", (event) => {
	console.log(`kills: ${event.previous + 1} -> ${event.value + 1}`);
}, { field: "kills" });

server.addEventListener("playerchange", onTag, { field: "tag" });

server.addEventListener("playerchange", (event) => {
	const seenBy = event.value.seenBy.map(other => other.name);
	console.log(`glow ${event.field}: ${event.previous.enabled} -> ${event.value.enabled}, seen by ${seenBy.join(",")}`);
}, { field: "glow" });

server.addEventListener("playerchange", (event) => {
	if (event.value == "default") console.log("enabled: back to default");
}, { field: "glow.enabled" });

server.addEventListener("playerchange", (event) => {
	console.log(`any: ${event.field}`);
});

server.addCommand("watch_stop", () => server.removeEventListener("playerchange", onTag, { field: "tag" }));

function onTag(event: PlayerChangeEvent<"tag">) {
	console.log(`tag: "${event.previous}" -> "${event.value}"`);
}
