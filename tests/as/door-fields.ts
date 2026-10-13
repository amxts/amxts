// The fields the two entity-field fixtures share: both import this file, as a
// plugin imports the file of the plugin that owns the fields.
import "@amxts/core";

declare module "@amxts/core" {
	interface Entity {
		bhopBlock: "unknown" | "held" | "free";
		doorSpeed: number;
	}
}
