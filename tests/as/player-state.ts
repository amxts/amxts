// Fields one plugin keeps on a player for every plugin to read and write:
// a shared-fields file, as the plugin that owns them would ship one. A
// plugin that reads them imports this file, and the build then knows them.
import "~/facade";

declare module "~/facade" {
	interface Player {
		/** Watching, not playing. */
		ghost: boolean;
		/** A glow around him, and who sees it. */
		glow: {
			/** true: he glows; false: he does not; "default": as the server decides. */
			enabled: true | false | "default";
			/** They see it, whatever `enabled` says. */
			seenBy: Player[];
		};
		/** The round clock is not shown to him. */
		hideTimer: boolean;
		/** Held still. */
		frozen: boolean;
	}
}
