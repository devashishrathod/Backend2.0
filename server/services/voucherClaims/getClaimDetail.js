const VoucherClaim = require("../../models/VoucherClaim");
const Transaction = require("../../models/Transaction");
const Brand = require("../../models/Brand");
const SubBrand = require("../../models/SubBrand");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");
const {
  buildTransactionFilter,
  assertClaimAccess,
  claimProjection,
  claimRecordProjection,
  pickByProjection,
} = require("../../helpers/transactions");
const { buildClaimTimeline } = require("../../helpers/voucherClaims");
const { invoiceUrl } = require("../../helpers/notifications");
const { resolveBrandPlanName } = require("../../helpers/subscribeds");
const { getBrandRelationship } = require("../../helpers/brands");

/**
 * One claim, its payment, and its story.
 *
 * The customer's "what did I buy" page, the outlet's "what is this code" page
 * and the admin's support view are the same endpoint — the scope, the
 * projection and the timeline are all derived from the token.
 *
 * ### Openable by id **or** by claim code
 *
 * The code is what exists in the real world: printed on a screen at the counter,
 * read aloud, typed in. A surface that only accepts an ObjectId would force the
 * outlet to search for the claim before opening it, which is a second endpoint
 * and a second set of access rules to get wrong.
 *
 * Access is checked the same way either way, so a guessed code opens nothing —
 * the code narrows the lookup, it does not authorise it.
 */
exports.getClaimDetail = async (actor, { claimId, claimCode }) => {
  const query = { isDeleted: false };
  if (claimId) query._id = claimId;
  // Generated from an alphabet that already excludes look-alike characters, so
  // upper-casing is a normalisation, not a guess.
  else query.claimCode = String(claimCode).trim().toUpperCase();

  const claimDoc = await VoucherClaim.findOne(query).lean();

  // 404 when it does not exist, 403 when it is not theirs. A "not authorized"
  // answer about a row that does not exist tells a prober that it does.
  const access = assertClaimAccess(actor, claimDoc);

  const claim = pickByProjection(claimDoc, claimRecordProjection(access.role));

  /**
   * The payment, narrowed by the same rules as the payment detail endpoint.
   *
   * Read through `buildTransactionFilter` even though the id came off the claim:
   * one collection holds both money flows, and a claim whose `transactionId` was
   * ever mis-set should surface nothing rather than a subscription row.
   */
  let payment = null;
  let invoiceDownloadUrl;
  if (claimDoc.transactionId) {
    const transaction = await Transaction.findOne({
      ...buildTransactionFilter({ purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM }),
      _id: claimDoc.transactionId,
      isDeleted: false,
    }).lean();

    if (transaction) {
      // Destructured out rather than blanked: assigning `undefined` still
      // creates the key, and a vendor's projection never named it.
      const { documentToken, ...fields } = pickByProjection(
        transaction,
        claimProjection(access.role),
      );
      invoiceDownloadUrl = documentToken ? invoiceUrl(documentToken) : undefined;
      payment = { ...fields, invoiceDownloadUrl };
    }
  }

  /**
   * Same brand shape as the payment detail and the two listings — `merchantId`,
   * the live `subscriptionPlan`, and the viewer's `isFollowed` / `isAvoided`.
   * These five reads are independent, so neither costs an extra round trip.
   *
   * ⚠️ "Same shape" is a claim this file makes in prose and the app relies on.
   * Adding a key to one of these two and not the other is how a detail page
   * quietly starts carrying less than the page it was opened from — the mirror
   * of the leak `assertTransactionAccess` guards, and just as hard to notice.
   */
  const [brand, outlet, timeline, subscriptionPlan, relationship] =
    await Promise.all([
      claimDoc.brandId
        ? Brand.findById(claimDoc.brandId)
            .select("brandName logo merchantId")
            .lean()
        : null,
      claimDoc.subBrandId
        ? SubBrand.findById(claimDoc.subBrandId)
            .select("uniqueId storeId address")
            .lean()
        : null,
      // Built per audience, never filtered — see the helper for why the raw
      // audit row can never reach a page.
      buildClaimTimeline({ claimId: claimDoc._id, role: access.role }),
      resolveBrandPlanName(claimDoc.brandId),
      // The **viewer's** own follow / avoid state, resolved off `actor` rather
      // than off `claimDoc.customerId` — telling a vendor that this buyer has
      // them avoided is the same disclosure `canSeeCustomerContact: false`
      // refuses. A vendor or admin has no Customer row and gets both `false`.
      getBrandRelationship(actor, claimDoc.brandId),
    ]);

  return {
    claim,
    payment,
    brand: brand ? { ...brand, subscriptionPlan, ...relationship } : null,
    outlet: outlet || null,
    timeline,
    viewer: {
      role: access.role,
      scope: access.scope,
      canSeePlatformCosts: access.canSeePlatformCosts,
      canSeeCustomerContact: access.canSeeCustomerContact,
    },
  };
};
