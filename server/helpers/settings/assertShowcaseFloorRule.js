const { throwError } = require("../../utils");

/**
 * A section's floor cannot climb above its ceiling.
 *
 * ### 🔴 What the bad state does
 *
 * `minItemsPerSection: 6` beside `maxItemsPerSection: 5` makes every section on
 * the platform simultaneously **too small to show** and **too full to fix**: the
 * customer read hides anything under the floor, and the upload that would carry
 * a section over it is refused by the ceiling. There is no request a vendor can
 * make that escapes, and nothing anywhere would say why.
 *
 * ### ⚠️ Why the Joi rule is not enough on its own
 *
 * `updateSetting` merges a partial payload onto the stored document, so the two
 * numbers can arrive in **different requests**. An admin who raises the floor to
 * 6 today (legal — the ceiling is 15) and lowers the ceiling to 5 tomorrow sends
 * one field each time, and a validator looking at the payload has nothing to
 * compare against either time. This runs on the merged document, which is the
 * only place both numbers are true at once.
 *
 * That is the same split the storage limits use — see `assertStorageLimitRule`,
 * where the read path takes the smaller value and the write path refuses the
 * save: one protects the platform, the other protects the person typing.
 *
 * @param {object} setting  the document **after** the payload has been merged
 */
exports.assertShowcaseFloorRule = (setting) => {
  const showcase = setting?.vendor?.showcase;
  if (!showcase) return;

  const floor = showcase.minItemsPerSection;
  const ceiling = showcase.maxItemsPerSection;

  if (!Number.isFinite(floor) || !Number.isFinite(ceiling)) return;
  if (floor <= ceiling) return;

  throwError(
    422,
    `vendor.showcase.minItemsPerSection (${floor}) cannot be more than ` +
      `maxItemsPerSection (${ceiling}). A section cannot be required to hold ` +
      `more media than it is allowed to hold.`,
  );
};
