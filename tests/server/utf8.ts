// Cyrillic reaches the server console as UTF-8, not as question marks. What
// is printed the plugin cannot see itself - the runner looks for the lines below in the log as they are.
//
// @log Привет, мир (console.log)
// @log Привет, мир (server_print)
import { contain, copy, server_print, strlen } from "@amxts/core/natives";
import * as fs from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";

const text = new Cvar("amxts_test_text", "");

server.addServerCommand("amxts_test_utf8", run);

function run() {
	const check = new Checks("utf8");

	console.log("Привет, мир (console.log)");
	server_print("Привет, мир (server_print)");

	check.expect("Привет".length, "a string's length in characters").toBe(6);

	text.value = "Ёлка и щука";
	check.expect(text.value, "the string went through a cvar and came back").toBe("Ёлка и щука");

	// A native gets the text whole, not the first 511 bytes.
	check.expect(strlen("я".repeat(1500)), "3000 bytes of Cyrillic reach the native").toBe(3000);
	check.expect(contain(`${"x".repeat(5000)}иголка`, "иголка"), "a needle after 5000 bytes is found").toBe(5000);

	// AMX Mod X reads 16383 bytes of a string: that much arrives, and more is
	// cut there, never inside a letter.
	check.expect(strlen("x".repeat(16383)), "16383 bytes reach the native").toBe(16383);
	check.expect(strlen("x".repeat(20000)), "a longer string is cut at 16383 bytes").toBe(16383);
	check.expect(strlen("я".repeat(9000)), "Cyrillic is cut before the letter that does not fit").toBe(16382);
	check.expect(strlen(""), "an empty string arrives empty").toBe(0);
	check.expect(strlen("a😀b"), "a letter outside the BMP is four bytes").toBe(6);
	check.expect(strlen(String.fromCharCode(0xD800)), "a lone surrogate is U+FFFD, three bytes").toBe(3);

	// Text a native fills comes back whole, up to its end.
	check.expect(copy("Ёлка и щука"), "Cyrillic comes back from a native").toBe("Ёлка и щука");
	check.expect(copy(""), "an empty string comes back empty").toBe("");
	check.expect(copy("a😀b"), "a letter outside the BMP comes back").toBe("a😀b");
	check.expect(copy("я".repeat(200)), "a native's text stops at the wrapper's 255 bytes, between letters").toBe("я".repeat(127));

	// A file's text and names cross natives the same way: more than one fputs
	// of text, with a surrogate pair where a piece ends. ASCII names, as the
	// system spells a file's name its own way; in the test's own folder,
	// which the runner removes.
	const dir = "addons/amxts/test/utf8/folder";
	const body = `${"щ".repeat(4095)}😀${"ж".repeat(5000)}`;
	check.expect(fs.mkdirSync(dir, { recursive: true }), "a folder is made").toBe(true);
	check.expect(fs.writeFileSync(`${dir}/text.txt`, body), "a Cyrillic text is written").toBe(true);
	check.expect(fs.readFileSync(`${dir}/text.txt`), "its text reads back as written").toBe(body);
	const names = fs.readdirSync(dir);
	check.expect(names != null && names.includes("text.txt"), "the folder lists the file").toBe(true);
	check.done();
}
