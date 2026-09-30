// The system the server runs on, the way Node's os module says it:
//
//   import { EOL } from "~/os";
//
//   fs.writeFileSync(path, lines.join(EOL) + EOL);
//   if (platform() == "win32") ...
//
// AMX Mod X does not say which system it is on, but the files a Pawn plugin
// writes in text mode ("wt") end their lines as that system does: "\r\n" on
// Windows, "\n" on Linux. A TypeScript plugin that writes a file a Pawn plugin
// also writes - a config, a log it appends to - keeps the file's line endings
// with EOL.
//
// Underneath: this plugin runs in the amxts module, which is amxts_amxx.dll on
// Windows, in AMX Mod X's modules folder. Being there says it is Windows.
import { existsSync } from "./fs";
import { get_localinfo } from "./natives";

/** The operating system's name as `platform()` gives it, with Node's names: one of `"win32"`, `"linux"`. */
export type Platform = "win32" | "linux";

/** Returns the operating system the server runs on, either `"win32"` or `"linux"`. */
export function platform(): Platform {
	const dir = get_localinfo("amxx_modulesdir");
	const modules = dir.length > 0 ? dir : "addons/amxmodx/modules";
	return existsSync(`${modules}/amxts_amxx.dll`) ? "win32" : "linux";
}

/** The line ending on this system, one of `"\r\n"` on Windows, `"\n"` on Linux. */
export const EOL = platform() == "win32" ? "\r\n" : "\n";
