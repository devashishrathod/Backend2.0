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
]);

const read = (source, path) =>
  path.reduce((value, key) => (value == null ? value : value[key]), source);

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
};

/** Exported so a test can check the list against the schema it mirrors. */
exports.STORAGE_LIMIT_RULES = RULES;
