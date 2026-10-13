// Files as bytes on a real server: the module's fs_read and fs_write, extract
// inflating with the module's zlib, at once and on its worker thread, and
// compression both ways. The archive holds a deflated text and a stored file
// of bytes.
import * as fs from "@amxts/core/fs";
import * as zlib from "@amxts/core/zlib";
import { Checks } from "@amxts/core/check";

const FOLDER = "addons/amxmodx/data";

/** amxts-zip/a.txt ("hello " 50 times, deflated) and amxts-zip/b.bin (0 1 2 255 0, stored), in hex. */
const ARCHIVE = "504b030414000000080000002100c14842590d0000002c0100000f000000616d7874732d7a69702f612e747874cb48cdc9c957c8182553099300504b03041400000000000000210064b93eee05000000050000000f000000616d7874732d7a69702f622e62696e000102ff00504b0102140014000000080000002100c14842590d0000002c0100000f0000000000000000000000800100000000616d7874732d7a69702f612e747874504b010214001400000000000000210064b93eee05000000050000000f000000000000000000000080013a000000616d7874732d7a69702f622e62696e504b050600000000020002007a0000006c0000000000";

server.addServerCommand("amxts_test_fs_bytes", run);

let frames = 0;
server.addEventListener("frame", () => frames++);

async function run() {
	const check = new Checks("fs-bytes");
	const archive = new Uint8Array(ARCHIVE.length / 2);
	for (let i = 0; i < archive.length; i++) archive[i] = parseInt(ARCHIVE.substring(i * 2, i * 2 + 2), 16);

	check.expect(fs.writeFileSync(`${FOLDER}/amxts.zip`, archive), "writeFileSync takes bytes").toBe(true);
	const back = fs.readBytesSync(`${FOLDER}/amxts.zip`);
	check.expect(back == null ? -1 : back.length, "readBytesSync reads them whole").toBe(archive.length);
	check.expect(fs.appendFileSync(`${FOLDER}/amxts.zip`, archive.buffer), "appendFileSync takes an ArrayBuffer").toBe(true);
	check.expect(fs.statSync(`${FOLDER}/amxts.zip`)?.size ?? 0, "appended at the end").toBe(archive.length * 2);

	const entries = fs.extractSync(archive);
	check.expect(entries.map(entry => entry.path).join(","), "extract lists the files").toBe("amxts-zip/a.txt,amxts-zip/b.bin");
	check.expect(`${entries[0].data.length} ${entries[0].data.slice(294).join(" ")}`, "a deflated file inflates").toBe("300 104 101 108 108 111 32");
	check.expect(entries[1].data.join(" "), "a stored file is as it was").toBe("0 1 2 255 0");

	const later = await fs.extract(archive);
	check.expect(later.map(entry => `${entry.path}:${entry.data.length}`).join(","), "extract gives the same on the worker").toBe("amxts-zip/a.txt:300,amxts-zip/b.bin:5");
	const damaged = archive.slice(0);
	damaged[50] ^= 0xFF;
	let rejected = "";
	try {
		await fs.extract(damaged);
	} catch (error) {
		rejected = error.message;
	}
	check.expect(rejected, "a damaged archive rejects").toBe("extract: \"amxts-zip/a.txt\" is damaged");

	// 8 MB to compress: the frames go on while the worker does it.
	const big = new Uint8Array(8 * 1024 * 1024);
	for (let i = 0; i < big.length; i++) big[i] = <u8>((i * 7) ^ (i >> 10));
	const before = frames;
	const packed = await zlib.gzip(big);
	check.expect(frames > before, "the promise settles on a later frame").toBe(true);
	const unpacked = zlib.gunzipSync(packed);
	check.expect(unpacked.length == big.length && unpacked[12345] == big[12345] && unpacked[big.length - 1] == big[big.length - 1], "gzip goes both ways").toBe(true);
	check.expect((await zlib.inflateRaw(zlib.deflateRawSync("amxts"))).length, "raw deflate too").toBe(5);

	await fs.writeFile(`${FOLDER}/amxts-later.bin`, packed);
	await fs.appendFile(`${FOLDER}/amxts-later.bin`, packed.buffer);
	check.expect((await fs.readBytes(`${FOLDER}/amxts-later.bin`)).length, "bytes are written and read on the worker").toBe(packed.length * 2);
	fs.unlinkSync(`${FOLDER}/amxts-later.bin`);

	check.expect(fs.writeFileSync("../amxts-outside.bin", archive), "a path out of the game folder is not written").toBe(false);
	check.expect(fs.readBytesSync("../hlds.exe") == null && fs.readBytesSync("/etc/passwd") == null, "nor read").toBe(true);
	fs.unlinkSync(`${FOLDER}/amxts.zip`);

	// halflife.wad is valve/'s alone.
	check.expect(`${fs.existsSync("halflife.wad")} ${fs.existsSync("halflife.wad", { game: true })}`, "{ game: true } finds a file of the game's other folders").toBe("false true");
	check.done();
}
