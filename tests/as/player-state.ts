// Fields one plugin keeps on a player for every plugin to read and write:
// a shared-fields file, as the plugin that owns them would ship one. A
// plugin that reads them imports this file, and the build then knows them.
import "~/facade";

declare module "~/facade" {
	interface Player {
		/** Watching, not playing. */
		ghost: boolean;
		/** Who walks through him and whom he walks through. */
		semiclip: {
			/** true: everyone walks through him; false: solid to everyone; "default": the server's rule. */
			enabled: true | false | "default";
			/** He walks through these too, whatever `enabled` says. */
			passesThrough: Player[];
		};
		/** The round clock is not shown to him. */
		hideTimer: boolean;
		/** Held still. */
		frozen: boolean;
	}
}
