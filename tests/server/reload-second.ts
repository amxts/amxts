// The listed plugin reload-first loads before the list comes to it. It
// registers in init(), which runs once its whole file has.
const starts = new Cvar("amxts_test_reload_second", "0");

export function init() {
	server.addEventListener("init", () => starts.number += 1);
}
