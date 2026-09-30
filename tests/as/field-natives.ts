// A fixture for tests/field-natives.test.ts: reapi's field natives read and
// write each field as what it holds, and a server event carries every one of
// its arguments.
import { get_entvar, get_member, set_entvar, set_member } from "~/natives";
import { m_rgAmmo, m_szTeamName, var_classname, var_gravity, var_origin } from "~/constants";

server.addCommand("fields", readAndWrite);

server.addEventListener("pfnPlaybackevent", (event) => {
	console.log(`played ${event.eventid} at ${event.origin.x},${event.origin.y},${event.origin.z} delay ${event.delay} last ${event.bparam2}`);
});

function readAndWrite(player: Player) {
	set_entvar(player.id, var_gravity, 0.5);
	set_entvar(player.id, var_origin, [10, 20, 30.5]);
	set_member(player.id, m_szTeamName, "CT");
	set_member(player.id, m_rgAmmo, 42, 3);

	const origin = get_entvar<Vector>(player.id, var_origin);
	console.log(`gravity ${get_entvar(player.id, var_gravity)} ${player.gravity}`);
	console.log(`origin ${origin.x} ${origin.y} ${origin.z}`);
	console.log(`team ${get_member<string>(player.id, m_szTeamName)} ${player.teamName}`);
	console.log(`ammo ${get_member(player.id, m_rgAmmo, 3)}`);
	console.log(`classname ${get_entvar<string>(player.id, var_classname)}`);
	console.log(`as a number ${get_entvar(player.id, var_origin)}`);
}
