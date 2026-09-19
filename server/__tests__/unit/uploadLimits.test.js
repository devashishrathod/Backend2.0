const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const http = require("http");
const express = require("express");
const fileUpload = require("express-fileupload");

const { cleanupTempFiles } = require("../../middlewares/cleanupTempFiles");

/**
 * The upload stack as `index.js` mounts it, driven by a real multipart request.
 *
 * The middleware's own unit tests drive it with a fake `req`/`res`, which proves
 * the sweep but not that `express-fileupload` behaves the way the comments in
 * `index.js` claim — that a file left on the success path is never deleted by
 * the library, that `abortOnLimit` closes the connection, and that a size abort
 * never reaches a middleware mounted after it. Those are the assumptions the
 * whole fix rests on, and they belong to the library, not to us. This exercises
 * the assembled stack over a socket so that a library upgrade that changes any
 * of them fails here rather than silently filling a disk again.
 *
 * No database, no network beyond loopback.
 */

const MAX_MB = 1; // Keeps the oversize body small; the behaviour is the same at 100.
let tempDir;
let server;
let baseUrl;

const tempFilesNow = () => (fs.existsSync(tempDir) ? fs.readdirSync(tempDir) : []);

const buildApp = ({ withCleanup }) => {
  const app = express();
  if (withCleanup) app.use(cleanupTempFiles);
  app.use(
    fileUpload({
      useTempFiles: true,
      tempFileDir: tempDir,
      limits: { fileSize: MAX_MB * 1024 * 1024 },
      abortOnLimit: true,
      limitHandler: (req, res) => {
        if (res.headersSent) return;
        res.status(413).json({
          success: false,
          message: `File is too large. The maximum upload size is ${MAX_MB} MB.`,
        });
      },
    }),
  );
  app.post("/upload", (req, res) => {
    res.json({ success: true, received: Object.keys(req.files || {}) });
  });
  return app;
};

/** A multipart body with one part per entry. */
const multipart = (parts) => {
  const boundary = `----trydoodtest${Date.now()}`;
  const chunks = [];
  for (const { field, filename, contentType, body } of parts) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
          `Content-Type: ${contentType}\r\n\r\n`,
      ),
      body,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
};

const post = (urlPath, parts) =>
  new Promise((resolve, reject) => {
    const { boundary, body } = multipart(parts);
    const url = new URL(urlPath, baseUrl);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        const out = [];
        res.on("data", (c) => out.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: Buffer.concat(out).toString() }),
        );
      },
    );
    // A size abort closes the connection mid-body; the write that was in flight
    // then fails, and that is the expected shape of the test, not an error.
    req.on("error", (error) =>
      ["ECONNRESET", "EPIPE"].includes(error.code) ? undefined : reject(error),
    );
    req.end(body);
  });

const listen = (app) =>
  new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

const close = () =>
  new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));

/**
 * Wait until the temp directory holds `count` files.
 *
 * 🔴 This used to be a flat `setTimeout(250)`, and 250ms was a guess about how
 * long a stream close and an unlink take. Run on their own the tests passed; run
 * inside the full suite, with every jest worker competing for the same disk,
 * the cleanup occasionally landed on the wrong side of that number and one test
 * failed for no reason anybody could reproduce.
 *
 * Polling makes the wait proportional to what actually happens: it returns the
 * instant the condition holds, and gives up after a ceiling far above any real
 * cleanup so a genuine regression still fails — with the assertion below saying
 * what was there instead of a timeout saying nothing.
 */
const CLEANUP_CEILING_MS = 5000;

const settle = async (count = 0) => {
  const deadline = Date.now() + CLEANUP_CEILING_MS;
  while (tempFilesNow().length !== count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trydood-upload-test-"));
});

afterEach(async () => {
  await close();
  server = null;
  for (const name of tempFilesNow()) {
    await fsp.rm(path.join(tempDir, name), { force: true });
  }
});

afterAll(async () => {
  await fsp.rm(tempDir, { recursive: true, force: true });
});

describe("upload stack", () => {
  /**
   * The premise of the whole fix. If a library upgrade ever starts cleaning up
   * on success, this fails and the middleware can be reconsidered.
   */
  it("express-fileupload leaves the temp file behind without the middleware", async () => {
    await listen(buildApp({ withCleanup: false }));

    const res = await post("/upload", [
      { field: "logo", filename: "a.jpg", contentType: "image/jpeg", body: Buffer.alloc(1024, 1) },
    ]);

    expect(res.status).toBe(200);
    await settle(1);
    expect(tempFilesNow()).toHaveLength(1);
  });

  it("the middleware removes it on a successful upload", async () => {
    await listen(buildApp({ withCleanup: true }));

    const res = await post("/upload", [
      { field: "logo", filename: "a.jpg", contentType: "image/jpeg", body: Buffer.alloc(1024, 1) },
    ]);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).received).toEqual(["logo"]);
    await settle();
    expect(tempFilesNow()).toEqual([]);
  });

  it("removes every file of a multi-file upload", async () => {
    await listen(buildApp({ withCleanup: true }));

    const res = await post("/upload", [
      { field: "images", filename: "a.jpg", contentType: "image/jpeg", body: Buffer.alloc(512, 1) },
      { field: "images", filename: "b.jpg", contentType: "image/jpeg", body: Buffer.alloc(512, 2) },
      { field: "logo", filename: "c.png", contentType: "image/png", body: Buffer.alloc(512, 3) },
    ]);

    expect(res.status).toBe(200);
    await settle();
    expect(tempFilesNow()).toEqual([]);
  });

  /**
   * Without `abortOnLimit` busboy truncates instead, marks the file
   * `truncated: true`, and the handler still answers 200 — half a file stored
   * as a valid row. This asserts the 413 and, just as importantly, that it is
   * JSON: the library's default ends the response with plain text, which a
   * client parsing JSON turns into a meaningless error.
   */
  it("refuses an oversize file with a JSON 413", async () => {
    await listen(buildApp({ withCleanup: true }));

    const res = await post("/upload", [
      {
        field: "video",
        filename: "big.mp4",
        contentType: "video/mp4",
        body: Buffer.alloc(MAX_MB * 1024 * 1024 + 64 * 1024, 7),
      },
    ]);

    expect(res.status).toBe(413);
    const parsed = JSON.parse(res.body);
    expect(parsed.success).toBe(false);
    expect(parsed.message).toContain(`${MAX_MB} MB`);
  });

  it("leaves nothing behind when an upload is refused for size", async () => {
    await listen(buildApp({ withCleanup: true }));

    await post("/upload", [
      {
        field: "video",
        filename: "big.mp4",
        contentType: "video/mp4",
        body: Buffer.alloc(MAX_MB * 1024 * 1024 + 64 * 1024, 7),
      },
    ]);

    await settle();
    expect(tempFilesNow()).toEqual([]);
  });

  /**
   * ⚠️ The reason `cleanupTempFiles` is mounted **before** `fileUpload()`.
   *
   * A size abort ends the response from inside the upload middleware and never
   * calls `next()`. The library cleans up the file that tripped the limit — but
   * a smaller file earlier in the same request has already been written and is
   * not touched, and a middleware mounted afterwards never runs to catch it.
   */
  it("cleans up an earlier file when a later one trips the limit", async () => {
    await listen(buildApp({ withCleanup: true }));

    await post("/upload", [
      { field: "logo", filename: "small.jpg", contentType: "image/jpeg", body: Buffer.alloc(2048, 1) },
      {
        field: "video",
        filename: "big.mp4",
        contentType: "video/mp4",
        body: Buffer.alloc(MAX_MB * 1024 * 1024 + 64 * 1024, 7),
      },
    ]);

    await settle();
    expect(tempFilesNow()).toEqual([]);
  });
});
