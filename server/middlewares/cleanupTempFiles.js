const fs = require("fs/promises");

/**
 * Delete every temp file `express-fileupload` wrote, once the response is over.
 *
 * The library writes each uploaded file to `tempFileDir` and then deletes it
 * **only on the paths that failed** — a write error, a size abort, an empty
 * field, a stream error. On the path that succeeded it calls `complete()`,
 * which closes the write stream and nothing else
 * (`lib/tempFileHandler.js`). That is deliberate: the library expects the
 * caller to finish with `file.mv()`, which moves the file off the temp
 * directory. Nothing here calls `mv()` — every upload hands
 * `file.tempFilePath` straight to the storage provider and walks away, so on
 * success the file simply stays.
 *
 * It stayed for ten months. `tempFileDir` was `"/tmp/"`, which on Windows
 * resolves to `C:\tmp` — the drive root, not anywhere near the project — so
 * nothing about it was visible while working: 493 files and 7.70 GB, the
 * largest of them a single 2,615 MB upload that no limit had stopped.
 *
 * One middleware rather than an `fs.unlink` after each of the twenty upload
 * call sites, because the next upload endpoint someone adds is covered without
 * them having to know any of this.
 */

/**
 * `req.files` is `{ fieldName: file | file[] }` — a field repeated in the form
 * arrives as an array, a single one does not. Both shapes appear in this
 * codebase (voucher images are an array, a brand logo is not).
 */
const collectTempPaths = (files) => {
  if (!files || typeof files !== "object") return [];

  const paths = [];
  for (const value of Object.values(files)) {
    for (const file of Array.isArray(value) ? value : [value]) {
      if (file?.tempFilePath) paths.push(file.tempFilePath);
    }
  }
  return paths;
};

/**
 * ⚠️ Mount this **before** `fileUpload()`, not after.
 *
 * When a file trips the size limit, `express-fileupload` ends the response
 * itself and never calls `next()` — so a middleware mounted after it never
 * runs for that request. The library cleans up the file that tripped the
 * limit, but an earlier file in the same request has already been written and
 * is not touched. Mounted first, the listeners are attached before any of that
 * can happen, and `req.files` is read when they fire rather than now.
 */
exports.cleanupTempFiles = (req, res, next) => {
  // `finish` and `close` can both fire for one response. Sweeping twice is
  // harmless but logs a spurious failure for the second pass.
  let swept = false;

  const sweep = () => {
    if (swept) return;
    swept = true;

    for (const tempFilePath of collectTempPaths(req.files)) {
      // Fire and forget: the response has already gone out, so there is
      // nothing left to fail and nobody left to tell.
      fs.unlink(tempFilePath).catch((error) => {
        // ENOENT is the normal case for a request that failed — the library's
        // own cleanup got there first.
        if (error.code === "ENOENT") return;
        console.error(
          `[upload] temp cleanup failed: ${tempFilePath} — ${error.message}`,
        );
      });
    }
  };

  // `finish` — the response was sent. `close` — the client went away first, in
  // which case `finish` never fires and the file would otherwise be left.
  res.on("finish", sweep);
  res.on("close", sweep);

  next();
};
