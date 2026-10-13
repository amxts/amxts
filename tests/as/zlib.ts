// A fixture for tests/zlib.test.ts: compression both ways, sync and on the
// module's worker thread.
import * as fs from "@amxts/core/fs";
import * as zlib from "@amxts/core/zlib";

interface FileArgs {
	file: string;
}

server.addServerCommand("zlib_round", async () => {
	const text = "hello hello hello hello hello";
	const gzipped = String.UTF8.decode(zlib.gunzipSync(zlib.gzipSync(text)).buffer);
	const deflated = String.UTF8.decode(zlib.inflateSync(zlib.deflateSync(text)).buffer);
	const raw = String.UTF8.decode(zlib.inflateRawSync(zlib.deflateRawSync(text)).buffer);
	console.log(`sync ${gzipped == text} ${deflated == text} ${raw == text}`);

	const later = String.UTF8.decode((await zlib.gunzip(await zlib.gzip(text))).buffer);
	const zlibLater = String.UTF8.decode((await zlib.inflate(await zlib.deflate(text))).buffer);
	const rawLater = String.UTF8.decode((await zlib.inflateRaw(await zlib.deflateRaw(text))).buffer);
	console.log(`async ${later == text} ${zlibLater == text} ${rawLater == text}`);
});

server.addServerCommand<FileArgs>("zlib_gunzip <file>", async ({ file }) => {
	const packed = fs.readBytesSync(file)!;
	console.log(`sync ${String.UTF8.decode(zlib.gunzipSync(packed).buffer)}`);
	console.log(`async ${String.UTF8.decode((await zlib.gunzip(packed.buffer)).buffer)}`);
});

server.addServerCommand<FileArgs>("zlib_gzip <file>", async ({ file }) => {
	await fs.writeFile(file, await zlib.gzip(fs.readBytesSync(file)!));
	console.log("written");
});

server.addServerCommand("zlib_broken", async () => {
	try {
		zlib.gunzipSync(new Uint8Array(10));
	} catch (error) {
		console.log(`sync ${error.message}`);
	}
	try {
		await zlib.inflate(new Uint8Array(10));
	} catch (error) {
		console.log(`async ${error.message}`);
	}
});
