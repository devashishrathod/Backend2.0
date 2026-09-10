const VoucherSubBrand = require("../../models/VoucherSubBrand");
const VoucherVersion = require("../../models/VoucherVersion");

/**
 * Write `VoucherVersion.attachedSubBrandsCount` from the mappings themselves.
 *
 * ### Why a recount rather than `$inc`
 *
 * A voucher version's outlets are edited in three shapes — an initial
 * `insertMany` on create, an `updateMany` that retires the removed ones, and a
 * second `insertMany` for the added ones — and a fork copies the lot. Four
 * `$inc` call sites is four chances for the counter and the rows to disagree,
 * and a counter that disagrees with its rows is worse than no counter: it is
 * confidently wrong, and nothing errors.
 *
 * Counting is one indexed query on `voucherVersionId`, and it runs only when the
 * mappings have just changed — never on a read path. So the cheap thing and the
 * correct thing are the same thing here.
 *
 * ⚠️ **The filter must match `validateVoucherForSubmission`'s live count**
 * (`helpers/vouchers/validate.js`), which is what actually gates submission and
 * approval. If the two ever describe "attached" differently, the stored number
 * starts contradicting the rule that uses it. That live count stays — this field
 * is a denormalised copy for listings, not a replacement for it.
 *
 * @param {string|object} voucherVersionId
 * @param {object} [session]  the caller's transaction; the count must be read
 *                            inside it or it will not see the writes it follows
 * @returns {Promise<number>} the count now stored
 */
exports.syncAttachedSubBrandsCount = async (voucherVersionId, session) => {
  const query = VoucherSubBrand.countDocuments({
    voucherVersionId,
    isActive: true,
    isDeleted: false,
  });
  if (session) query.session(session);
  const attachedSubBrandsCount = await query;

  await VoucherVersion.updateOne(
    { _id: voucherVersionId },
    { $set: { attachedSubBrandsCount } },
    session ? { session } : {},
  );

  return attachedSubBrandsCount;
};
