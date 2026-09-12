/**
 * The ceiling on a single uploaded file, read from the environment.
 *
 * Its own module and a pure function on purpose: the value that has to be
 * caught is the one that does not look wrong. `Number.parseInt("abc")` is
 * `NaN`, and `limits: { fileSize: NaN }` is not a small limit — it is **no
 * limit**, because every comparison against `NaN` is false. One typo in one
 * environment variable would put the server back exactly where it started,
 * silently. Zero and negatives fail for the opposite reason: they would answer
 * every upload in the product with a 413 nobody could explain.
 *
 * Separated from `index.js` so it can be tested without starting a server —
 * booting the app to check a number would connect to a cluster and start the
 * background jobs, which is far too much to set in motion for one `parseInt`.
 *
 * ⚠️ Phase 1 moves the whole environment behind a Joi schema in `configs/env/`.
 * This moves there with it, and the caller stops needing to know that the
 * value came from `process.env` at all.
 */

const DEFAULT_MAX_UPLOAD_SIZE_MB = 100;

/**
 * @param {string|undefined} raw — `process.env.MAX_UPLOAD_SIZE_MB`
 * @returns {number} whole megabytes, 1 or more
 * @throws {Error} with a message meant to be read on a failed deploy
 */
exports.resolveMaxUploadSizeMb = (raw) => {
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_MAX_UPLOAD_SIZE_MB;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `MAX_UPLOAD_SIZE_MB must be a whole number of megabytes, 1 or more. ` +
        `Got: ${JSON.stringify(raw)}`,
    );
  }

  return parsed;
};

exports.DEFAULT_MAX_UPLOAD_SIZE_MB = DEFAULT_MAX_UPLOAD_SIZE_MB;
