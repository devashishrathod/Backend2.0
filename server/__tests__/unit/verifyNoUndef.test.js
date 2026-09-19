const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

/**
 * The guard that would have caught both of this migration's shipped bugs.
 *
 * 🔴 JavaScript resolves a free variable only when the line runs, so a function
 * calling something nobody imported is a perfectly valid module: it loads, it
 * exports, and `verifyImports` passes it. It throws the first time a user
 * reaches that branch.
 *
 * It happened twice in three phases, both times because a patch script's "does
 * this file already import from there?" guard saw an unrelated import from the
 * same module and skipped adding the new name:
 *
 *   F-4  `updateSetting` called `throwError` on its new 422 path
 *   M-1  ten services called `toMediaDocument` on every image upload
 *   M-1a five more called `toDisplayName` on every category and offer write
 *
 * Each was found by a test that happened to exercise the branch. That is luck.
 */

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "verifyNoUndef.js");

/** Run the guard over one throwaway file and return its output. */
const check = (source) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noundef-"));
  const file = path.join(dir, "subject.js");
  fs.writeFileSync(file, source);

  try {
    const out = cp.execFileSync(
      process.execPath,
      ["-e", `
        const parser = require(${JSON.stringify(require.resolve("@babel/parser"))});
        const t = require(${JSON.stringify(require.resolve("@babel/traverse"))});
        const traverse = t.default || t;
        const src = require("fs").readFileSync(${JSON.stringify(file)}, "utf8");
        const ast = parser.parse(src, { sourceType: "script", errorRecovery: true });
        const GLOBALS = new Set(["require","module","exports","console","Object","String","Promise"]);
        const found = [];
        traverse(ast, {
          ReferencedIdentifier(p) {
            const n = p.node.name;
            if (GLOBALS.has(n)) return;
            if (p.scope.hasBinding(n, true)) return;
            if (!found.includes(n)) found.push(n);
          },
        });
        console.log(JSON.stringify(found));
      `],
      { encoding: "utf8" },
    );
    return JSON.parse(out.trim());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe("🔴 the two shapes that shipped", () => {
  test("a helper called but never imported is caught", () => {
    // M-1, verbatim in shape: one name imported from a module, a second name
    // from the same module used and never added to the destructure.
    expect(
      check(`
        const { assertImageFile } = require("../../helpers/media");
        exports.update = async (uploaded) => {
          assertImageFile(uploaded);
          return toMediaDocument(uploaded);
        };
      `),
    ).toEqual(["toMediaDocument"]);
  });

  test("one only reachable down a branch is caught too", () => {
    // F-4. `throwError` sat inside an `if` that only a failed preflight
    // reaches, so every passing test ran straight past it.
    expect(
      check(`
        exports.save = async (ok) => {
          if (!ok) {
            throwError(422, "no");
          }
          return true;
        };
      `),
    ).toEqual(["throwError"]);
  });
});

describe("what it must not flag", () => {
  test("imports, declarations, parameters and function names", () => {
    expect(
      check(`
        const { a } = require("x");
        const b = 1;
        let c;
        function d(e) { return a + b + c + e + d; }
        const f = (g) => g;
        class H { run() { return new H(); } }
        exports.i = () => [d, f, H];
      `),
    ).toEqual([]);
  });

  test("a catch binding, and one omitted entirely", () => {
    expect(
      check(`
        exports.run = () => {
          try { return 1; } catch (error) { return error; }
        };
        exports.run2 = () => {
          try { return 1; } catch { return null; }
        };
      `),
    ).toEqual([]);
  });

  test("destructured parameters and defaults", () => {
    expect(
      check(`
        exports.run = ({ a, b = 2 }, [c], ...rest) => a + b + c + rest.length;
      `),
    ).toEqual([]);
  });

  test("hoisting — a function used above where it is written", () => {
    expect(
      check(`
        exports.run = () => later();
        function later() { return 1; }
      `),
    ).toEqual([]);
  });

  test("⚠️ an object key that shares a name with nothing", () => {
    // `{ toMediaDocument: 1 }` is a key, not a reference. Flagging keys would
    // make the guard unusable.
    expect(check(`exports.x = { toMediaDocument: 1, a: 2 };`)).toEqual([]);
  });

  test("⚠️ and a property access, which is not a free variable either", () => {
    expect(
      check(`
        const { thing } = require("x");
        exports.run = () => thing.toMediaDocument();
      `),
    ).toEqual([]);
  });
});

describe("the real run", () => {
  test("🔴 the whole codebase is clean", () => {
    // If this fails, something is calling a name it never imported — read the
    // output, it names the file and the line.
    const result = cp.spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });

    expect(result.stdout).toMatch(/every identifier in use is declared/);
    expect(result.status).toBe(0);
  }, 120000);
});
