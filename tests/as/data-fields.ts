// The fields the two player-field fixtures share: both import this file, as a
// plugin imports the file of the plugin that owns the fields.
import "@amxts/core";

declare module "@amxts/core" {
	interface Player {
		kills: number;
		tag: string;
	}
}
