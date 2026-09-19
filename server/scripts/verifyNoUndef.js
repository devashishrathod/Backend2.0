require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverseModule = require("@babel/traverse");

const traverse = traverseModule.default || traverseModule;

/**
 * Find identifiers that are used but never declared, imported or global.
 *
 * ### 🔴 The gap this closes
 *
 * `verifyImports.js` proves every module **loads** and every destructured name
 * really is exported. Neither answers the question that has now shipped a bug
 * twice: *is this name in scope at all?*
 *
 * JavaScript resolves a free variable only when the line runs. So a function
 * that calls something nobody imported is a perfectly valid module — it loads,
 * it exports, it passes both existing checks — and throws `ReferenceError` the
 * first time a user reaches that branch.
 *
 *   - **F-4** — `updateSetting` called `throwError` on its new 422 path. The
 *     import was never added. A failed storage preflight would have answered
 *     with a 500 and a stack trace about an undefined variable.
 *
 *   - **M-1** — ten services called `toMediaDocument` and `toDeletable` on
 *     every image upload. The import was never added, because a patch script's
 *     "does this file already import from helpers/media?" guard saw an
 *     unrelated import and skipped. Every brand logo, category image and avatar
 *     upload would have thrown.
 *
 * Both were found by a test that happened to exercise the branch. That is luck,
 * not coverage.
 *
 * ### How
 *
 * Babel's scope analysis, which is the same thing a linter's `no-undef` rule
 * does. For every identifier reference, ask the enclosing scope whether it has
 * a binding — a `const`, a parameter, a function name, a catch clause, anything.
 * If it does not, and the name is not a known global, it is undefined.
 *
 * ⚠️ `@babel/parser` and `@babel/traverse` are already installed as jest's own
 * dependencies, so this adds nothing to `package.json`.
 */

const ROOT = path.join(__dirname, "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "coverage",
  "uploads",
  "tmp",
  "temp",
  "postman",
  "docs",
]);

/**
 * Names that are simply there at runtime.
 *
 * Node's own globals plus the CommonJS wrapper's five arguments, which are not
 * declared anywhere a parser can see. Jest's are included because the test
 * files are worth checking too — they are where most of this codebase's
 * assertions live.
 */
const GLOBALS = new Set([
  // CommonJS wrapper
  "require", "module", "exports", "__dirname", "__filename",
  // Node
  "process", "Buffer", "console", "global", "globalThis", "structuredClone",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate",
  "clearImmediate", "queueMicrotask", "URL", "URLSearchParams", "TextEncoder",
  "TextDecoder", "AbortController", "AbortSignal", "fetch", "Headers",
  "Request", "Response", "FormData", "Blob", "performance", "crypto",
  // ECMAScript
  "Object", "Array", "String", "Number", "Boolean", "Symbol", "BigInt",
  "Math", "JSON", "Date", "RegExp", "Error", "TypeError", "RangeError",
  "SyntaxError", "ReferenceError", "EvalError", "URIError", "AggregateError",
  "Promise", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "Proxy", "Reflect",
  "Intl", "ArrayBuffer", "SharedArrayBuffer", "DataView", "Atomics",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
  "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
  "BigInt64Array", "BigUint64Array",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURI", "decodeURI",
  "encodeURIComponent", "decodeURIComponent", "escape", "unescape",
  "NaN", "Infinity", "undefined", "eval",
  // Jest
  "jest", "describe", "it", "test", "expect", "beforeAll", "afterAll",
  "beforeEach", "afterEach", "xdescribe", "xit", "xtest", "fdescribe", "fit",
]);

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
};

/**
 * @returns {Array<{ name: string, line: number }>} one per undefined reference
 */
const undefinedIn = (source, file) => {
  const ast = parser.parse(source, {
    sourceType: "script",
    allowReturnOutsideFunction: true,
    errorRecovery: true,
    plugins: ["classProperties", "optionalChaining", "nullishCoalescingOperator"],
  });

  const found = [];
  const seen = new Set();

  traverse(ast, {
    ReferencedIdentifier(nodePath) {
      const { name } = nodePath.node;
      if (GLOBALS.has(name)) return;
      if (nodePath.scope.hasBinding(name, /* noGlobals */ true)) return;

      /**
       * ⚠️ One report per name per file, not per use. A helper called in eight
       * places is one missing import, and eight lines of output would bury the
       * seven other files that each have one.
       */
      if (seen.has(name)) return;
      seen.add(name);

      found.push({ name, line: nodePath.node.loc?.start?.line ?? 0 });
    },
  });

  return found;
};

const run = () => {
  const files = walk(ROOT);
  const failures = [];
  const unparsed = [];
  let checked = 0;

  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    checked += 1;
    try {
      for (const hit of undefinedIn(source, file)) {
        failures.push({ file: path.relative(ROOT, file), ...hit });
      }
    } catch (error) {
      /**
       * A file this cannot parse is reported rather than skipped. Silently
       * passing something it never read is the failure mode every check in
       * this folder exists to avoid.
       */
      unparsed.push({
        file: path.relative(ROOT, file),
        reason: error?.message?.split("\n")[0],
      });
    }
  }

  console.log(`\nFiles parsed: ${checked}\n`);
  console.log("─".repeat(61));
  console.log(
    `  ${failures.length ? "❌" : "✅"} identifiers used but never declared      ${failures.length}`,
  );
  console.log(
    `  ${unparsed.length ? "❌" : "✅"} files that could not be parsed          ${unparsed.length}`,
  );
  console.log("─".repeat(61));

  for (const f of failures) {
    console.log(`\n  ❌ ${f.file}:${f.line}\n     "${f.name}" is not declared, imported or global`);
    console.log(
      `     JavaScript only resolves this when the line runs — the module loads fine`,
    );
    console.log(`     and throws ReferenceError the first time a user reaches it.`);
  }
  for (const u of unparsed) {
    console.log(`\n  ❌ ${u.file}\n     could not parse: ${u.reason}`);
  }

  if (!failures.length && !unparsed.length) {
    console.log("\n✅ every identifier in use is declared, imported or global.\n");
    return 0;
  }
  console.log("");
  return 1;
};

process.exit(run());
