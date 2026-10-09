// `amxts typecheck`: TypeScript over the project (.amxts/tsconfig.json, which
// `prepare` writes), and what TypeScript allows and the build does not:
//
// - an event or a message named by a variable. A parameter typed
//   `K extends keyof M` (server.addEventListener, addMessageListener, ...)
//   picks the event's type by the name written in the call, so the build
//   needs a string literal there; a loop over `["a", "b"] as const` gives
//   TypeScript a union, which it takes;
// - `const rows = []`: TypeScript reads the element type off the later
//   pushes, the build needs it written.
//
//   node src/typecheck.mjs              in the project's folder; exits 1 on any error
import { resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * What the project's own files - in `root`, outside node_modules and .amxts
 * - write that TypeScript takes and the build does not: each the node it is
 * about and what to write instead.
 *
 * @param {ts.Program} program
 * @param {string} [root] the project's folder
 * @returns {{ node: ts.Node, message: string }[]} the problems, in the files' order
 */
export function buildProblems(program, root = process.cwd()) {
	const inside = resolve(root) + sep;
	const checker = program.getTypeChecker();
	const found = [];

	const visit = (node) => {
		if (ts.isCallExpression(node)) {
			const declaration = checker.getResolvedSignature(node)?.declaration;
			declaration?.parameters?.forEach((parameter, i) => {
				const argument = node.arguments[i];
				if (argument && !ts.isStringLiteral(argument) && namesAKey(parameter, declaration)) {
					found.push({ node: argument, message: `'${argument.getText()}' has to be written out as a string literal - the build picks the event by the name in the call; write a call for each name.` });
				}
			});
		}
		if (ts.isVariableDeclaration(node) && !node.type && node.initializer && ts.isArrayLiteralExpression(node.initializer) && node.initializer.elements.length === 0) {
			found.push({ node, message: `the build does not read an empty array's element type off its later use - write it: const ${node.name.getText()}: Row[] = []` });
		}
		ts.forEachChild(node, visit);
	};

	for (const file of program.getSourceFiles()) {
		const path = resolve(file.fileName);
		if (!file.isDeclarationFile && path.startsWith(inside) && !/[\\/](?:node_modules|\.amxts)[\\/]/.test(path)) visit(file);
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
function described({ node, message }) {
	const file = node.getSourceFile();
	const { line, character } = file.getLineAndCharacterOfPosition(node.getStart());
	return `${file.fileName}(${line + 1},${character + 1}): error amxts: ${message}`;
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

	const problems = buildProblems(program);
	for (const problem of problems) process.stdout.write(`${described(problem)}\n`);
	const errors = diagnostics.filter(each => each.category === ts.DiagnosticCategory.Error).length + problems.length;
	process.exit(errors > 0 ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
