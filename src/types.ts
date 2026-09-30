export interface ParsedInclude {
	natives: NativeFunction[];
	forwards: ForwardDeclaration[];
	constants: Constant[];
	enums: EnumDeclaration[];
}

export interface NativeFunction {
	name: string;
	params: Parameter[];
	returnType: string;
	docs?: string;
}

export interface ForwardDeclaration {
	name: string;
	params: Parameter[];
	returnType: string;
	docs?: string;
}

export interface Parameter {
	name: string;
	type: string;
	isArray?: boolean;
	isRef?: boolean;
	isConst?: boolean;
	isRest?: boolean;
	defaultValue?: string;
	arraySize?: string;
	/** How many bracket pairs the declaration had — `array[][]` is 2, everything else is 1. */
	dimensions?: number;
}

export interface Constant {
	name: string;
	value: string;
	docs?: string;
}

export interface EnumDeclaration {
	name?: string;
	members: EnumMember[];
	docs?: string;
}

export interface EnumMember {
	name: string;
	value?: string;
	docs?: string;
}
