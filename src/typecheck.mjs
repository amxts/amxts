// `amxts typecheck`: TypeScript over the project (.amxts/tsconfig.json, which
// `prepare` writes), and what TypeScript allows and the build does not.
//
// An event or a message is named by a parameter typed `K extends keyof M`
// (server.addEventListener, addMessageListener, ...): the build picks the
// event's type by the name written in the call, so the name has to be a
// string literal there. A variable - a loop over `["a", "b"] as const` - is
// a union to TypeScript, which takes it, and stops the build; this says so
// first.
//
//   node src/typecheck.mjs              in the project's folder; exits 1 on any error
import { resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * The calls of the project's own files - in `root`, outside node_modules and
 * .amxts - whose argument for a `K extends keyof M` parameter is not a string
 * literal: each the argument's node.
 *
 * @param {ts.Program} program
 * @param {string} [root] the project's folder
 * @returns {ts.Expression[]}
 */
export function unwrittenNames(program, root = process.cwd()) {
	const inside = resolve(root) + sep;
	const checker = program.getTypeChecker();
	const found = [];

	const visit = (node) => {
		if (ts.isCallExpression(node)) {
			const declaration = checker.getResolvedSignature(node)?.declaration;
			declaration?.parameters?.forEach((parameter, i) => {
				const argument = node.arguments[i];
				if (argument && !ts.isStringLiteral(argument) && namesAKey(parameter, declaration)) found.push(argument);
			});
		}
		ts.forEachChild(node, visit);
	};

	for (const file of program.getSourceFiles()) {
		const path = resolve(file.fileName);
		if (!file.isDeclarationFile && path.startsWith(inside) && !/[\\/](node_modules|\.amxts)[\\/]/.test(path)) visit(file);
	}
	return found;
}

/** Whether the parameter is typed with a type parameter of its function that is `extends keyof ...`. */
function namesAKey(parameter, declaration) {
	const type = parameter.type;
	if (!type || !ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) return false;
	const constraint = declaration.typeParameters?.find(each => each.name.text === type.typeName.text)?.constraint;
	return !!constraint && ts.isTypeOperatorNode(constraint) && constraint.operator === ts.SyntaxKind.KeyOfKeyword;
}

/** `file(line,col): error amxts: ...`, as tsc writes its own. */
function described(argument) {
	const file = argument.getSourceFile();
	const { line, character } = file.getLineAndCharacterOfPosition(argument.getStart());
	return `${file.fileName}(${line + 1},${character + 1}): error amxts: '${argument.getText()}' has to be written out as a string literal - the build picks the event by the name in the call; write a call for each name.`;
}

function main() {
	const config = ts.getParsedCommandLineOfConfigFile('.amxts/tsconfig.json', { noEmit: true }, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
	if (!config) {
		process.stdout.write('error: .amxts/tsconfig.json cannot be read - run npx amxts prepare\n');
		process.exit(1);
	}

	const program = ts.createProgram({ rootNames: config.fileNames, options: config.options });
	const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)];
	const format = process.stdout.isTTY ? ts.formatDiagnosticsWithColorAndContext : ts.formatDiagnostics;
	process.stdout.write(format(diagnostics, {
		getCanonicalFileName: name => name,
		getCurrentDirectory: ts.sys.getCurrentDirectory,
		getNewLine: () => ts.sys.newLine,
	}));

	const names = unwrittenNames(program);
	for (const argument of names) process.stdout.write(`${described(argument)}\n`);
	const errors = diagnostics.filter(each => each.category === ts.DiagnosticCategory.Error).length + names.length;
	process.exit(errors > 0 ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
