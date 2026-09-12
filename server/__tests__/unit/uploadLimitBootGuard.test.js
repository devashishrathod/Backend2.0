const path = require("path");
const { spawn } = require("child_process");

const {
  resolveMaxUploadSizeMb,
  DEFAULT_MAX_UPLOAD_SIZE_MB,
} = require("../../configs/uploadLimit");

/**
 * `MAX_UPLOAD_SIZE_MB` must fail the boot rather than be misread.
 *
 * Two levels, on purpose. The parser is exercised directly — fast, and every
 * case can be covered. One spawned boot then proves the guard is actually
 * wired in front of the server and not merely exported, which is the part a
 * pure test cannot tell you.
 */

describe("resolveMaxUploadSizeMb", () => {
  it("defaults when the variable is not set", () => {
    expect(resolveMaxUploadSizeMb(undefined)).toBe(DEFAULT_MAX_UPLOAD_SIZE_MB);
    expect(resolveMaxUploadSizeMb("")).toBe(DEFAULT_MAX_UPLOAD_SIZE_MB);
  });

  it("reads a plain number", () => {
    expect(resolveMaxUploadSizeMb("100")).toBe(100);
    expect(resolveMaxUploadSizeMb("1")).toBe(1);
    expect(resolveMaxUploadSizeMb("2048")).toBe(2048);
  });

  /**
   * ⚠️ The case that matters most. `Number.parseInt("abc")` is `NaN`, and
   * `limits: { fileSize: NaN }` is not a small limit — it is **no limit**,
   * because every comparison against `NaN` is false. Accepting this would
   * silently undo the entire fix.
   */
  it("rejects a value that is not a number", () => {
    expect(() => resolveMaxUploadSizeMb("abc")).toThrow(/whole number/);
    expect(() => resolveMaxUploadSizeMb("   ")).toThrow(/whole number/);
    expect(() => resolveMaxUploadSizeMb("NaN")).toThrow(/whole number/);
  });

  /** The opposite failure: every upload answers 413 and nobody knows why. */
  it("rejects zero and negatives", () => {
    expect(() => resolveMaxUploadSizeMb("0")).toThrow(/whole number/);
    expect(() => resolveMaxUploadSizeMb("-5")).toThrow(/whole number/);
  });

  it("names the offending value in the message", () => {
    expect(() => resolveMaxUploadSizeMb("abc")).toThrow(/"abc"/);
  });

  /**
   * `parseInt` stops at the first non-digit, so "100MB" reads as 100 rather
   * than failing. Recorded as accepted, not overlooked: it is the one malformed
   * spelling that cannot produce a wrong limit.
   */
  it("reads a trailing unit as the leading number", () => {
    expect(resolveMaxUploadSizeMb("100MB")).toBe(100);
  });
});

describe("the guard runs at boot", () => {
  const SERVER_DIR = path.resolve(__dirname, "..", "..");
  const BOOT_TIMEOUT_MS = 25000;

  /**
   * ⚠️ `ENABLE_JOBS=false` and `PORT=0` are not tidiness. If this guard were
   * ever removed, the process would carry on into `mongoDb()`, start the
   * background jobs and run the index assertions — against the development
   * database, from a test run. The test would still fail, but only after doing
   * real work to a real cluster. These make the failure harmless.
   */
  it(
    "exits 1 instead of listening when the value is unreadable",
    () =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["index.js"], {
          cwd: SERVER_DIR,
          env: {
            ...process.env,
            MAX_UPLOAD_SIZE_MB: "abc",
            ENABLE_JOBS: "false",
            PORT: "0",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });

        let output = "";
        child.stdout.on("data", (chunk) => (output += chunk));
        child.stderr.on("data", (chunk) => (output += chunk));

        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("index.js kept running on an unreadable limit"));
        }, BOOT_TIMEOUT_MS - 4000);

        child.on("error", reject);
        child.on("exit", (code) => {
          clearTimeout(timer);
          try {
            expect(code).toBe(1);
            expect(output).toContain("MAX_UPLOAD_SIZE_MB must be a whole number");
            // It must stop before the database, not after.
            expect(output).not.toContain("Server running");
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      }),
    BOOT_TIMEOUT_MS,
  );
});
