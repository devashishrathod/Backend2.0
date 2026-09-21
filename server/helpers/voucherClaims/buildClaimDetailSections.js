const { ROLES } = require("../../constants");
const { PAYOUT_LEG_STATUS } = require("../../constants/payout");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
// By file, not through the barrel: `helpers/settlements/index.js` pulls in the
// claim machinery (`settlementClaims` → `helpers/transactions`), and this module
// is required from a service that the same chain reaches. The read pipeline
// itself requires only constants, so it is safe to take on its own.
const {
  settlementProjection,
  presentSettlement,
} = require("../settlements/buildSettlementReadPipeline");
const { pickByProjection } = require("../transactions/buildClaimReadPipeline");

/**
 * ---------------------------------------------------------------------------
 * The sections a claim payment is read in.
 * ---------------------------------------------------------------------------
 *
 * `GET /voucher-claims/payments/:transactionId` used to answer *"how much, and
 * is it verified"*. It is opened to answer a great deal more than that — which
 * outlet took it, what was sold, how the customer actually paid, and above all
 * **which payout it ended up in and whether that payout has landed**. Every one
 * of those lived one join away and none of them were made.
 *
 * ### Why a section builder rather than a wider projection
 *
 * `claimProjection` narrows **one document**. These sections each assemble a
 * different document — the outlet and its address, the voucher version, the
 * settlement and its payout legs — so there is nothing for a single projection
 * to narrow. Putting them here keeps the one rule that matters in one place:
 * **who may read what is decided by role, once, per section.**
 *
 * ### The rule every section follows
 *
 * A **whitelist**, never a delete-list. `delete row.gatewayFee` has to be
 * updated every time a model grows a field, and the day somebody forgets is the
 * day a vendor reads our margin. A whitelist fails the other way: a new field is
 * invisible until somebody names it.
 *
 * ### 🔴 What the brand side never reads, in any section
 *
 * | Field | Why |
 * |---|---|
 * | `platformPromoCost` | our share of a campaign — a commercial disclosure |
 * | `gatewayFee` · `vendorGatewayFee` · `netReceived` | what Razorpay charged **us** |
 * | customer `mobile` · `whatsappNumber` | see `customerIdentityProjection` |
 *
 * ⚠️ `commissionAmount` and friends are **not** on that list, deliberately. A
 * vendor already sees the commission on their settlement statement
 * (`settlementProjection`'s base block), and a per-payment view that hid it
 * would contradict the statement built from those same payments. What is hidden
 * is what we *earn or spend*, never what we *deduct from them* — a deduction
 * they cannot see is a deduction they escalate.
 */

/**
 * ⚠️ Every branch below tests for `CUSTOMER` or `ADMIN` explicitly, and never
 * for "is this the brand side".
 *
 * A helper named `isBrandSide` used to sit here and was deleted unused, which is
 * the right outcome: a rule written as `if (isBrandSide(role))` decides nothing
 * about the roles it does not name, and the fall-through is where a role that
 * was never considered silently inherits somebody else's shape. That is exactly
 * how `settlementProjection` — correct for the two roles it was written for —
 * hands a `CUSTOMER` the vendor's projection in full, and why
 * `buildSettlementSection` has to refuse them by name.
 */

/** Strip keys whose value is `undefined`, so an unset field is absent rather
 * than an explicit `null` that reads as "we know it is empty". */
const compact = (object) => {
  const out = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
};

/* ==========================================================================
 * 1. The outlet
 * ======================================================================== */

/**
 * Where the sale happened, in full.
 *
 * ### 🔴 `outlet.address` was never a field
 *
 * Both detail services selected `"uniqueId storeId address"` off `SubBrand` —
 * and `SubBrand` **has no `address` path**. The address lives behind
 * `locationId` on its own document. So `outlet.address` came back absent on
 * every single call, and nothing anywhere said so: an inclusion projection
 * naming a path that does not exist is not an error, it is silence. The same
 * shape as the `email`/`contact` promise on `claimProjection`.
 *
 * ⚠️ No `isDeleted` filter on either read. An outlet can close and a claim
 * still has to say where it was bought — and the vendor is still settled for it.
 *
 * @param {object} subBrand  the outlet document, read whole
 * @param {object} location  the `Location` its `locationId` points at
 */
exports.buildOutletSection = (subBrand, location, role) => {
  if (!subBrand) return null;

  const section = compact({
    _id: subBrand._id,
    uniqueId: subBrand.uniqueId,
    storeId: subBrand.storeId,
    // The field the panels call "type". `FRANCHISE` or `OUTLET`.
    outletType: subBrand.outletType,
    description: subBrand.description,
    logo: subBrand.logo,
    coverImage: subBrand.coverImage,
    /**
     * The outlet's own contact, not a person's.
     *
     * A counter's phone number and mailbox are business details — they are on
     * the storefront. This is not the disclosure `canSeeCustomerContact`
     * governs, which is about the **buyer**.
     */
    email: subBrand.email,
    mobile: subBrand.mobile,
    whatsappNumber: subBrand.whatsappNumber,
    // `[longitude, latitude]`, and **absent** when nobody has set an address —
    // never `[0, 0]`, which is a real point in the Gulf of Guinea. See the
    // model.
    geo: subBrand.geo,
    address: location
      ? compact({
          _id: location._id,
          addressLine1: location.addressLine1,
          addressLine2: location.addressLine2,
          landmark: location.landmark,
          city: location.city,
          district: location.district,
          state: location.state,
          country: location.country,
          zipcode: location.zipcode,
          formattedAddress: location.formattedAddress,
          geo: location.geo,
        })
      : null,
  });

  if (role === ROLES.CUSTOMER) return section;

  // The brand side and an admin also get the operational fields. A customer has
  // no use for when an outlet joined or whether it is currently switched off.
  return compact({
    ...section,
    brandId: subBrand.brandId,
    joinedDate: subBrand.joinedDate,
    workHoursId: subBrand.workHoursId,
    isActive: subBrand.isActive,
    ...(role === ROLES.ADMIN ? { userId: subBrand.userId } : {}),
  });
};

/* ==========================================================================
 * 2. The voucher
 * ======================================================================== */

/**
 * What was sold — frozen and live, side by side and never confused.
 *
 * - `snapshot` is `voucherSnapshot`: the name and the picture **as the customer
 *   saw them** at the moment they tapped buy. It survives a republish, a rename
 *   and a delete, which is the whole reason it exists.
 * - `offer` is `offerSnapshot`: the exact offer used, with its full terms.
 *
 *   🔴 **This was returned to nobody.** `claimRecordProjection` names
 *   `voucherSnapshot`, `brandSnapshot` and `outletSnapshot` and simply never
 *   named this one — so *"which offer did this sale actually use, and on what
 *   terms"* had no answer on any surface, for any audience, while the data sat
 *   frozen on the claim the entire time.
 *
 * - `version` is the **live** `VoucherVersion`. It answers "what is this
 *   voucher today", which is a different question and must not be frozen.
 *
 * ⚠️ The two are deliberately both present. Reconciling a September sale needs
 * the frozen copy; deciding what to do about it needs today's record.
 */
const VERSION_PUBLIC_FIELDS = [
  "_id",
  "voucherId",
  "brandId",
  "versionCode",
  "versionNumber",
  "name",
  "description",
  "tags",
  "categoryId",
  "subCategoryId",
  "status",
  "startAt",
  "endAt",
  "images",
  "offers",
  "publishedAt",
];

/** The vendor owns this voucher and sees all of it on their own pages already. */
const VERSION_OWNER_FIELDS = [
  "attachedSubBrandsCount",
  "pausedAt",
  // The vendor's own note — "out of stock until Monday" — not a moderation
  // verdict. `rejectionReason` is the other kind and is admin-only below.
  "pauseReason",
  "archivedAt",
  "expiredAt",
  "isActive",
  "isDeleted",
  "createdAt",
];

/** Moderation history. A verdict about the vendor, for the people who made it. */
const VERSION_ADMIN_FIELDS = [
  "submittedAt",
  "submittedBy",
  "reviewedAt",
  "reviewedBy",
  "approvedAt",
  "approvedBy",
  "rejectedAt",
  "rejectedBy",
  "rejectionReason",
  "deletedAt",
  "deletedBy",
  "deleteReason",
  "createdBy",
  "isImmutable",
];

const pickFields = (source, fields) => {
  const out = {};
  for (const field of fields) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  return out;
};

exports.buildVoucherSection = (claim, version, role) => {
  if (!claim) return null;

  const fields = [...VERSION_PUBLIC_FIELDS];
  if (role !== ROLES.CUSTOMER) fields.push(...VERSION_OWNER_FIELDS);
  if (role === ROLES.ADMIN) fields.push(...VERSION_ADMIN_FIELDS);

  return compact({
    voucherId: claim.voucherId,
    voucherVersionId: claim.voucherVersionId,
    versionNumber: claim.versionNumber,
    // Frozen at claim time. Absent on claims made before the snapshot grew its
    // picture fields — read every key with `?? null`.
    snapshot: claim.voucherSnapshot,
    offer: claim.offerSnapshot,
    version: version ? pickFields(version, fields) : null,
  });
};

/* ==========================================================================
 * 3. The pricing
 * ======================================================================== */

/**
 * The whole frozen price, split by who may read which part.
 *
 * `VoucherClaim.pricing` is the copy an invoice is regenerated from and a
 * dispute reconstructed from — every figure produced by
 * `calculateVoucherPricing` and never recomputed. It carries roughly forty
 * fields and, until now, the brand side saw four of them.
 *
 * ### The three bands
 *
 * | Band | Who | What |
 * |---|---|---|
 * | **the sale** | everyone | bill, offer terms, promo, net bill, fee, tax, total |
 * | **the vendor's side** | vendor · admin | their promo share, commission, payable |
 * | **our side** | admin only | `platformPromoCost`, `gatewayFee`, `netReceived` |
 *
 * ⚠️ `convenienceFee` and the GST block are in the **first** band, including for
 * the vendor. That fee is charged to the *customer* and is printed on the
 * customer's invoice; it is not a deduction from the vendor and is not our
 * margin on their sale. A vendor who can see `totalPayable` but not the fee
 * inside it has an ₹810 figure that does not reconcile to their ₹800 supply.
 *
 * ⚠️ The fee **slab** rides along with it — `feeSlabSize`, `feePerSlab`,
 * `feeMaxFee`. Slabs are admin config with no history at all, so *"why ₹15?"*
 * is answerable only from the copy frozen onto the claim.
 */
const PRICING_SALE_FIELDS = [
  "currency",
  "billAmount",
  // The offer, with the terms it was applied under — not just the amount.
  "offerId",
  "offerTitle",
  "offerDiscountType",
  "offerDiscountValue",
  "offerMinBillAmount",
  "offerMaxDiscountAmount",
  "offerDiscount",
  // The promo, with the base it came off, so the clamp can be re-checked rather
  // than re-derived from figures that have since moved.
  "promoCode",
  "promoCodeId",
  "promoAppliesTo",
  "promoBase",
  "promoDiscount",
  "netBill",
  // Trydood's fee and the slab it came from.
  "convenienceFee",
  "feeSlabSize",
  "feePerSlab",
  "feeMaxFee",
  // GST on that fee only — the vendor's supply is the vendor's own tax matter.
  "isGstEnabled",
  "gstPercentage",
  "isGstInclusive",
  "taxType",
  "cgst",
  "sgst",
  "igst",
  "gstAmount",
  "taxOnTop",
  "sacCode",
  "placeOfSupplyState",
  "placeOfSupplyStateCode",
  "totalPayable",
  "amountInPaise",
  "youSaved",
];

const PRICING_VENDOR_FIELDS = [
  // Their half of a co-funded promo. `vendorPromoCost + platformPromoCost ===
  // promoDiscount`, always — so this is exactly the part they funded.
  "vendorPromoCost",
  "commissionPercent",
  "commissionAmount",
  "commissionTax",
  // What the settlement actually deducts. Shown for the same reason the
  // statement shows it: a deduction they cannot see is one they escalate.
  "commissionDeduction",
  "vendorPayable",
];

/** 🔴 Our margin. Never the brand side, in any section, on any endpoint. */
const PRICING_PLATFORM_FIELDS = ["platformPromoCost"];

exports.buildPricingSection = (claim, transaction, role) => {
  const pricing = claim?.pricing;
  if (!pricing) return null;

  const fields = [...PRICING_SALE_FIELDS];
  if (role !== ROLES.CUSTOMER) fields.push(...PRICING_VENDOR_FIELDS);
  if (role === ROLES.ADMIN) fields.push(...PRICING_PLATFORM_FIELDS);

  const section = pickFields(pricing, fields);

  /**
   * What the sale cost **us** to collect, from the transaction rather than the
   * claim — Razorpay reports it at capture, long after the price was frozen.
   *
   * 🔴 Admin only, and this is the line that decides it. `gatewayFee` is the MDR
   * Razorpay charged Trydood and `netReceived` is what actually reached our
   * bank; a vendor knowing either knows our cost of doing business on their
   * sale. The refusal is stated in three other places
   * (`assertTransactionAccess`, `claimProjection`, `getSettlementTransactions`)
   * and this is the fourth surface that could have leaked it.
   */
  if (role === ROLES.ADMIN && transaction) {
    section.gatewayFee = transaction.gatewayFee;
    section.gatewayFeeBearer = transaction.gatewayFeeBearer;
    section.vendorGatewayFee = transaction.vendorGatewayFee;
    section.netReceived = transaction.netReceived;
  }

  /**
   * What has come back out, for every audience.
   *
   * A payment with a refund against it and no sign of one on the page is the
   * single most confusing thing this endpoint can show — to a vendor
   * reconciling a payout, to a customer who was told they had been refunded,
   * and to support looking at both.
   */
  if (transaction) {
    section.amountRefunded = transaction.amountRefunded;
    section.isRefunded = transaction.isRefunded;
    section.refundStatus = transaction.refundStatus;
  }

  return compact(section);
};

/* ==========================================================================
 * 4. The payment itself
 * ======================================================================== */

/**
 * How the money arrived, and where it went.
 *
 * ### 🔴 Google Pay and PhonePe cannot be told apart, and this does not pretend
 *
 * Razorpay reports a UPI payment as `method: "upi"` with a `vpa` such as
 * `asha@okhdfcbank`. **The app is not in the payload.** The handle after the
 * `@` identifies the PSP bank, and by convention `@ok*` is issued through
 * Google Pay and `@ybl` through PhonePe — but that is a convention, not a fact,
 * and it changes when a PSP re-partners.
 *
 * So `vpaHandle` is published as what it is — the handle — and **no app name is
 * invented from it**. A payment screen naming the wrong app is worse than one
 * saying "UPI": the first is a fact the reader will act on, the second is an
 * honest limit. If an app name is ever genuinely needed, it has to come from a
 * field Razorpay actually sends, not from this string.
 *
 * ⚠️ `walletProvider` is **not** the answer either. It is set only when
 * `method` is `wallet` — a PhonePe *wallet* payment, not PhonePe-the-UPI-app.
 *
 * ### Card details are not stored
 *
 * `mapPayment` persists `cardId` and nothing else — no network, no last four,
 * no issuer. Those exist in Razorpay's payload and are simply not written, so
 * they cannot be shown for any payment ever taken. Adding them is a change to
 * the settle path and would fill **new** payments only; historical rows would
 * stay empty for ever. Not done here, deliberately — a money-path change does
 * not belong inside a read.
 *
 * ⚠️ `vpa` is the buyer's UPI address, which is personal to them. It is
 * released to the brand side under the same decision that released their email,
 * and it is the reason that decision is worth revisiting rather than extended
 * quietly: a VPA is a banking identifier, not a mailbox.
 */
exports.buildPaymentInfoSection = (transaction, { brand, outlet } = {}, role) => {
  if (!transaction) return null;

  const method = compact({
    type: transaction.paymentMethod,
    // Only ever set when `type` is `wallet`. See the header.
    wallet: transaction.walletProvider,
    vpa: transaction.vpa,
    // The PSP handle, stated as a handle. No app name is derived from it.
    vpaHandle:
      typeof transaction.vpa === "string" && transaction.vpa.includes("@")
        ? transaction.vpa.split("@").pop()
        : undefined,
    // Net-banking bank code.
    bank: transaction.bank,
    cardId: transaction.cardId,
    isInternational: transaction.isInternational,
  });

  const section = compact({
    transactionId: transaction._id,
    // The reference a customer sees on their bank statement and quotes to
    // support, and the one this row is reconciled by.
    gatewayPaymentId: transaction.razorpayPaymentId,
    gatewayOrderId: transaction.razorpayOrderId,
    invoiceNumber: transaction.invoiceId,
    // The acquiring bank's own reference — a different number from Razorpay's,
    // and the one a bank will ask for.
    acquirerTransactionId: transaction.acquirerData?.transaction_id,
    amount: transaction.amount,
    currency: transaction.currency,
    status: transaction.status,
    verified: transaction.verified,
    method,
    // Three different moments, and they are routinely days apart.
    createdAt: transaction.createdAt,
    // When the payment was captured and the claim redeemed.
    paidAt: transaction.verifiedAt,
    // When Razorpay actually settled it into **our** bank. Settlement
    // eligibility keys on this, not on `paidAt`, which is why the brand side
    // sees it: it is the clock their payout runs on.
    fundsReceivedAt: transaction.fundsReceivedAt,
    /**
     * Who received it.
     *
     * ⚠️ The brand and the outlet, not Trydood. `gatewayAccount` — which of our
     * two Razorpay accounts took the money — is plumbing, and admin-only below.
     */
    paidTo: compact({
      brandId: transaction.brandId,
      brandName: brand?.brandName,
      merchantId: brand?.merchantId,
      outletId: transaction.subBrandId,
      storeId: outlet?.storeId,
      outletUniqueId: outlet?.uniqueId,
    }),
  });

  if (role === ROLES.ADMIN) {
    return compact({
      ...section,
      gatewayAccount: transaction.gatewayAccount,
      gateway: transaction.gateway,
      acquirerData: transaction.acquirerData,
      authorizedAt: transaction.authorizedAt,
      settlementStage: transaction.settlementStage,
      razorpaySettlementId: transaction.razorpaySettlementId,
      // Why it failed, when it did. Staff-facing: the customer is shown a
      // sentence, not a gateway error code.
      errorCode: transaction.errorCode,
      errorDescription: transaction.errorDescription,
      errorReason: transaction.errorReason,
      errorSource: transaction.errorSource,
      errorStep: transaction.errorStep,
      duplicateCapturePaymentIds: transaction.duplicateCapturePaymentIds,
    });
  }

  return section;
};

/* ==========================================================================
 * 5. The settlement — ours to the vendor, never Razorpay's to us
 * ======================================================================== */

/**
 * Which payout this payment ended up in, and whether it has landed.
 *
 * ### 🔴 The vendor payout, not the gateway settlement
 *
 * There are two entirely different things called "settlement" on this
 * transaction and they must never be confused:
 *
 * | | What it is |
 * |---|---|
 * | `Settlement` + `PayoutLeg` | **this** — Trydood paying the vendor |
 * | `razorpaySettlementId` · `fundsReceivedAt` | Razorpay paying **Trydood** |
 *
 * The second is our own banking. It appears in the payment section for an admin
 * because reconciliation needs it, and it is never what this section reports.
 *
 * ### ⚠️ There is rarely one payout reference
 *
 * A large payout can be split across two NEFTs and a bounced one is retried as a
 * **new leg** — so "the settlement transaction id" is a list, not a field. That
 * is precisely why `PayoutLeg` exists instead of a `payoutUtr` column: one
 * field would have silently lost the second UTR.
 *
 * ### The common case is "not yet"
 *
 * A payment is eligible only after Razorpay has settled it to us, so for the
 * first day or two `settlementId` is simply absent. That is reported as a state
 * with a reason, never as an empty object — a panel showing blank fields where a
 * payout reference belongs reads as a fault.
 *
 * @param {object} transaction  the payment, read whole
 * @param {object} settlement   the `Settlement` it was claimed by, or null
 * @param {Array}  legs         that settlement's payout legs, oldest first
 */
exports.buildSettlementSection = (transaction, settlement, legs = [], role) => {
  if (!transaction) return null;

  /**
   * 🔴 A customer gets none of this, and the reason is not squeamishness.
   *
   * This section is money moving between Trydood and the **vendor**. It carries
   * the payout's `netPayable` and `grossCollected` — figures for the brand's
   * whole period, not for this one sale — and a `bank` block naming the
   * vendor's account holder, masked number and IFSC.
   *
   * ⚠️ And it would have leaked by **omission**, not by a decision:
   * `settlementProjection` branches on `ADMIN` and falls through to the vendor
   * shape for everything else, so a `ROLES.CUSTOMER` passed into it is handed
   * the vendor's projection in full. Nothing in that function is wrong — it was
   * written for an endpoint only two roles can reach. This one has three, and
   * the third had to be refused here rather than assumed.
   *
   * What a customer legitimately asks — "has my refund come back" — is
   * `pricing.amountRefunded`, and they get that.
   */
  if (role === ROLES.CUSTOMER) return null;

  const isHeld = Boolean(transaction.settlementHold);

  /**
   * This payment's own position, said in one word.
   *
   * Derived here rather than left to the client, because working it out from
   * three fields is how two panels end up disagreeing about what "settled"
   * means. `PAID` is the settlement having actually paid — not merely having
   * claimed the row.
   */
  let state;
  if (!settlement) state = isHeld ? "ON_HOLD" : "NOT_SETTLED";
  else if (settlement.status === SETTLEMENT_STATUS.PAID) state = "PAID";
  else if (settlement.status === SETTLEMENT_STATUS.FAILED) state = "PAYOUT_FAILED";
  else state = "IN_SETTLEMENT";

  const section = {
    state,
    isSettled: Boolean(transaction.paidToVendorAt),
    /**
     * When this payment's money reached the vendor.
     *
     * On the transaction rather than read off the settlement, because a
     * settlement can be paid in legs and this is the stamp the payment itself
     * carries.
     */
    paidToVendorAt: transaction.paidToVendorAt ?? null,
    /**
     * A hold keeps a payment out of every future cycle until it is released,
     * and a hold nobody releases does that silently and for ever. A vendor
     * asking "why was this one not paid?" gets the answer here.
     */
    hold: compact({
      isHeld,
      // The reason is a system string — "refund requested", "dispute opened" —
      // not a staff note, so it is safe to show. `settlementHoldReason` is
      // capped at 300 characters by the model.
      reason: isHeld ? transaction.settlementHoldReason : undefined,
      releasedAt: transaction.settlementHoldReleasedAt,
      ...(role === ROLES.ADMIN
        ? { releaseReason: transaction.settlementHoldReleaseReason }
        : {}),
    }),
    /**
     * The settlement itself, narrowed by **the same projection the settlements
     * endpoints use**.
     *
     * Reused rather than re-listed: a second copy of "what may a vendor read off
     * a settlement" is how this page ends up showing a field
     * `GET /settlements/:id` carefully hides, and nobody would notice until
     * somebody opened both.
     */
    record: null,
    /** Every leg, with its UTR. See the header for why this is a list. */
    legs: [],
  };

  if (!settlement) return section;

  const narrowed = presentSettlement(
    pickByProjection(settlement, settlementProjection(role)),
    role,
  );

  // Lifted out of the record so a panel has one place to look, and so the
  // masked-versus-full rule lives in exactly one projection.
  const { bankSnapshot, ...record } = narrowed;

  section.record = record;
  section.bank = bankSnapshot || null;

  section.legs = legs.map((leg) =>
    compact({
      legNumber: leg.legNumber,
      amount: leg.amount,
      status: leg.status,
      /**
       * The bank reference — the one field both a vendor and support quote when
       * money has not landed, which is why it is indexed rather than buried in
       * a provider blob.
       */
      utr: leg.utr,
      mode: leg.mode,
      provider: leg.provider,
      bankLast4: leg.bankSnapshot?.accountLast4Digits,
      initiatedAt: leg.initiatedAt,
      paidAt: leg.paidAt,
      // The category of failure. A bounced NEFT is the vendor's business —
      // usually their own account details.
      failureReason:
        leg.status === PAYOUT_LEG_STATUS.FAILED ? leg.failureReason : undefined,
      ...(role === ROLES.ADMIN
        ? {
            _id: leg._id,
            // The provider's own payout id. Internal plumbing; `utr` is the
            // reference that means anything outside this system.
            providerReference: leg.providerReference,
            initiatedBy: leg.initiatedBy,
            bankSnapshot: leg.bankSnapshot,
          }
        : {}),
    }),
  );

  return section;
};
