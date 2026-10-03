// The plugin reload-first loads by hand: the list does not name it.
// @unlisted
const starts = new Cvar("amxts_test_reload_hand", "0");

server.addEventListener("init", () => starts.number += 1);
