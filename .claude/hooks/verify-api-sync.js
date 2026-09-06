#!/usr/bin/env node
/**
 * Keep routes, docs and the Postman collections in step — during the session,
 * not only at commit time.
 *
 * Wired as a `PostToolUse` hook on `Edit|Write|MultiEdit`. It reads the tool's
 * JSON on stdin, and unless the edited file can actually move API coverage it
 * exits immediately — `verifyApiCoverage.js` reads three ~250KB documents and
 * three collections, which is not a price worth paying for a service edit.
 *
 * ### Why a script and not an inline command
 *
 * There is no `jq` on this machine, so the usual `jq -r '.tool_input.file_path'`
 * one-liner silently does nothing here. Node is guaranteed present (it is what
 * runs the project), and doing the match in Node also sidesteps Windows path
 * separators: `file_path` arrives as `C:\...\server\routes\x.js`, which no
 * `case`/glob written with forward slashes would match.
 *
 * ### What it catches that the pre-commit hook does not
 *
 * `.githooks/pre-commit` runs the same check, but only once a commit is already
 * happening. This surfaces the gap while the change is still being made — and
 * the verifier itself now also compares the **stated totals** in
 * `endpoints_category.md` against the routers, which is how the doc went on
 * claiming 216 endpoints after the count became 215 with every check green.
 *
 * Never blocks. A failing check is reported back as context; deciding what to do
 * about it belongs to the turn, not to a hook.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SERVER = path.join(__dirname, "..", "..", "server");

/**
 * Files whose edit can change what `verifyApiCoverage.js` reports.
 *
 * Matched against the path with separators normalised, so this works the same on
 * Windows and POSIX.
 */
const RELEVANT = [
  /(^|\/)server\/routes\//,
  /(^|\/)server\/index\.js$/,
  /(^|\/)server\/postman\//,
  /(^|\/)server\/docs\/endpoints_category\.md$/,
  /(^|\/)server\/docs\/customer_mobile_api_doc\.md$/,
  /(^|\/)server\/docs\/vendor_panel_api_doc\.md$/,
  /(^|\/)server\/docs\/super_admin_panel_api_doc\.md$/,
];

const readStdin = () => {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
};

const filePath = (() => {
  try {
    const payload = JSON.parse(readStdin() || "{}");
    return (
      payload.tool_response?.filePath || payload.tool_input?.file_path || ""
    );
  } catch {
    return "";
  }
})();

const normalised = String(filePath).replace(/\\/g, "/");
if (!normalised || !RELEVANT.some((re) => re.test(normalised))) process.exit(0);

const result = spawnSync(
  process.execPath,
  ["scripts/verifyApiCoverage.js", "--missing"],
  { cwd: SERVER, encoding: "utf8" },
);

if (result.status === 0) process.exit(0);

/**
 * Report it back rather than blocking.
 *
 * `additionalContext` puts the verifier's own output in front of the model, so
 * the missing row, doc section, request or stated total is fixed in the same
 * turn as the edit that caused it — which is the whole point of not waiting for
 * the commit.
 */
const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
process.stdout.write(
  JSON.stringify({
    systemMessage:
      "API coverage is out of sync — routes, docs and Postman no longer agree.",
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        `\`node scripts/verifyApiCoverage.js --missing\` failed after editing ${normalised}:\n\n` +
        `${output}\n\n` +
        "Every route needs a row in docs/endpoints_category.md, a section in the " +
        "doc(s) its gate lets in, a request in the matching collection with a " +
        "saved example, and the stated totals in endpoints_category.md must match " +
        "the router count. ⚠️ Do not regenerate a collection to fix a request — " +
        "that deletes the captured examples. Patch the JSON in place.",
    },
  }),
);
