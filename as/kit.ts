// What a module's own code needs besides the facade:
//
//   import { defineModule, PawnFunction, caller } from "@amxts/core/kit";
//
// defineModule is also global (amxts.d.ts), so a module file may leave it
// unimported. The rest serves a module's natives for Pawn plugins: calling a
// Pawn plugin's public back, reading and filling its `Array:`, a menu of any
// length. They live in the facade - this file only gathers them - and a
// plugin never needs them: what a plugin does has a facade object of its own.
export {
	caller,
	cellArrayRows,
	cellsText,
	colorTags,
	createCellArray,
	defineModule,
	destroyCellArray,
	menuColors,
	PawnCall,
	PawnFunction,
	publicFor,
	pushCellArrayRow,
	showMenu,
	textCells,
} from "./facade";
