// A plugin's linear memory, read and written the ways the module does.
//
// Two kinds of text cross it. A Pawn string - what a native takes and fills -
// is one character per 32-bit cell, terminated by a zero cell. An
// AssemblyScript string - what the facade's own externals take, console.log's
// included - is UTF-16, with its length in bytes in the word before it.

const floatView = new Float32Array(1);
const intView = new Int32Array(floatView.buffer);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A float as the cell Pawn carries it in: its bit pattern. */
export function floatBits(value: number): number {
	floatView[0] = value;
	return intView[0];
}

/** The other way: a cell that holds a float. */
export function bitsFloat(cell: number): number {
	intView[0] = cell;
	return floatView[0];
}

/** How many of the bytes are whole UTF-8 characters: a last one cut short is left out. */
function wholeUtf8(bytes: Uint8Array): number {
	let lead = bytes.length;
	while (lead > 0 && (bytes[lead - 1] & 0xC0) === 0x80) lead--;
	if (lead === 0 || bytes[lead - 1] < 0xC0) return bytes.length;
	const size = bytes[lead - 1] >= 0xF0 ? 4 : bytes[lead - 1] >= 0xE0 ? 3 : 2;
	return bytes.length - (lead - 1) < size ? lead - 1 : bytes.length;
}

// The AMX heap the module passes text through (Frame::inText, outText):
// cells of the fake's own at addresses past any plugin's memory, which a
// native reads and writes as it does the plugin's.
const HEAP = 0x7F000000;
// The longest text that crosses, in bytes and its terminator (MAX_CROSSING_CELLS).
const CROSSING_CELLS = 16384;

/** How many of the bytes fit in `max` without cutting a UTF-8 character in two. */
export function utf8Fit(bytes: Uint8Array, max: number): number {
	let length = Math.min(bytes.length, max);
	while (length > 0 && length < bytes.length && (bytes[length] & 0xC0) === 0x80) length--;
	return length;
}

export class Memory {
	private dataView?: DataView;
	private heap = new Int32Array(1 << 18);
	private heapTop = 0;

	constructor(private exports: any) {}

	// memory.grow detaches the old buffer, so the view follows the current one.
	private get view(): DataView {
		const buffer = this.exports.memory.buffer;
		if (!this.dataView || this.dataView.buffer !== buffer) this.dataView = new DataView(buffer);
		return this.dataView;
	}

	cell(pointer: number): number {
		return pointer >= HEAP ? this.heap[(pointer - HEAP) >> 2] : this.view.getInt32(pointer, true);
	}

	byte(pointer: number): number {
		return this.view.getUint8(pointer);
	}

	setCell(pointer: number, value: number): void {
		if (pointer >= HEAP) this.heap[(pointer - HEAP) >> 2] = value | 0;
		else this.view.setInt32(pointer, value | 0, true);
	}

	/**
	 * A native's call as the module's thunk makes it, by the native's marks in
	 * runtime/natives.txt: an `s` argument is the plugin's string, handed to
	 * the native as a Pawn string on the heap; a `t` one is a buffer the
	 * native fills on the heap, back in the plugin as UTF-8 bytes up to its end.
	 */
	across(marks: readonly string[], args: number[], call: (cells: number[]) => number): number {
		const top = this.heapTop;
		try {
			const cells = args.map((arg, i) => marks[i] === 's' ? this.heapText(this.string(arg)) : marks[i] === 't' ? this.heapCells(args[i + 1] + 1) : arg);
			const result = call(cells);
			marks.forEach((mark, i) => {
				if (mark !== 't') return;
				const bytes = this.bytes(cells[i], args[i + 1]);
				this.setRaw(args[i], Uint8Array.of(...bytes.subarray(0, wholeUtf8(bytes)), 0));
			});
			return result;
		} finally {
			this.heapTop = top;
		}
	}

	/** `count` empty cells of the heap: their address. */
	private heapCells(count: number): number {
		const at = this.heapTop;
		this.heapTop += Math.min(Math.max(count, 1), CROSSING_CELLS);
		this.heap.fill(0, at, this.heapTop);
		return HEAP + at * 4;
	}

	/** Text as a Pawn string on the heap, cut at the longest that crosses, between letters. */
	private heapText(text: string): number {
		const bytes = encoder.encode(text);
		const length = utf8Fit(bytes, CROSSING_CELLS - 1);
		const at = this.heapCells(length + 1);
		this.heap.set(bytes.subarray(0, length), (at - HEAP) >> 2);
		return at;
	}

	float(pointer: number): number {
		return bitsFloat(this.cell(pointer));
	}

	setFloat(pointer: number, value: number): void {
		this.setCell(pointer, floatBits(value));
	}

	vector(pointer: number): number[] {
		return [this.float(pointer), this.float(pointer + 4), this.float(pointer + 8)];
	}

	/** A plugin's number (f64) in its own memory. */
	setNumber(pointer: number, value: number): void {
		this.view.setFloat64(pointer, value, true);
	}

	setVector(pointer: number, value: number[]): void {
		for (let i = 0; i < 3; i++) this.setFloat(pointer + i * 4, value[i] ?? 0);
	}

	/** A Pawn string: a byte of UTF-8 a cell, up to the zero cell - what get_amxstring reads. */
	text(pointer: number, max = 4096): string {
		return decoder.decode(this.bytes(pointer, max));
	}

	/** A Pawn string's bytes as they are, at most `max` of them. */
	bytes(pointer: number, max = 4096): Uint8Array {
		if (!pointer) return new Uint8Array();
		const bytes: number[] = [];
		for (let i = 0; i < max; i++) {
			const c = this.cell(pointer + i * 4);
			if (c === 0) break;
			bytes.push(c & 0xFF);
		}
		return Uint8Array.from(bytes);
	}

	/** Fills a Pawn buffer: at most `max` bytes of UTF-8 and the terminator, as set_amxstring. */
	setText(pointer: number, max: number, value: string): number {
		if (!pointer || max < 0) return 0;
		const bytes = encoder.encode(value);
		const length = Math.min(bytes.length, max);
		for (let i = 0; i < length; i++) this.setCell(pointer + i * 4, bytes[i]);
		this.setCell(pointer + length * 4, 0);
		return length;
	}

	/** An AssemblyScript string. */
	string(pointer: number): string {
		if (!pointer) return '';
		const bytes = this.view.getUint32(pointer - 4, true);
		const chars = new Uint16Array(this.exports.memory.buffer, pointer, bytes >>> 1);
		return String.fromCharCode(...chars);
	}

	/** Bytes as they are, into the plugin's memory. */
	setRaw(pointer: number, bytes: Uint8Array): void {
		new Uint8Array(this.exports.memory.buffer, pointer, bytes.length).set(bytes);
	}

	/** A text's UTF-8 length, and as much of it as fits into `max` bytes at `pointer`. */
	setUtf8(pointer: number, max: number, value: string): number {
		const bytes = encoder.encode(value);
		if (pointer && max > 0) this.setRaw(pointer, bytes.subarray(0, max));
		return bytes.length;
	}

	/** UTF-8 into a byte buffer the plugin decodes with String.UTF8 - the module's WriteBytes. */
	setBytes(pointer: number, max: number, value: string): number {
		if (!pointer || max <= 0) return 0;
		const encoded = encoder.encode(value);
		const length = Math.min(encoded.length, max - 1);
		const target = new Uint8Array(this.exports.memory.buffer, pointer, length + 1);
		target.set(encoded.subarray(0, length));
		target[length] = 0;
		return length;
	}
}
