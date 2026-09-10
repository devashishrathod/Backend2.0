/**
 * Load every module, and check that what each one destructures actually exists.
 *
 * ### The failure this catches
 *
 * A CommonJS destructured import of a missing export binds `undefined` **and
 * says nothing**. Nothing throws at require time; it throws when the name is
 * called, which may be inside a `try` that swallows it, on a path that runs
 * once a night.
 *
 * That is not hypothetical here. When two document helpers were deleted and
 * replaced, `services/settlements/buildSettlements.js` was still importing
 * `INVOICE_SERIES` and `generateInvoiceNumber` from them. Both bound
 * `undefined`. The call sat inside the per-brand `try`, so every brand failed,
 * the failure went into `failures[]`, and the job reported `built: 0` — no
 * error, no alert, no vendor paid. It was found days later by a human noticing
 * the number.
 *
 * `require`-ing a file only proves the file parses. This also reads the source
 * for `const { a, b } = require("…")` and asserts `a` and `b` are really on the
 * exported object.
 *
 *     node scripts/verifyImports.js
 *
 * Exits non-zero on the first real problem, so it can gate CI.
 *
 * ### ⚠️ What it deliberately does not do
 *
 * It does not load `index.js`, `jobs/index.js` or anything under `__tests__`,
 * `node_modules` or `scripts`: the first two start listeners and schedulers, and
 * a verifier that boots the server is a verifier nobody runs. Everything they
 * import is reached anyway, because every model, helper, service and route is
 * loaded directly.
 */
require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SKIP_DIRS = new Set([
  "node_modules",
  "__tests__",
  "scripts",
  ".git",
  "uploads",
  "docs",
  "postman",
]);
/** Files that stand up a server or a scheduler rather than exporting logic. */
const SKIP_FILES = new Set(["index.js", "app.js", "server.js"]);

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith(".js")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
};

/**
 * Blank out comments, keeping the source's length and line structure.
 *
 * ### ⚠️ Why this is not a regex
 *
 * The first version of this script matched `require` anywhere in the file and
 * reported two "missing exports" that were both **commented-out** lines —
 * `// const { isAdult } = require("../../helpers/users")` and one like it. A
 * verifier that reports things that are not true is worse than no verifier,
 * because the next real finding is read as noise too.
 *
 * Cutting at the first `//` on a line is also wrong: `"https://…"` appears in
 * this codebase, and so do regexes containing slashes. So this walks the source
 * tracking quote and template state, and only treats `//` and `/*` as comment
 * openers when it is not inside a string.
 *
 * Characters are replaced with spaces rather than removed, so any position or
 * line number stays meaningful.
 */
const stripComments = (source) => {
  const out = source.split("");
  let i = 0;
  let quote = null; // the character that closes the current string

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (quote) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      i += 1;
      continue;
    }

    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out[i] = " ";
        i += 1;
      }
      continue;
    }

    if (c === "/" && next === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] !== "\n") out[i] = " ";
        i += 1;
      }
      // The closing `*/` itself.
      if (i < source.length) {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
      }
      continue;
    }

    i += 1;
  }

  return out.join("");
};

/**
 * The destructured names in `const { a, b: c } = require("…")`.
 *
 * Only relative requires: a missing export from a package is that package's
 * problem, and node_modules is not ours to audit. Renames (`b: c`) are read as
 * `b`, which is the name that has to exist.
 */
const parseDestructured = (rawSource) => {
  const source = stripComments(rawSource);
  const found = [];
  const re =
    /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*["'](\.[^"']+)["']\s*\)/g;

  for (const match of source.matchAll(re)) {
    const names = match[1]
      .split(",")
      .map((part) => part.split(":")[0].trim())
      .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
    if (names.length) found.push({ request: match[2], names });
  }
  return found;
};

const run = () => {
  const files = walk(ROOT).filter(
    (file) => !SKIP_FILES.has(path.basename(file)) || path.dirname(file) !== ROOT,
  );

  const loadFailures = [];
  const missing = [];
  let checkedNames = 0;

  for (const file of files) {
    // Never load the app entry points — see the note above.
    if (SKIP_FILES.has(path.basename(file)) && path.dirname(file) === ROOT) {
      continue;
    }

    let source;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    try {
      require(file);
    } catch (error) {
      loadFailures.push({
        file: path.relative(ROOT, file),
        reason: error?.message,
      });
      continue;
    }

    for (const { request, names } of parseDestructured(source)) {
      let target;
      try {
        target = require(path.resolve(path.dirname(file), request));
      } catch (error) {
        loadFailures.push({
          file: `${path.relative(ROOT, file)} → ${request}`,
          reason: error?.message,
        });
        continue;
      }

      for (const name of names) {
        checkedNames += 1;
        if (target === null || target === undefined || !(name in target)) {
          missing.push({
            file: path.relative(ROOT, file),
            request,
            name,
          });
        }
      }
    }
  }

  console.log(
    `\nFiles loaded: ${files.length}   destructured names checked: ${checkedNames}\n`,
  );
  console.log("─".repeat(61));
  console.log(
    `  ${loadFailures.length ? "❌" : "✅"} modules that could not be loaded        ${loadFailures.length}`,
  );
  console.log(
    `  ${missing.length ? "❌" : "✅"} imports of a name that is not exported   ${missing.length}`,
  );
  console.log("─".repeat(61));

  for (const f of loadFailures) {
    console.log(`\n  ❌ ${f.file}\n     ${f.reason}`);
  }
  for (const m of missing) {
    console.log(
      `\n  ❌ ${m.file}\n     imports { ${m.name} } from "${m.request}" — not exported`,
    );
    console.log(
      `     CommonJS binds this to undefined silently; it throws only when called.`,
    );
  }

  if (!loadFailures.length && !missing.length) {
    console.log("\n✅ every module loads, and every imported name exists.\n");
    return 0;
  }
  console.log("");
  return 1;
};

process.exit(run());
