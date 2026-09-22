const VoucherClaim = require("../../models/VoucherClaim");
const Transaction = require("../../models/Transaction");
const Brand = require("../../models/Brand");
const SubBrand = require("../../models/SubBrand");
const Customer = require("../../models/Customer");
const VoucherVersion = require("../../models/VoucherVersion");
const Location = require("../../models/Location");
const Settlement = require("../../models/Settlement");
const PayoutLeg = require("../../models/PayoutLeg");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");
const { PAYOUT_TYPE } = require("../../constants/payout");
const {
  buildTransactionFilter,
  assertClaimAccess,
  claimProjection,
  claimRecordProjection,
  customerIdentityProjection,
  showsCustomerIdentity,
  pickByProjection,
} = require("../../helpers/transactions");
const {
  buildClaimTimeline,
  buildOutletSection,
  buildVoucherSection,
  buildPricingSection,
  buildPaymentInfoSection,
  buildSettlementSection,
} = require("../../helpers/voucherClaims");
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
  // Kept in scope: the sections below are built from the whole row, not from the
  // narrowed `payment` — the pricing section needs `gatewayFee` to decide
  // whether an admin may read it, and a vendor's `payment` no longer has it.
  let transaction = null;
  if (claimDoc.transactionId) {
    transaction = await Transaction.findOne({
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
  const [
    brand,
    outletDoc,
    customer,
    versionDoc,
    settlement,
    legs,
    timeline,
    subscriptionPlan,
    relationship,
  ] = await Promise.all([
    claimDoc.brandId
      ? Brand.findById(claimDoc.brandId)
          .select("brandName logo merchantId")
          .lean()
      : null,
    /**
     * Read whole. 🔴 This was `.select("uniqueId storeId address")` and
     * `SubBrand` has no `address` path — the address is a separate `Location`
     * document behind `locationId`, so that key came back absent on every call
     * and nothing reported it. See `buildOutletSection`.
     */
    claimDoc.subBrandId ? SubBrand.findById(claimDoc.subBrandId).lean() : null,
    /**
     * Who claimed it, and which version they claimed.
     *
     * ⚠️ Keyed off `access.role`, not `actor.role` — `assertClaimAccess`
     * answers `ROLES.CUSTOMER` for whoever owns the claim, and that is the role
     * the projection has to be built from.
     *
     * This is also the endpoint an outlet opens by **claim code** at the
     * counter, which is precisely where "who is this" has to be answerable: the
     * alternative is a staff member reading an ObjectId back to the person
     * standing in front of them.
     *
     * Neither read filters `isDeleted`. A claim is a business record of
     * something that happened; a closed account or a deleted voucher version
     * does not unmake it, and blanking the name here would leave the counter
     * with a row it cannot identify.
     */
    showsCustomerIdentity(access.role) && claimDoc.customerId
      ? Customer.findById(claimDoc.customerId)
          .select(customerIdentityProjection(access.role))
          .lean()
      : null,
    claimDoc.voucherVersionId
      ? VoucherVersion.findById(claimDoc.voucherVersionId).lean()
      : null,
    /**
     * ---------------- the vendor payout ----------------
     *
     * 🔴 Off the **transaction's** `settlementId`, not the claim's — a claim has
     * none. This is Trydood paying the vendor; `razorpaySettlementId` is
     * Razorpay paying Trydood and is a different thing entirely.
     *
     * `transaction` is resolved above this block, so both reads are `null` /
     * `[]` for a claim that has no payment yet — which is every PENDING claim.
     */
    transaction?.settlementId
      ? Settlement.findOne({
          _id: transaction.settlementId,
          isDeleted: false,
        }).lean()
      : null,
    // A list, never one field: a payout can be split and a bounced one retried.
    transaction?.settlementId
      ? PayoutLeg.find({
          payoutType: PAYOUT_TYPE.SETTLEMENT,
          settlementId: transaction.settlementId,
          isDeleted: false,
        })
          .sort({ legNumber: 1 })
          .lean()
      : [],
    // Built per audience, never filtered — see the helper for why the raw
    // audit row can never reach a page.
    buildClaimTimeline({ claimId: claimDoc._id, role: access.role }),
    resolveBrandPlanName(claimDoc.brandId),
    // The **viewer's** own follow / avoid state, resolved off `actor` rather
    // than off `claimDoc.customerId` — telling a vendor that this buyer has
    // them avoided is the same class of disclosure `canSeeCustomerPhone: false`
    // refuses. A vendor or admin has no Customer row and gets both `false`.
    getBrandRelationship(actor, claimDoc.brandId),
  ]);

  // The address, which cannot join the batch above: `locationId` is on the
  // outlet and is not known until that read has returned.
  const location = outletDoc?.locationId
    ? await Location.findById(outletDoc.locationId).lean()
    : null;

  return {
    claim,
    payment,
    brand: brand ? { ...brand, subscriptionPlan, ...relationship } : null,
    // ⚠️ Still the three fields it has always carried — the full outlet is
    // `outletDetail`. `address` is gone because it was never really there.
    outlet: outletDoc
      ? {
          _id: outletDoc._id,
          uniqueId: outletDoc.uniqueId,
          storeId: outletDoc.storeId,
        }
      : null,
    // The same two blocks the payment detail returns, in the same place. These
    // two endpoints are read side by side by the same screens, and the prose
    // above promises they carry the same shape.
    customer: customer || null,
    voucherVersion: versionDoc
      ? {
          _id: versionDoc._id,
          versionCode: versionDoc.versionCode,
          versionNumber: versionDoc.versionNumber,
        }
      : null,

    /**
     * The same five sections the payment detail returns, built by the same
     * helpers and in the same order.
     *
     * ⚠️ This is the "same shape" promise this file's header makes, and it is
     * the reason these are here at all rather than only on the payment detail
     * the change was asked for. The two pages are opened by the same screens; a
     * section on one and not the other is exactly the drift the header warns
     * about, and it is invisible until somebody opens both.
     */
    outletDetail: buildOutletSection(outletDoc, location, access.role),
    voucher: buildVoucherSection(claimDoc, versionDoc, access.role),
    pricing: buildPricingSection(claimDoc, transaction, access.role),
    paymentInfo: buildPaymentInfoSection(
      transaction,
      { brand, outlet: outletDoc },
      access.role,
    ),
    settlement: buildSettlementSection(transaction, settlement, legs, access.role),
    timeline,
    viewer: {
      role: access.role,
      scope: access.scope,
      canSeePlatformCosts: access.canSeePlatformCosts,
      canSeeCustomerContact: access.canSeeCustomerContact,
      canSeeCustomerPhone: access.canSeeCustomerPhone,
    },
  };
};
