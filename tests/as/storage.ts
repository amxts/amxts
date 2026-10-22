// A fixture for tests/storage.test.ts: a Storage of text, and one of objects.

interface Profile {
	kills: number;
	title: string;
}

interface Visit {
	count: number;
	map?: string;
}

const names = new Storage("storage_names");
const profiles = new Storage<Profile>("storage_profiles");
const visits = new Storage<Visit>("storage_visits");

server.addCommand("storage_write", ({ player }) => {
	names.set("b", "Bob");
	names.set("a", "Alice");
	const mine = profiles.get(player.steamId) ?? { kills: 0, title: "rookie" };
	mine.kills++;
	profiles.set(player.steamId, mine);
});
server.addCommand("storage_read", ({ player }) => {
	const mine = profiles.get(player.steamId);
	const missing = names.get("nobody");
	player.print(`${names.keys().join(",")} ${names.size} ${missing === undefined} ${mine == null ? "none" : `${mine.title} ${mine.kills}`}`, "console");
});
server.addCommand("storage_prune", ({ player }) => {
	const removed = names.prune(new Date(Date.now() - 60 * 1000));
	const deleted = names.delete("a");
	player.print(`${removed} ${deleted} ${names.delete("a")}`, "console");
});
server.addCommand("storage_lengths", ({ player }) => {
	const lengths = names.keys().map(key => `${key}:${names.get(key)!.length}`);
	player.print(lengths.join(" "), "console");
});
server.addCommand("storage_bad", () => {
	new Storage("bad/name").set("key", "value");
});
server.addCommand("storage_old", ({ player }) => {
	const old = visits.get("old")!;
	let bad = "";
	try {
		visits.get("bad");
	} catch (error) {
		bad = (error as Error).message;
	}
	player.print(`${old.count} ${old.map ?? "none"} | ${bad}`, "console");
});
