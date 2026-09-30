// scripts/unzip.ts
// The files of a .zip, read with node:zlib: no unzip, tar or PowerShell to
// have on the machine, the same on Windows and Linux. Enough for a release
// archive - stored and deflated entries, no ZIP64, no encryption.
import { inflateRawSync } from 'node:zlib';

/** Every file in the archive, by its path inside it; folders are left out. */
export function unzip(zip: Uint8Array): Map<string, Uint8Array> {
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	// The end of central directory record: its signature, searched from the end
	// (a comment of up to 64 KB may follow it).
	let end = -1;
	for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xFFFF); at--) {
		if (view.getUint32(at, true) === 0x06054B50) {
			end = at;
			break;
		}
	}
	if (end < 0) throw new Error('not a zip archive');

	const count = view.getUint16(end + 10, true);
	let at = view.getUint32(end + 16, true);
	const files = new Map<string, Uint8Array>();
	const decoder = new TextDecoder();
	for (let i = 0; i < count; i++) {
		if (view.getUint32(at, true) !== 0x02014B50) throw new Error('a broken zip archive: its central directory');
		const method = view.getUint16(at + 10, true);
		const compressed = view.getUint32(at + 20, true);
		const nameLength = view.getUint16(at + 28, true);
		const extraLength = view.getUint16(at + 30, true);
		const commentLength = view.getUint16(at + 32, true);
		const local = view.getUint32(at + 42, true);
		const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
		at += 46 + nameLength + extraLength + commentLength;
		if (name.endsWith('/')) continue;

		if (view.getUint32(local, true) !== 0x04034B50) throw new Error(`a broken zip archive: ${name}`);
		const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
		const data = zip.subarray(start, start + compressed);
		if (method === 0) files.set(name, data);
		else if (method === 8) files.set(name, new Uint8Array(inflateRawSync(data)));
		else throw new Error(`${name}: compression method ${method} is not read`);
	}
	return files;
}
