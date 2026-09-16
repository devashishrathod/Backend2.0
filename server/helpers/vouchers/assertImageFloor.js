const { throwError } = require("../../utils");
const { getVoucherConfig } = require("../settings");

/**
 * A voucher must carry enough images to be worth showing (V-2).
 *
 * ### 🔴 P13 — one rule, five answers
 *
 * The same question was asked in five places and answered five different ways:
 *
 *     createVoucher.js:123          422  "At least one voucher image is required."
 *     updateVoucher.js:107          400  "At least one voucher image is required."
 *     validate.js:217 (submit)      400  "At least one image is required"      ← no full stop
 *     validate.js:283 (approval)    400  "At least one voucher image is required."
 *     VoucherVersion.js:152         —    "At least one image is required."
 *
 * Two status codes, three wordings, and none of them reading the configured
 * floor — so `minImages` could be 3 and every one of them would still let a
 * one-image voucher through. A rule enforced in five places is a rule that is
 * wrong in at least one of them.
 *
 * ### The message says the next step, not just the verdict
 *
 * "At least one voucher image is required" tells a vendor what the platform
 * wants and leaves them to work out what to do — which is easy at one image and
 * genuinely unclear at three, because they cannot see the number. So the
 * refusal carries both counts and the arithmetic:
 *
 *     A voucher needs at least 3 images — this one has 2. Add 1 more.
 *
 * ### ⚠️ Where this does **not** run
 *
 * **The model** keeps its own `>= 1`. A schema validator cannot `await` the
 * settings document, so it can only enforce the structural truth — a voucher
 * version with no images at all is corrupt regardless of what an admin has
 * configured. That floor is the last line, not this one.
 *
 * **Admin approval** keeps the structural check too, deliberately. An admin
 * raising `minImages` between a vendor's submit and their own approval would
 * otherwise find the queue full of vouchers they cannot approve and the vendor
 * cannot fix — a voucher retired from behind, which is the exact failure
 * `minImages` was designed to avoid (see the note on the schema field).
 *
 * So this runs on the three paths where the vendor is **putting images in**:
 * create, image edit, and submit-for-review.
 *
 * @param {number} imageCount   how many images the voucher will have
 * @param {object} [options]
 * @param {number} [options.minImages]  pass it when the caller already has the
 *        config, so one request does not read the settings cache twice
 */
exports.assertVoucherImageFloor = async (imageCount, { minImages } = {}) => {
  const floor = Number.isFinite(minImages)
    ? minImages
    : (await getVoucherConfig()).minImages;

  const count = Number.isFinite(imageCount) ? imageCount : 0;
  if (count >= floor) return;

  throwError(422, exports.voucherImageFloorMessage(count, floor));
};

/**
 * The one sentence, built once so the three call sites cannot drift apart again.
 *
 * ⚠️ `image` / `images` is the only thing that pluralises here. "Add 1 more" and
 * "Add 2 more" already read correctly because `more` does not take a plural —
 * a ternary guarding that produced the identical string on both branches, and a
 * mutation run caught it by replacing the ternary with its own else-branch and
 * killing nothing. Dead code that looks like care is worse than no code: the
 * next person maintains it.
 *
 * `none` rather than `0` for the empty case, because "this one has 0" reads like
 * a system talking to itself.
 */
exports.voucherImageFloorMessage = (count, floor) => {
  const need = floor - count;
  const noun = floor === 1 ? "image" : "images";
  const has = count === 0 ? "none" : String(count);

  return `A voucher needs at least ${floor} ${noun} — this one has ${has}. Add ${need} more.`;
};
