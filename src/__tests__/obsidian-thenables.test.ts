import * as path from "node:path";
import * as ts from "typescript";

// Obsidian's Setting and components have their own `then`, so a promise that resolves to one
// never settles and the UI freezes. This scans the plugin's source for every way that can happen.

const ROOT = path.resolve(__dirname, "../..");
const PROBE = path.join(ROOT, "src", "__thenable_probe__.ts");
const PROBE_SOURCE = `import { Setting } from "obsidian";
export function probe(el: HTMLElement): void {
  const s = new Setting(el);
  void Promise.resolve(0).then(() => s.setDesc("x"));
}
`;

function buildProgram(): ts.Program {
  const configPath = path.join(ROOT, "tsconfig.json");
  const raw = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, ROOT);
  const host = ts.createCompilerHost(parsed.options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, onError, shouldCreate) =>
    path.resolve(file) === PROBE
      ? ts.createSourceFile(file, PROBE_SOURCE, languageVersion, true)
      : getSourceFile(file, languageVersion, onError, shouldCreate);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (file) => path.resolve(file) === PROBE || fileExists(file);
  return ts.createProgram([...parsed.fileNames, PROBE], parsed.options, host);
}

function isObsidianThenable(type: ts.Type): boolean {
  const types = type.isUnion() ? type.types : [type];
  return types.some((t) =>
    (t.getProperty("then")?.declarations ?? []).some((d) =>
      d.getSourceFile().fileName.endsWith("obsidian.d.ts"),
    ),
  );
}

type FunctionNode =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionDeclaration
  | ts.MethodDeclaration;

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  );
}

function returnedExpressions(fn: FunctionNode): ts.Expression[] {
  const body = fn.body;
  if (!body) return [];
  if (!ts.isBlock(body)) return [body];
  const out: ts.Expression[] = [];
  const walk = (node: ts.Node): void => {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) out.push(node.expression);
    ts.forEachChild(node, walk);
  };
  walk(body);
  return out;
}

function isPromiseCallback(fn: FunctionNode): boolean {
  const call = fn.parent;
  return (
    ts.isCallExpression(call) &&
    call.arguments.some((arg) => arg === fn) &&
    ts.isPropertyAccessExpression(call.expression) &&
    ["then", "catch", "finally"].includes(call.expression.name.text)
  );
}

function findAdoptions(program: ts.Program): string[] {
  const checker = program.getTypeChecker();
  const hits: string[] = [];
  const report = (node: ts.Node): void => {
    const sf = node.getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    hits.push(`${path.relative(ROOT, sf.fileName)}:${line + 1}`);
  };
  for (const sf of program.getSourceFiles()) {
    const file = sf.fileName;
    if (sf.isDeclarationFile || file.includes("node_modules") || file.includes("__tests__") || file.includes("__mocks__")) {
      continue;
    }
    const visit = (node: ts.Node): void => {
      if (isFunctionNode(node)) {
        const isAsync = (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Async) !== 0;
        if (isAsync || isPromiseCallback(node)) {
          for (const expr of returnedExpressions(node)) {
            if (isObsidianThenable(checker.getTypeAtLocation(expr))) report(expr);
          }
        }
      }
      if (ts.isAwaitExpression(node) && isObsidianThenable(checker.getTypeAtLocation(node.expression))) {
        report(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return hits;
}

describe("Obsidian thenables", () => {
  it("are never resolved, returned or awaited by a promise", () => {
    const hits = findAdoptions(buildProgram());
    // The probe proves the scan still sees Obsidian's types; nothing else may match.
    expect(hits).toEqual(["src/__thenable_probe__.ts:4"]);
  }, 60_000);
});
