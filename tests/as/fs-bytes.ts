// A fixture for tests/fs-bytes.test.ts: files as bytes, and an archive
// extracted into the game folder - at once, and on the module's worker
// thread.
import * as fs from "@amxts/core/fs";

interface CopyArgs {
	from: string;
	to: string;
}

interface UnzipArgs {
	archive: string;
}

interface FileArgs {
	file: string;
}

server.addCommand<CopyArgs>("fsb_copy <from> <to>", ({ player, from, to }) => copy(player, from, to));
server.addCommand<UnzipArgs>("fsb_extract <archive>", ({ player, archive }) => unpack(player, archive));
server.addCommand("fsb_outside", ({ player }) => outside(player));

function copy(player: Player, from: string, to: string) {
	const bytes = fs.readBytesSync(from);
	if (bytes == null) {
		player.print("no file", "console");
		return;
	}

	const written = fs.writeFileSync(to, bytes);
	const appended = fs.appendFileSync(to, bytes.buffer);
	player.print(`${bytes.length} ${written} ${appended}`, "console");
}

function unpack(player: Player, archive: string) {
	const bytes = fs.readBytesSync(archive);
	if (bytes == null) return;

	try {
		const entries = fs.extractSync(bytes);
		for (const entry of entries) {
			const folder = entry.path.substring(0, entry.path.lastIndexOf("/"));
			if (folder.length > 0) fs.mkdirSync(folder, { recursive: true });
			fs.writeFileSync(entry.path, entry.data);
		}
		player.print(entries.map(entry => `${entry.path}:${entry.data.length}`).join(","), "console");
	} catch (error) {
		player.print(error.message, "console");
	}
}

function outside(player: Player) {
	const written = fs.writeFileSync("../outside.bin", new Uint8Array(1));
	const read = fs.readBytesSync("/etc/passwd");
	player.print(`${written} ${read == null}`, "console");
}

server.addServerCommand<FileArgs>("fsb_extract_async <file>", async ({ file }) => {
	try {
		const entries = await fs.extract(await fs.readBytes(file));
		for (const entry of entries) {
			const folder = entry.path.substring(0, entry.path.lastIndexOf("/"));
			if (folder.length > 0) await fs.mkdir(folder, { recursive: true });
			await fs.writeFile(entry.path, entry.data);
		}
		console.log(entries.map(entry => `${entry.path}:${entry.data.length}`).join(","));
	} catch (error) {
		console.log(error.message);
	}
});

server.addServerCommand<FileArgs>("fsb_order <file>", async ({ file }) => {
	const one = new Uint8Array(1);
	one[0] = 1;
	const two = new Uint8Array(1);
	two[0] = 2;
	fs.writeFile(file, one);
	fs.appendFile(file, two);
	await fs.appendFile(file, one.buffer);
	console.log(`${(await fs.readBytes(file)).join(" ")}`);
	try {
		await fs.readBytes("../outside.bin");
	} catch (error) {
		console.log(error.message);
	}
});
