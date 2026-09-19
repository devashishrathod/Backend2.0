const { throwError } = require("../../utils");

/**
 * A voucher's image floor cannot climb above its ceiling.
 *
 * ### 🔴 What the bad state does
 *
 * `minImages: 6` beside `maxImages: 5` leaves every voucher on the platform at
 * once **too empty to publish** and **too full to fix**: submit-for-review
 * refuses it for having fewer than six images, and the upload that would carry
 * it over the line is refused for exceeding five. No request escapes, and
 * nothing anywhere says why.
 *
 * ### ⚠️ Why the Joi rule is not enough on its own
 *
 * `updateSetting` merges a partial payload onto the stored document, so the two
 * numbers can arrive in **different requests**. An admin who raises the floor to
 * 6 today (legal — the ceiling is 10) and lowers the ceiling to 5 tomorrow sends
 * one field each time, and a validator looking at the payload has nothing to
 * compare against either time. This runs on the merged document, which is the
 * only place both numbers are true at once.
 *
 * The same split as `assertShowcaseFloorRule` and `assertStorageLimitRule`.
 *
 * @param {object} setting  the document **after** the payload has been merged
 */
exports.assertVoucherFloorRule = (setting) => {
  const voucher = setting?.vendor?.voucher;
  if (!voucher) return;

  const floor = voucher.minImages;
  const ceiling = voucher.maxImages;

  if (!Number.isFinite(floor) || !Number.isFinite(ceiling)) return;
  if (floor <= ceiling) return;

  throwError(
    422,
    `vendor.voucher.minImages (${floor}) cannot be more than ` +
      `maxImages (${ceiling}). A voucher cannot be required to carry more ` +
      `images than it is allowed to carry.`,
  );
};
