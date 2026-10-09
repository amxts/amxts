// Files as bytes on a real server: the module's fs_read and fs_write, and
// unzip inflating with the module's zlib. The archive holds a deflated text
// and a stored file of bytes.
import * as fs from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";

const FOLDER = "addons/amxmodx/data";

/** amxts-zip/a.txt ("hello " 50 times, deflated) and amxts-zip/b.bin (0 1 2 255 0, stored). */
const ARCHIVE = [
	80, 75, 3, 4, 20, 0, 0, 0, 8, 0, 0, 0, 33, 0, 193, 72, 66, 89, 13, 0, 0, 0, 44, 1,
	0, 0, 15, 0, 0, 0, 97, 109, 120, 116, 115, 45, 122, 105, 112, 47, 97, 46, 116, 120, 116, 203, 72, 205,
	201, 201, 87, 200, 24, 37, 83, 9, 147, 0, 80, 75, 3, 4, 20, 0, 0, 0, 0, 0, 0, 0, 33, 0,
	100, 185, 62, 238, 5, 0, 0, 0, 5, 0, 0, 0, 15, 0, 0, 0, 97, 109, 120, 116, 115, 45, 122, 105,
	112, 47, 98, 46, 98, 105, 110, 0, 1, 2, 255, 0, 80, 75, 1, 2, 20, 0, 20, 0, 0, 0, 8, 0,
	0, 0, 33, 0, 193, 72, 66, 89, 13, 0, 0, 0, 44, 1, 0, 0, 15, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 128, 1, 0, 0, 0, 0, 97, 109, 120, 116, 115, 45, 122, 105, 112, 47, 97, 46, 116, 120,
	116, 80, 75, 1, 2, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 33, 0, 100, 185, 62, 238, 5, 0, 0,
	0, 5, 0, 0, 0, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 128, 1, 58, 0, 0, 0, 97,
	109, 120, 116, 115, 45, 122, 105, 112, 47, 98, 46, 98, 105, 110, 80, 75, 5, 6, 0, 0, 0, 0, 2, 0,
	2, 0, 122, 0, 0, 0, 108, 0, 0, 0, 0, 0,
];

server.addServerCommand("amxts_test_fs_bytes", run);

function run() {
	const check = new Checks("fs-bytes");
	const archive = new Uint8Array(ARCHIVE.length);
	ARCHIVE.forEach((byte, i) => archive[i] = byte);

	check.expect(fs.writeFileSync(`${FOLDER}/amxts.zip`, archive), "writeFileSync takes bytes").toBe(true);
	const back = fs.readBytesSync(`${FOLDER}/amxts.zip`);
	check.expect(back == null ? -1 : back.length, "readBytesSync reads them whole").toBe(ARCHIVE.length);
	check.expect(fs.appendFileSync(`${FOLDER}/amxts.zip`, archive.buffer), "appendFileSync takes an ArrayBuffer").toBe(true);
	check.expect(fs.statSync(`${FOLDER}/amxts.zip`)?.size ?? 0, "appended at the end").toBe(ARCHIVE.length * 2);

	const entries = fs.unzip(archive);
	check.expect(entries.map(entry => entry.path).join(","), "unzip lists the files").toBe("amxts-zip/a.txt,amxts-zip/b.bin");
	check.expect(`${entries[0].data.length} ${entries[0].data.slice(294).join(" ")}`, "a deflated file inflates").toBe("300 104 101 108 108 111 32");
	check.expect(entries[1].data.join(" "), "a stored file is as it was").toBe("0 1 2 255 0");

	check.expect(fs.writeFileSync("../amxts-outside.bin", archive), "a path out of the game folder is not written").toBe(false);
	check.expect(fs.readBytesSync("../hlds.exe") == null && fs.readBytesSync("/etc/passwd") == null, "nor read").toBe(true);
	fs.unlinkSync(`${FOLDER}/amxts.zip`);
	check.done();
}
