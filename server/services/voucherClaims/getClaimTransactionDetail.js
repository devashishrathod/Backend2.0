const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const Brand = require("../../models/Brand");
const SubBrand = require("../../models/SubBrand");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");
const {
  buildTransactionFilter,
  assertTransactionAccess,
  claimProjection,
  claimRecordProjection,
  pickByProjection,
} = require("../../helpers/transactions");
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
  const claimId = transaction.voucher?.claimId;
  if (claimId) {
    const claimDoc = await VoucherClaim.findOne({
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
  const [brand, outlet, subscriptionPlan, relationship] = await Promise.all([
    transaction.brandId
      ? Brand.findById(transaction.brandId)
          .select("brandName logo merchantId")
          .lean()
      : null,
    transaction.subBrandId
      ? SubBrand.findById(transaction.subBrandId)
          .select("uniqueId storeId address")
          .lean()
      : null,
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
     * `assertTransactionAccess` refuses with `canSeeCustomerContact: false` two
     * lines of this file above. Resolving it off `actor` rather than off
     * `transaction.customerId` is what makes that impossible rather than
     * remembered.
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
    outlet: outlet || null,
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
    },
  };
};
