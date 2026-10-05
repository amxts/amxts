/**
 * A Pawn value as a number, or null when it is not one.
 *
 * Every name that resolved earlier is substituted for its value first, so
 * `MAX_REGION_RANGE * ht_player` becomes `1024 * 3`. Tag casts (`any:x`,
 * `hooks_tables_e:ht_player`) are noise here and go. What is refused is
 * anything still carrying a name: emitting it would produce a file that does
 * not compile, and guessing would be worse.
 */
export function evaluate(raw: string, known: Map<string, number>): number | null {
	const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '').trim();
	if (!text) return null;

	const untagged = text.replace(/\b[A-Z_]\w*:(?=[\w(])/gi, '');
	const substituted = untagged.replace(/\b[A-Z_]\w*\b/gi, (name) => {
		const value = known.get(name);
		return value === undefined ? name : String(value);
	});

	if (!/^[-+*/%()<>|&^~\s\d]+$/.test(substituted)) return null;

	try {
		// Only numbers and operators got this far: a constant expression, not code.
		// oxlint-disable-next-line no-new-func
		const value = new Function(`return (${substituted});`)();
		return Number.isInteger(value) ? value : null;
	} catch {
		return null;
	}
}
