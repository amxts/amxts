// A plugin that loads two more from its top level: reload-second, which the
// list names after it, and reload-hand, which the list does not. As the
// reload suite reloads every plugin, each of them starts once. At a map's
// start amxts_load is not a command yet, so there only the list loads
// reload-second.
import { server_exec } from "@amxts/core/natives";

server.command("amxts_load reload-second");
server.command("amxts_load reload-hand");
server_exec();
