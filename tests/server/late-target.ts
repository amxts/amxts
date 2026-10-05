// The plugin the map-change suite starts with amxts_load, mid-map: its native
// is a name the module's list did not have, which late.sma calls on the next
// map. It holds no suite of its own.
// @unlisted

/** A number late.sma knows. */
export function xt_late() {
	return 42;
}
