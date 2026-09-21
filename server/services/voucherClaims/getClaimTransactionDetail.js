const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
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
  assertTransactionAccess,
  claimProjection,
  claimRecordProjection,
  customerIdentityProjection,
  showsCustomerIdentity,
  pickByProjection,
} = require("../../helpers/transactions");
const {
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
 * One payment, told to whoever opened it.
 *
 * This is where the push notification lands. A customer taps "Payment received"
 * and arrives here; so does a vendor opening a row from their day, and an admin
 * chasing a support ticket. **One endpoint, three shapes** — same rule as the
 * listing, and deliberately the same projection, because a detail page that
 * shows a field the listing hides is a leak nobody notices until it is opened.
 *
 * ### Why this reads the whole row before narrowing it
 *
 * A listing projects inside the pipeline, which is strictly safer: a field never
 * loaded cannot leak. A detail cannot. Ownership lives in `customerId` and
 * `brandId`, and those are exactly the fields the vendor projection omits —
 * projecting first would mean asking "is this yours?" of a document that no
 * longer says whose it is. So: read whole, check, then narrow through
 * `pickByProjection`, which is a whitelist and therefore fails closed.
 *
 * ### Why the claim comes along
 *
 * A payment on its own is an amount and a timestamp. What the customer wants to
 * see is what they bought — the voucher name, the outlet, the claim code they
 * will show at the counter. That lives on the claim, in frozen snapshots, so it
 * still reads correctly after the voucher is republished and the outlet renamed.
 *
 * @param {object} actor          the request, carrying role and identity
 * @param {string} transactionId  the row being opened
 * @throws {CustomError} 404 when it does not exist, 403 when it is not theirs
 */
exports.getClaimTransactionDetail = async (actor, transactionId) => {
  /**
   * Scoped by `purpose` even though the id is unique.
   *
   * Without it this endpoint would happily open a **subscription** payment by
   * id — a vendor's own billing row, on the other Razorpay account, with a
   * pricing block this projection was never designed for. The id being unique
   * is not the point; the point is that one collection holds two flows.
   */
  const transaction = await Transaction.findOne({
    ...buildTransactionFilter({ purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM }),
    _id: transactionId,
    isDeleted: false,
  }).lean();

  // Throws 404 when it is missing, 403 when it belongs to someone else. A "not
  // authorized" answer about a row that does not exist tells a prober that it
  // does, which is why the order matters.
  const access = assertTransactionAccess(actor, transaction);

  /**
   * The token is pulled out rather than blanked afterwards.
   *
   * `{ ...payment, documentToken: undefined }` still **creates** the key —
   * `JSON.stringify` drops it on the way out, but anything that inspects the
   * object sees a field this audience's projection never named. Destructuring
   * leaves no key at all.
   */
  const { documentToken, ...payment } = pickByProjection(
    transaction,
    claimProjection(access.role),
  );

  /**
   * The linked claim, by the id frozen onto the transaction at order time.
   *
   * `voucher.claimId` is written when the order is opened, not when it is paid,
   * so this resolves for a pending and even a failed payment — which is exactly
   * when someone opens the notification and asks what went wrong.
   */
  let claim = null;
  let claimDoc = null;
  const claimId = transaction.voucher?.claimId;
  if (claimId) {
    claimDoc = await VoucherClaim.findOne({
      _id: claimId,
      isDeleted: false,
    }).lean();
    // Narrowed by the same per-audience rules the claim listing uses.
    if (claimDoc) claim = pickByProjection(claimDoc, claimRecordProjection(access.role));
  }

  /**
   * The brand, in the same shape the payments listing returns it.
   *
   * A detail page that shows fewer fields than the row it was opened from is
   * the mirror of the leak this file's header warns about, and just as
   * invisible — so `merchantId` and the live `subscriptionPlan` are resolved
   * here too. The plan is a third read rather than a join because ownership
   * had to be checked against the whole transaction first; it runs in the same
   * `Promise.all`, so it costs no extra round trip.
   */
  const [
    brand,
    outletDoc,
    customer,
    versionDoc,
    settlement,
    legs,
    subscriptionPlan,
    relationship,
  ] = await Promise.all([
    transaction.brandId
      ? Brand.findById(transaction.brandId)
          .select("brandName logo merchantId")
          .lean()
      : null,
    /**
     * The outlet, read **whole**.
     *
     * 🔴 This used to be `.select("uniqueId storeId address")` — and `SubBrand`
     * has no `address` path at all. The address lives on its own `Location`
     * document behind `locationId`. An inclusion projection naming a field that
     * does not exist is not an error, it is silence: `outlet.address` came back
     * absent on every call this endpoint has ever served, and nothing said so.
     *
     * Read whole and narrowed in `buildOutletSection` instead, which is a
     * whitelist over fields that are really there.
     */
    transaction.subBrandId
      ? SubBrand.findById(transaction.subBrandId).lean()
      : null,
    /**
     * Who paid, in the same shape the listing joins.
     *
     * ⚠️ Read against `access.role`, never `actor.role`. They are the same for
     * an admin and a vendor, and deliberately different for the person who
     * bought: `assertTransactionAccess` answers `ROLES.CUSTOMER` for whoever
     * owns the row. Using the raw token role here would hand a customer's own
     * contact block back to them on every payment they open — harmless today,
     * and exactly the kind of "which role variable did this line mean" drift
     * that stops being harmless the moment a fourth role exists.
     *
     * `showsCustomerIdentity` is false for them, so this is `null` and the key
     * is still present — a client reads "not shown", not "missing".
     */
    showsCustomerIdentity(access.role) && transaction.customerId
      ? Customer.findById(transaction.customerId)
          .select(customerIdentityProjection(access.role))
          .lean()
      : null,
    /**
     * The voucher version, read whole — `versionCode` is on no other document.
     *
     * The narrow `voucherVersion` block the listing returns is derived from this
     * below, so the two cannot disagree about what a version code is.
     */
    transaction.voucher?.voucherVersionId
      ? VoucherVersion.findById(transaction.voucher.voucherVersionId).lean()
      : null,
    /**
     * ---------------- the vendor payout ----------------
     *
     * 🔴 `settlementId`, **not** `razorpaySettlementId`. Two different things
     * are called a settlement on this row: this one is Trydood paying the
     * vendor; `razorpaySettlementId` is Razorpay paying Trydood, which is our
     * own banking and appears only in the admin's payment block.
     *
     * Absent for the first day or two of any payment's life — eligibility
     * begins only once the gateway has settled it to us — so this is routinely
     * `null` and the section says so in words rather than with empty fields.
     */
    transaction.settlementId
      ? Settlement.findOne({
          _id: transaction.settlementId,
          isDeleted: false,
        }).lean()
      : null,
    /**
     * Every leg, oldest first.
     *
     * ⚠️ A list, not a field. A large payout can be split across two NEFTs and a
     * bounced one is retried as a **new** leg — which is the whole reason a
     * single `payoutUtr` column was never enough.
     */
    transaction.settlementId
      ? PayoutLeg.find({
          payoutType: PAYOUT_TYPE.SETTLEMENT,
          settlementId: transaction.settlementId,
          isDeleted: false,
        })
          .sort({ legNumber: 1 })
          .lean()
      : [],
    resolveBrandPlanName(transaction.brandId),
    /**
     * `isFollowed` / `isAvoided` — **the viewer's own**, never the buyer's.
     *
     * This endpoint has three audiences, so "does this customer follow the
     * brand" has to be asked about somebody. It is asked about whoever opened
     * the page: a customer reading their own receipt sees their own state and
     * can follow the brand from it, and a vendor or admin — who has no Customer
     * row — gets `false` for both.
     *
     * ⚠️ Not the paying customer's state. Answering that would tell a vendor
     * "this buyer has you avoided", which is the same class of disclosure
     * `assertTransactionAccess` refuses with `canSeeCustomerPhone: false`.
     * Resolving it off `actor` rather than off `transaction.customerId` is what
     * makes that impossible rather than remembered.
     *
     * ⚠️ The flag named here used to be `canSeeCustomerContact`, which is `true`
     * for the brand side now that they get the buyer's email. The reasoning did
     * not change — a buyer's *opinion* of a brand was never a contact detail —
     * but the flag that still carries the refusal is the other one.
     */
    getBrandRelationship(actor, transaction.brandId),
  ]);

  /**
   * The Download Invoice button.
   *
   * Built from the token rather than the Cloudinary URL because the same link
   * goes into a WhatsApp template whose URL button Meta approved against a fixed
   * base — only the last segment may vary. `invoiceUrl` returns `undefined` when
   * `PUBLIC_API_URL` is unset, so the client omits the button rather than
   * rendering a dead one.
   *
   * Gated on the projection, not re-decided here: a vendor's projection carries
   * no `documentToken`, so they get no link — the customer's tax invoice carries
   * the customer's own details.
   */
  const invoiceDownloadUrl = documentToken ? invoiceUrl(documentToken) : undefined;

  /**
   * The outlet's address, which is the one read that cannot join the batch
   * above: `locationId` is on the outlet, so it is not known until that read
   * has returned. One extra round trip on a detail endpoint, and the honest
   * alternative — an aggregation — would mean this service stopped reading the
   * document whole, which is what the ownership check needs.
   */
  const location = outletDoc?.locationId
    ? await Location.findById(outletDoc.locationId).lean()
    : null;

  return {
    // The raw token is an unauthenticated bearer credential for the PDF. The
    // assembled URL is the entire use for it; returning the token as well just
    // gives a client a second thing to leak.
    payment: { ...payment, invoiceDownloadUrl },
    claim,
    // Spread onto the brand rather than returned beside it, so the key sits
    // exactly where every other endpoint puts it. The same is true of the two
    // relationship flags: the brand directory and the brand profile both carry
    // them on the brand, and a receipt that put them somewhere else would make
    // the app read the same fact from two shapes.
    brand: brand ? { ...brand, subscriptionPlan, ...relationship } : null,
    /**
     * ⚠️ Kept at exactly the three fields it has always carried.
     *
     * The full outlet is `outletDetail` below. Widening this one in place would
     * have been tidier and would also have changed a shape three panels already
     * read — so the old key keeps its old meaning and the new one carries the
     * new answer. `address` is gone from it because it was never in it: see the
     * read above.
     */
    outlet: outletDoc
      ? {
          _id: outletDoc._id,
          uniqueId: outletDoc.uniqueId,
          storeId: outletDoc.storeId,
        }
      : null,
    /**
     * Who paid, and which version of the voucher they bought.
     *
     * Beside `payment` rather than inside it, exactly where `brand` and `outlet`
     * already sit — the listing nests all four on the row because a row **is**
     * the payment, and this endpoint returns the payment as one member of a
     * bundle. Putting these two in a different place than their two siblings
     * would make the app read the same fact from two shapes.
     *
     * `null` for a customer reading their own payment, and for a row whose
     * customer or version has since been removed from the database.
     */
    customer: customer || null,
    voucherVersion: versionDoc
      ? {
          _id: versionDoc._id,
          versionCode: versionDoc.versionCode,
          versionNumber: versionDoc.versionNumber,
        }
      : null,

    /**
     * ---------------- the sections ----------------
     *
     * Added **beside** the keys above rather than replacing them. Every one of
     * these answers a question this endpoint could not answer before, and every
     * one of them decides its own audience inside
     * `helpers/voucherClaims/buildClaimDetailSections.js` — one file, so a rule
     * cannot be applied here and forgotten on the claim detail next door.
     *
     * There is deliberate overlap with the older keys: `pricing.billAmount` and
     * `payment.voucher.billAmount` are the same number. That is the price of not
     * breaking three panels at once, and the older keys are the ones to retire
     * once they are.
     */
    outletDetail: buildOutletSection(outletDoc, location, access.role),
    voucher: buildVoucherSection(claimDoc, versionDoc, access.role),
    pricing: buildPricingSection(claimDoc, transaction, access.role),
    paymentInfo: buildPaymentInfoSection(
      transaction,
      { brand, outlet: outletDoc },
      access.role,
    ),
    /**
     * 🔴 Trydood paying the vendor — never Razorpay paying Trydood.
     *
     * The distinction is the one thing about this section that must not blur:
     * `razorpaySettlementId` and `fundsReceivedAt` describe money reaching
     * **our** bank and appear in `paymentInfo` for an admin only.
     */
    settlement: buildSettlementSection(transaction, settlement, legs, access.role),
    /**
     * What the caller may render, stated rather than inferred.
     *
     * A client that has to guess "am I the vendor here?" from which fields came
     * back will guess wrong the first time a field is legitimately empty.
     */
    viewer: {
      role: access.role,
      scope: access.scope,
      canSeePlatformCosts: access.canSeePlatformCosts,
      canSeeCustomerContact: access.canSeeCustomerContact,
      // ⚠️ The precise one. `canSeeCustomerContact` is true for the brand side
      // now that they get an email; this is what still says "no number".
      canSeeCustomerPhone: access.canSeeCustomerPhone,
    },
  };
};
