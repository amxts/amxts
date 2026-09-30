// The fields the two player-field fixtures share: both import this file, as a
// plugin imports the file of the plugin that owns the fields.
import "~/facade";

declare module "~/facade" {
	interface Player {
		kills: number;
		tag: string;
	}
}
