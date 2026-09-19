/**
 * Run the money suite in batches, each in its own jest process.
 *
 * ### Why not just `npm test`
 *
 * All 79 files in one process is what this machine cannot do. Run together they
 * slow from ~35s each to 90-110s and then start failing `beforeAll` on the 60s
 * hook timeout — 90 timeouts against 11 real assertions, which proves nothing
 * and sends you chasing bugs that are not there. The same files pass in seconds
 * when run a few at a time.
 *
 * Each batch is a fresh `jest` process, so memory and every module-level cache
 * start clean. The suite's own run lock is taken and released per batch, which
 * is also what makes a batch safe to re-run on its own.
 *
 * ⚠️ A batch that is **killed** leaves the lock behind — see
 * `scripts/clearMoneyTestLock.js`, and kill the node child before releasing it.
 *
 *     node scripts/runMoneySuite.js            # every file, in batches
 *     node scripts/runMoneySuite.js --size 10  # smaller batches
 *     node scripts/runMoneySuite.js --from 4   # resume at batch 4
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MONEY_DIR = path.join(__dirname, "..", "__tests__", "money");

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : Number(process.argv[at + 1]);
};

const BATCH_SIZE = arg("size", 12);
const START_AT = arg("from", 1);

const files = fs
  .readdirSync(MONEY_DIR)
  .filter((name) => name.endsWith(".test.js"))
  .sort();

const batches = [];
for (let i = 0; i < files.length; i += BATCH_SIZE) {
  batches.push(files.slice(i, i + BATCH_SIZE));
}

console.log(
  `${files.length} files, ${batches.length} batches of ${BATCH_SIZE}\n`,
);

const failedFiles = [];
let totalPassed = 0;
let totalFailed = 0;

for (const [index, batch] of batches.entries()) {
  const number = index + 1;
  if (number < START_AT) {
    console.log(`batch ${number}/${batches.length} — skipped (--from ${START_AT})`);
    continue;
  }

  const label = `batch ${number}/${batches.length}`;
  process.stdout.write(`${label} (${batch.length} files) … `);

  const started = Date.now();
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "jest",
      "--config",
      "jest.config.js",
      ...batch.map((name) => `__tests__/money/${name}`),
    ],
    { cwd: path.join(__dirname, ".."), encoding: "utf8", shell: true },
  );

  const out = `${result.stdout || ""}${result.stderr || ""}`;
  const seconds = Math.round((Date.now() - started) / 1000);

  /**
   * ⚠️ Read each count by name, not by position.
   *
   * 🔴 This was one regex spelling the line out — `failed, skipped, passed` — and
   * a batch that reported `1 failed, 5 todo, 202 passed` matched none of it, so
   * the summary said "0 failed, 0 passed" for a batch that had run 208 tests.
   * A progress report that silently reads zero is worse than no report.
   *
   * Jest prints whichever categories are non-zero, in whatever combination, so
   * the only safe thing is to look for each label on its own.
   */
  const summary = /Tests:\s+(.+)/.exec(out)?.[1] ?? "";
  const count = (label) =>
    Number(new RegExp(`(\\d+) ${label}`).exec(summary)?.[1] || 0);

  const failed = count("failed");
  const passed = count("passed");
  totalFailed += failed;
  totalPassed += passed;

  const broken = [...out.matchAll(/^FAIL\s+(\S+)/gm)].map((m) => m[1]);
  failedFiles.push(...broken);

  console.log(
    failed || broken.length
      ? `❌ ${failed} failed, ${passed} passed  (${seconds}s)`
      : `✅ ${passed} passed  (${seconds}s)`,
  );
  for (const file of broken) console.log(`      ${file}`);

  // The whole run's output, so a failure can be read without re-running it.
  fs.appendFileSync(
    path.join(__dirname, "..", "money-run.log"),
    `\n${"=".repeat(70)}\n${label}\n${"=".repeat(70)}\n${out}`,
  );
}

console.log(
  `\n${totalPassed} passed, ${totalFailed} failed across ${files.length} files`,
);
if (failedFiles.length) {
  console.log(`\nfailing files:\n  ${[...new Set(failedFiles)].join("\n  ")}`);
  console.log("\nfull output: money-run.log");
}
process.exit(totalFailed ? 1 : 0);
