const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");

const { throwError } = require("../../utils");
const { buildClaimPreview } = require("../../helpers/vouchers");
const {
  generateClaimCode,
  recordClaimHistory,
} = require("../../helpers/voucherClaims");
const {
  reservePromoCode,
  releasePromoCode,
} = require("../../helpers/promoCodes");
const { resolveCustomerId } = require("../../helpers/customers");
const { getRazorpayAccount } = require("../../configs/razorpay");
const { buildTransactionFilter } = require("../../helpers/transactions");
const {
  TRANSACTION_PURPOSE,
  ACCOUNT_FOR_PURPOSE,
} = require("../../constants/transaction");
const {
  VOUCHER_CLAIM_STATUS,
  CLAIM_HISTORY_ACTION,
  CLAIM_REDEMPTION_MODE,
} = require("../../constants/voucherClaim");
const { VOUCHER_USAGE_TYPE } = require("../../constants/voucher");
const { PROMO_CODE_LIMITS } = require("../../constants/promoCode");
const { PAYMENT_STATUS } = require("../../constants");
const { PAYMENT_GATEWAYS } = require("../../constants/subscription");
const { ROLES } = require("../../constants");

const { DUPLICATE_KEY } = require("../../constants/mongo");
const MINUTE_MS = 60 * 1000;

/**
 * Find the transaction a given idempotency key already produced.
 *
 * Through `buildTransactionFilter` like every other Transaction read — the
 * collection holds both subscriptions and claims, and a forgotten `purpose`
 * would let a vendor's key collide with a customer's.
 */
const findByIdempotencyKey = (customerId, idempotencyKey) =>
  Transaction.findOne({
    ...buildTransactionFilter({
      purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
      customerId,
    }),
    idempotencyKey,
  });

/**
 * Shape one response, so the reuse path and the fresh path are indistinguishable
 * to the client.
 *
 * A client that has to branch on `reused` is a client that will get one of the
 * two branches wrong.
 */
const respond = ({ claim, transaction, preview, keyId, reused }) => ({
  claim: {
    id: claim._id,
    claimCode: claim.claimCode,
    status: claim.status,
  },
  transaction: { id: transaction._id, status: transaction.status },
  voucher: preview.voucher,
  version: preview.version,
  outlet: preview.outlet,
  brand: preview.brand,
  billAmount: preview.billAmount,
  offerApplied: preview.offerApplied,
  selectedOffer: preview.selectedOffer,
  pricing: preview.pricing,
  orderSummary: preview.orderSummary,
  promo: preview.promo,
  razorpay: {
    orderId: transaction.razorpayOrderId,
    // A voucher-claim transaction carries no `pricing` block — that lives on the
    // claim, and the subscription-shaped one on Transaction is left absent on
    // purpose. The figure comes from the price this request was quoted at.
    amount: preview.pricing.amountInPaise,
    currency: transaction.currency,
    keyId,
  },
  reused,
});

/**
 * Open a Razorpay order for a voucher claim.
 *
 * ### The order of operations is the design
 *
 * Every step below can be reached twice — a double tap, a retried request, two
 * browser tabs — and the order they run in is what decides whether that costs
 * the customer money.
 *
 * ```
 * 1. price it            same builder as preview, strictPromo: true
 * 2. idempotency key     insert FIRST, before anything external happens
 * 3. reuse window        hand back an open order rather than opening a second
 * 4. claim + slot hold   the once-per-user lock, taken by the database
 * 5. promo reservation   atomic, so a limited code cannot be oversold
 * 6. Razorpay order      last, because it is the only step we cannot undo
 * ```
 *
 * **The idempotency key goes in before the Razorpay call, not after.** Taking
 * the header and checking it is not enough: two concurrent taps both pass a
 * read-then-write check, both open a Razorpay order, and the customer sees two
 * payment sheets for one bill. Inserting the key is what makes the second tap
 * lose — the unique index decides, not the timing.
 *
 * **Razorpay is called last** because it is the one step with no undo. Anything
 * that fails before it leaves nothing outside our own database; anything that
 * fails after it leaves an orphan order at Razorpay, which is why the promo
 * reservation rolls the transaction back rather than leaving it priced wrong.
 *
 * @param {object} actor    the request — `customerId` must be present
 * @param {object} payload  validated body
 * @param {string} [idempotencyKey] the `Idempotency-Key` header
 */
exports.createVoucherClaimOrder = async (actor, payload, idempotencyKey) => {
  const customerId = resolveCustomerId(actor);
  // The route is behind `isCustomer`, so this is a guard against a mis-wired
  // route rather than a user-facing case.
  if (!customerId) {
    throwError(401, "Please log in to continue with this claim.");
  }

  const { voucherId, outletId, billAmount, offerId, promoCode } = payload;

  // ---------------- 1. price it ----------------
  //
  // The same builder the preview endpoint uses, so the amount the customer was
  // shown is the amount that reaches Razorpay. `strictPromo` turns a code that
  // cannot be used into a 422 here: charging full price on a code they believe
  // they applied is not acceptable.
  const preview = await buildClaimPreview(
    {
      voucherId,
      outletId,
      billAmount,
      offerId: offerId || null,
      promoCode: promoCode || null,
      actor,
    },
    { strictPromo: true },
  );

  if (!preview.canClaim) throwError(403, preview.blockedReason);

  const { pricing, _internal } = preview;
  const { config, voucher, version, outlet, brand, brandId, offer, promoVerdict, promoCost } =
    _internal;

  if (pricing.amountInPaise <= 0) {
    // Razorpay will not create an order for zero, and a claim that costs nothing
    // is a promo bug rather than a purchase.
    throwError(422, "This claim has no payable amount. Please check the bill.");
  }

  // Resolved before either exit, because both hand the client a key id and it
  // must be the key that owns the order — a mismatch means Razorpay's checkout
  // refuses to open at all.
  const { instance: razorpay, keyId } = getRazorpayAccount(
    ACCOUNT_FOR_PURPOSE[TRANSACTION_PURPOSE.VOUCHER_CLAIM],
  );

  // ---------------- 2. the idempotency key ----------------
  //
  // Inserted before anything external happens. Two concurrent taps both reach
  // here; the unique index lets exactly one through, and the loser is handed the
  // winner's order instead of opening a second one.
  if (idempotencyKey) {
    const existing = await findByIdempotencyKey(customerId, idempotencyKey);
    if (existing) {
      const claim = await VoucherClaim.findOne({ transactionId: existing._id });
      if (claim) {
        return respond({
          claim,
          transaction: existing,
          preview,
          keyId,
          reused: true,
        });
      }
    }
  }

  // ---------------- 3. the reuse window ----------------
  //
  // Deliberately BEFORE the slot hold. A customer reloading the page must get
  // their own open order back, not collide with the slot their own previous
  // attempt is already holding.
  const reuseWindowMs = (config.claim.pendingOrderReuseMinutes || 0) * MINUTE_MS;
  if (reuseWindowMs > 0) {
    const openClaim = await VoucherClaim.findOne({
      customerId,
      voucherId: voucher._id,
      subBrandId: outlet._id,
      billAmount,
      offerId: offer?._id || null,
      status: VOUCHER_CLAIM_STATUS.PENDING,
      isDeleted: false,
      createdAt: { $gte: new Date(Date.now() - reuseWindowMs) },
      // Never hand back an order whose promo quote has lapsed. The reservation
      // behind it may already have been swept, and honouring the frozen discount
      // would give away money the ledger has no record of.
      $or: [
        { promoQuotedUntil: { $exists: false } },
        { promoQuotedUntil: null },
        { promoQuotedUntil: { $gt: new Date() } },
      ],
    })
      .sort({ createdAt: -1 })
      .populate("transactionId");

    if (openClaim?.transactionId?.razorpayOrderId) {
      return respond({
        claim: openClaim,
        transaction: openClaim.transactionId,
        preview,
        keyId,
        reused: true,
      });
    }
  }

  // ---------------- 4. the claim, and the slot it holds ----------------
  //
  // Created before the Razorpay order, and holding its slot from the moment it
  // exists. Waiting for payment to take the lock leaves exactly the window a
  // race needs: two checkouts open, neither holding anything, both allowed.
  const isOncePerUser =
    Boolean(offer) && offer.usageType === VOUCHER_USAGE_TYPE.ONCE_PER_USER;

  let claim;
  try {
    claim = await VoucherClaim.create({
      customerId,
      userId: actor.userId,
      voucherId: voucher._id,
      voucherVersionId: version._id,
      versionNumber: version.versionNumber,
      offerId: offer?._id || null,
      brandId,
      subBrandId: outlet._id,

      // Frozen now. Everything they copy is editable afterwards, and a claim
      // from September has to still read the same in March.
      offerSnapshot: offer ? JSON.parse(JSON.stringify(offer)) : undefined,
      voucherSnapshot: {
        name: voucher.name,
        categoryId: voucher.categoryId,
        subCategoryId: voucher.subCategoryId,
      },
      brandSnapshot: brand ? { name: brand.brandName } : undefined,
      outletSnapshot: {
        uniqueId: outlet.uniqueId,
        storeId: outlet.storeId,
        state: outlet.locationId?.state || null,
      },

      billAmount,
      offerApplied: preview.offerApplied,
      pricing,

      status: VOUCHER_CLAIM_STATUS.PENDING,
      claimCode: await generateClaimCode(),
      // Phase 1: paying at the counter is the redemption. Phase 2 flips this to
      // OUTLET_SCAN without a migration.
      redemptionMode: CLAIM_REDEMPTION_MODE.AUTO,

      holdsUsageSlot: isOncePerUser,
      isOncePerUser,

      promoCodeId: promoVerdict?.ok ? promoVerdict.promoCode._id : undefined,
      promoCode: promoVerdict?.ok ? promoVerdict.promoCode.code : undefined,
      promoDiscount: pricing.promoDiscount,
      promoQuotedUntil: promoVerdict?.ok
        ? new Date(Date.now() + PROMO_CODE_LIMITS.RESERVATION_TTL_MINUTES * MINUTE_MS)
        : undefined,
      promoCostBearing: promoVerdict?.ok
        ? promoVerdict.promoCode.costBearing
        : undefined,
    });
  } catch (error) {
    if (error?.code === DUPLICATE_KEY) {
      // The once-per-user index. Someone — possibly this same customer in
      // another tab — already holds this offer's slot.
      throwError(
        409,
        "You already have a claim in progress for this offer. Finish or cancel it first.",
      );
    }
    throw error;
  }

  // From here on a failure has to clean up after itself: the claim exists and
  // is holding a slot nobody is going to pay for.
  const rollback = async (note) => {
    await VoucherClaim.updateOne(
      { _id: claim._id },
      {
        $set: {
          status: VOUCHER_CLAIM_STATUS.CANCELLED,
          holdsUsageSlot: false,
          cancelledAt: new Date(),
          cancelReason: note,
          isDeleted: true,
        },
      },
    );
  };

  let transaction;
  try {
    // ---------------- 5. the transaction, carrying the idempotency key ----------------
    //
    // Written before the Razorpay call. If two taps got this far, the unique
    // `{ customerId, idempotencyKey }` index decides which one continues.
    transaction = await Transaction.create({
      purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
      gatewayAccount: ACCOUNT_FOR_PURPOSE[TRANSACTION_PURPOSE.VOUCHER_CLAIM],
      customerId,
      userId: actor.userId,
      brandId,
      subBrandId: outlet._id,
      voucherId: voucher._id,
      createdBy: actor.userId,
      gateway: PAYMENT_GATEWAYS.RAZORPAY,
      // Our own maths, not an echo of Razorpay's — verify re-derives these and
      // compares, and an echo would agree with a tampered order.
      amount: pricing.totalPayable,
      currency: pricing.currency,
      status: PAYMENT_STATUS.CREATED,
      dueAmount: pricing.totalPayable,
      idempotencyKey,
      // The denormalised copy a settlement totals without joining every claim.
      voucher: {
        claimId: claim._id,
        voucherId: voucher._id,
        voucherVersionId: version._id,
        versionNumber: version.versionNumber,
        offerId: offer?._id || null,
        billAmount: pricing.billAmount,
        offerDiscount: pricing.offerDiscount,
        convenienceFee: pricing.convenienceFee,
        netBill: pricing.netBill,
        vendorPayable: pricing.vendorPayable,
        platformPromoCost: pricing.platformPromoCost,
        vendorPromoCost: pricing.vendorPromoCost,
        commissionPercent: pricing.commissionPercent,
        commissionAmount: pricing.commissionAmount,
        commissionTax: pricing.commissionTax,
        commissionDeduction: pricing.commissionDeduction,
      },
    });
  } catch (error) {
    if (error?.code === DUPLICATE_KEY) {
      // The idempotency key. The other tap won; hand back what it made rather
      // than opening a second Razorpay order for the same bill.
      await rollback("Duplicate request — another attempt won");
      const winner = await findByIdempotencyKey(customerId, idempotencyKey);
      const winnerClaim =
        winner && (await VoucherClaim.findOne({ transactionId: winner._id }));
      if (winner && winnerClaim) {
        return respond({
          claim: winnerClaim,
          transaction: winner,
          preview,
          keyId,
          reused: true,
        });
      }
    }
    await rollback("Could not create the transaction");
    throw error;
  }

  try {
    // ---------------- 6. the promo reservation ----------------
    //
    // Atomic, so a limited code cannot be oversold. Released again if the
    // payment never lands, or reclaimed by the stale-reservation sweep.
    if (promoVerdict?.ok) {
      await reservePromoCode({
        promoCode: promoVerdict.promoCode,
        customerId,
        userId: actor.userId,
        voucherClaimId: claim._id,
        transaction,
        discountAmount: pricing.promoDiscount,
        vendorCost: promoCost?.vendorCost ?? 0,
        platformCost: promoCost?.platformCost ?? pricing.promoDiscount,
      });
    }

    // ---------------- 7. Razorpay, last ----------------
    //
    // The only step with no undo, so everything that can fail has already
    // failed by the time we get here.
    const razorpayOrder = await razorpay.orders.create({
      amount: pricing.amountInPaise,
      currency: pricing.currency,
      receipt: `vch_${String(claim._id).slice(-8)}`,
      notes: {
        claimId: String(claim._id),
        claimCode: claim.claimCode,
        voucherId: String(voucher._id),
        outletId: String(outlet._id),
        brandId: String(brandId),
      },
    });
    if (!razorpayOrder?.id) {
      throwError(503, "Razorpay services unavailable! Please try again later.");
    }

    transaction = await Transaction.findOneAndUpdate(
      { _id: transaction._id },
      {
        $set: {
          razorpayOrderId: razorpayOrder.id,
          receipt: razorpayOrder.receipt,
          entity: razorpayOrder.entity,
          status: razorpayOrder.status,
          notes: razorpayOrder.notes,
          attempts: razorpayOrder.attempts,
          createdAtRaw: razorpayOrder.created_at,
        },
      },
      { returnDocument: "after" },
    );

    await VoucherClaim.updateOne(
      { _id: claim._id },
      { $set: { transactionId: transaction._id } },
    );
    claim.transactionId = transaction._id;
  } catch (error) {
    // The order is worthless without the discount it was priced with, and the
    // slot is worthless without an order. Undo both rather than leaving a
    // customer holding a once-per-user offer they never paid for.
    await releasePromoCode({
      transactionId: transaction._id,
      reason: "Claim order rolled back",
    });
    await Transaction.updateOne(
      { _id: transaction._id },
      { $set: { isDeleted: true, note: "Claim order rolled back" } },
    );
    await rollback("Could not open the payment order");
    throw error;
  }

  await recordClaimHistory({
    claimId: claim._id,
    customerId,
    brandId,
    transactionId: transaction._id,
    action: CLAIM_HISTORY_ACTION.CLAIM_CREATED,
    performedBy: actor.userId,
    role: actor.role || ROLES.CUSTOMER,
    toStatus: VOUCHER_CLAIM_STATUS.PENDING,
    amount: pricing.totalPayable,
    snapshot: {
      pricing,
      razorpayOrderId: transaction.razorpayOrderId,
      promoCode: promoVerdict?.ok ? promoVerdict.promoCode.code : null,
      idempotencyKey,
    },
  });

  return respond({ claim, transaction, preview, keyId, reused: false });
};
