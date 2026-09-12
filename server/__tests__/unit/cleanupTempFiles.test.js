const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

const { cleanupTempFiles } = require("../../middlewares/cleanupTempFiles");

/**
 * The middleware deliberately does not await its unlinks — the response has
 * already gone out, so there is nothing left to fail and nobody to tell. That
 * makes the effect a tick or two behind the event, so assertions poll rather
 * than assuming it has landed.
 */
const waitFor = async (predicate, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
};

const gone = (filePath) => () => !fs.existsSync(filePath);

let workDir;

const makeTempFile = (name) => {
  const filePath = path.join(workDir, name);
  fs.writeFileSync(filePath, "x");
  return filePath;
};

/** The shape `express-fileupload` puts on `req.files`. */
const uploadedFile = (tempFilePath) => ({ name: "a.jpg", tempFilePath });

const runMiddleware = (files) => {
  const req = { files };
  const res = new EventEmitter();
  let nextCalled = false;
  cleanupTempFiles(req, res, () => {
    nextCalled = true;
  });
  return { req, res, wasNextCalled: () => nextCalled };
};

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "trydood-cleanup-test-"));
});

afterAll(async () => {
  await fsp.rm(workDir, { recursive: true, force: true });
});

describe("cleanupTempFiles", () => {
  it("passes the request straight on", () => {
    const { wasNextCalled } = runMiddleware(null);
    expect(wasNextCalled()).toBe(true);
  });

  it("deletes the temp file once the response finishes", async () => {
    const file = makeTempFile("single.tmp");
    const { res } = runMiddleware({ logo: uploadedFile(file) });

    expect(fs.existsSync(file)).toBe(true);
    res.emit("finish");

    expect(await waitFor(gone(file))).toBe(true);
  });

  /**
   * A field repeated in the form arrives as an array — voucher images do this,
   * a brand logo does not. Reading only the object shape would leave every
   * multi-file upload behind, which is the largest kind there is.
   */
  it("deletes every file across single and repeated fields", async () => {
    const logo = makeTempFile("multi-logo.tmp");
    const one = makeTempFile("multi-1.tmp");
    const two = makeTempFile("multi-2.tmp");

    const { res } = runMiddleware({
      logo: uploadedFile(logo),
      images: [uploadedFile(one), uploadedFile(two)],
    });

    res.emit("finish");

    expect(await waitFor(() => [logo, one, two].every((f) => !fs.existsSync(f)))).toBe(
      true,
    );
  });

  /**
   * `finish` never fires for a response the client abandoned. Without a `close`
   * listener the file from every cancelled upload would stay — and a cancelled
   * upload is usually a large one, which is the case that matters.
   */
  it("deletes the temp file when the client disconnects instead", async () => {
    const file = makeTempFile("aborted.tmp");
    const { res } = runMiddleware({ video: uploadedFile(file) });

    res.emit("close");

    expect(await waitFor(gone(file))).toBe(true);
  });

  /**
   * Both events fire for the same response often enough.
   *
   * ⚠️ Asserts on the number of `unlink` calls, not on the file being gone or
   * on the log staying quiet. Either of those passes with the guard removed —
   * the second pass hits ENOENT, which is swallowed on purpose — so a test
   * written that way reports a guard it is not actually testing. Confirmed by
   * mutation: it survived removal of the guard until this was rewritten.
   */
  it("sweeps once when both finish and close fire", async () => {
    const file = makeTempFile("double.tmp");
    const calls = [];
    const original = fsp.unlink;
    fsp.unlink = (target) => {
      calls.push(target);
      return original(target);
    };

    try {
      const { res } = runMiddleware({ image: uploadedFile(file) });
      res.emit("finish");
      res.emit("close");

      expect(await waitFor(gone(file))).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls).toEqual([file]);
    } finally {
      fsp.unlink = original;
    }
  });

  /**
   * The library's own cleanup already ran on every path that failed, so a
   * missing file is the normal case, not a problem worth a line in the log.
   */
  it("stays quiet when the file is already gone", async () => {
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(" "));

    try {
      const { res } = runMiddleware({
        image: uploadedFile(path.join(workDir, "never-existed.tmp")),
      });
      res.emit("finish");

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(errors).toEqual([]);
    } finally {
      console.error = original;
    }
  });

  it("ignores entries that carry no temp path", async () => {
    const file = makeTempFile("mixed.tmp");
    const { res } = runMiddleware({
      // `useTempFiles` off for a field, or a malformed entry.
      inMemory: { name: "b.jpg", data: Buffer.from("x") },
      real: uploadedFile(file),
      empty: null,
    });

    res.emit("finish");

    expect(await waitFor(gone(file))).toBe(true);
  });

  it("does nothing when the request carried no files", () => {
    const { res, wasNextCalled } = runMiddleware(undefined);
    expect(wasNextCalled()).toBe(true);
    expect(() => res.emit("finish")).not.toThrow();
  });
});
