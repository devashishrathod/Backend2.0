const { throwError } = require("../../utils");

/**
 * A surface may narrow the platform's ceiling. It may not raise it.
 *
 * ### ⚠️ Why this exists when `effectiveLimitMB` already takes the smaller one
 *
 * Reading `min(global, surface)` keeps the system **safe** whatever is stored.
 * It does not keep the admin panel **honest**: an admin who types 80 into the
 * showcase video limit while the platform ceiling is 50 gets a clean `200`, sees
 * 80 rendered back, and every upload over 50 is still refused. Nothing in that
 * loop ever says why, and the number they are looking at is a number that does
 * nothing.
 *
 * So the read path takes the smaller one and this refuses the save — belt and
 * braces, but for two different failures: one protects the platform, the other
 * protects the person.
 *
 * ### The comparison is against what will be stored, not what was sent
 *
 * `updateSetting` merges a partial payload onto the existing document, so an
 * admin can lower the global ceiling in one request and the surface limit in
 * another. Checking the payload alone would miss the first of those: dropping
 * the global from 50 to 20 while showcase still says 50 is exactly the state
 * this is here to stop.
 */

/** Which surface limit is bounded by which global one. */
const RULES = Object.freeze([
  {
    surfacePath: ["vendor", "showcase", "maxImageSizeMB"],
    globalKey: "maxImageSizeMB",
    label: "vendor.showcase.maxImageSizeMB",
    globalLabel: "storage.limits.maxImageSizeMB",
  },
  {
    surfacePath: ["vendor", "showcase", "maxVideoSizeMB"],
    globalKey: "maxVideoSizeMB",
    label: "vendor.showcase.maxVideoSizeMB",
    globalLabel: "storage.limits.maxVideoSizeMB",
  },
  /**
   * ⚠️ GIF was missing, and it is the one with its own ceiling everywhere else.
   * `getShowcaseConfig` returns `maxGifSizeMB` and `validateMediaFiles` meters
   * GIFs against it, so an admin could set the showcase GIF limit above the
   * platform's and get a clean `200` for a number the read path now cuts back.
   */
  {
    surfacePath: ["vendor", "showcase", "maxGifSizeMB"],
    globalKey: "maxGifSizeMB",
    label: "vendor.showcase.maxGifSizeMB",
    globalLabel: "storage.limits.maxGifSizeMB",
  },
]);

const read = (source, path) =>
  path.reduce((value, key) => (value == null ? value : value[key]), source);

/**
 * 🔴 The intent row has to outlive the signature.
 *
 * ### What breaks when it does not
 *
 * `presignTtlMinutes` is how long the client may **start** the upload;
 * `intentTtlMinutes` is how long the `Upload` row survives, and that row is what
 * `confirm` loads to find out whose upload this is and what it was for. The row
 * is removed by a TTL index, which does not ask whether a signature is still
 * valid.
 *
 * So `presign: 60` with `intent: 5` produces this, and only for the unlucky:
 * the vendor picks a file, a slow connection takes eight minutes, S3 accepts
 * every byte because the signature is good for an hour — and `confirm` answers
 * **404 "That upload was not found"**. The file is in the bucket and paid for.
 * The vendor is told it expired, which is true of the row and not of anything
 * they can see. Retrying works, so it reads as a flaky upload rather than a
 * setting somebody typed.
 *
 * Both fields have their own valid ranges (1–60 and 1–1440), so neither
 * validator can catch this: it is only wrong **in relation to the other**.
 */
const assertIntentOutlivesSignature = (setting) => {
  const upload = setting?.storage?.upload || {};
  const presign = upload.presignTtlMinutes;
  const intent = upload.intentTtlMinutes;

  if (!Number.isFinite(presign) || !Number.isFinite(intent)) return;
  if (intent >= presign) return;

  throwError(
    422,
    `storage.upload.intentTtlMinutes (${intent}) cannot be less than ` +
      `storage.upload.presignTtlMinutes (${presign}). The upload record has to ` +
      `outlive the permission, or an upload that starts near the end of the ` +
      `window finishes with nothing left to confirm it against.`,
  );
};

/**
 * @param {object} setting  the document **after** the payload has been merged
 */
exports.assertStorageLimitRule = (setting) => {
  const globals = setting?.storage?.limits || {};

  for (const rule of RULES) {
    const surface = read(setting, rule.surfacePath);
    const ceiling = globals[rule.globalKey];

    if (!Number.isFinite(surface) || !Number.isFinite(ceiling)) continue;
    if (surface <= ceiling) continue;

    throwError(
      422,
      `${rule.label} (${surface} MB) cannot be more than ${rule.globalLabel} ` +
        `(${ceiling} MB). Raise the platform limit first, or lower this one.`,
    );
  }

  assertIntentOutlivesSignature(setting);
};

/** Exported so a test can check the list against the schema it mirrors. */
exports.STORAGE_LIMIT_RULES = RULES;
