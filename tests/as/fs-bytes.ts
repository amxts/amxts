// A fixture for tests/fs-bytes.test.ts: files as bytes, and an archive
// extracted into the game folder.
import * as fs from "@amxts/core/fs";

interface CopyArgs {
	from: string;
	to: string;
}

interface UnzipArgs {
	archive: string;
}

server.addCommand<CopyArgs>("fsb_copy <from> <to>", ({ player, from, to }) => copy(player, from, to));
server.addCommand<UnzipArgs>("fsb_extract <archive>", ({ player, archive }) => unpack(player, archive));
server.addCommand("fsb_outside", ({ player }) => outside(player));

function copy(player: Player, from: string, to: string) {
	const bytes = fs.readBytesSync(from);
	if (bytes == null) {
		print(player, "no file", "console");
		return;
	}

	const written = fs.writeFileSync(to, bytes);
	const appended = fs.appendFileSync(to, bytes.buffer);
	print(player, `${bytes.length} ${written} ${appended}`, "console");
}

function unpack(player: Player, archive: string) {
	const bytes = fs.readBytesSync(archive);
	if (bytes == null) return;

	try {
		const entries = fs.extract(bytes);
		for (const entry of entries) {
			const folder = entry.path.substring(0, entry.path.lastIndexOf("/"));
			if (folder.length > 0) fs.mkdirSync(folder, { recursive: true });
			fs.writeFileSync(entry.path, entry.data);
		}
		print(player, entries.map(entry => `${entry.path}:${entry.data.length}`).join(","), "console");
	} catch (error) {
		print(player, error.message, "console");
	}
}

function outside(player: Player) {
	const written = fs.writeFileSync("../outside.bin", new Uint8Array(1));
	const read = fs.readBytesSync("/etc/passwd");
	print(player, `${written} ${read == null}`, "console");
}
