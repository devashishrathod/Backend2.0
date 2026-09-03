const PromoCode = require("../../models/PromoCode");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const {
  PROMO_USAGE_STATUS,
  PROMO_CODE_LIMITS,
  PROMO_REJECTION,
  PROMO_AUDIENCE,
} = require("../../constants/promoCode");
const { throwError } = require("../../utils");

/**
 * Claim a promo code for an order that has not been paid for yet.
 *
 * The counter move is an atomic conditional update — the same filter-plus-
 * increment pattern the plan pools use — so a limited code cannot be oversold
 * when several vendors check out at the same moment. A read-then-write check
 * would let two orders past the last remaining use.
 *
 * A ledger row is written alongside it in RESERVED state. If the payment never
 * happens, `releasePromoCode` (or the stale-reservation sweep) puts the use
 * back, so an abandoned checkout cannot permanently burn a single-use code.
 *
 * @throws {CustomError} 409 if the code ran out between preview and order
 */
exports.reservePromoCode = async ({
  promoCode,
  // Exactly one of these. The audience discriminates which, and every cap check
  // and report scopes by it — counting a customer's claims against a brand's
  // limit, or the reverse, would be nonsense.
  brand,
  customerId,
  userId,
  subscription,
  voucherClaimId,
  transaction,
  discountAmount,
  // How the discount is funded, already split by the caller. Frozen here so a
  // settlement never has to re-derive it from a promo code that may since have
  // been edited. Must satisfy vendorCost + platformCost === discountAmount.
  vendorCost = 0,
  platformCost = discountAmount,
}) => {
  const audience = customerId
    ? PROMO_AUDIENCE.CUSTOMER
    : PROMO_AUDIENCE.VENDOR;
  const claimed = await PromoCode.findOneAndUpdate(
    {
      _id: promoCode._id,
      isActive: true,
      isDeleted: false,
      // Unlimited codes have no totalUsageLimit, so the guard only applies when
      // one is set.
      $or: [
        { totalUsageLimit: { $exists: false } },
        { totalUsageLimit: null },
        { $expr: { $lt: ["$usedCount", "$totalUsageLimit"] } },
      ],
    },
    { $inc: { usedCount: 1 } },
    { new: true },
  );

  if (!claimed) {
    throwError(
      409,
      "This promo code was just fully redeemed. Please continue without one.",
    );
  }

  try {
    return await PromoCodeUsage.create({
      promoCodeId: promoCode._id,
      code: promoCode.code,
      audience,
      brandId: brand?._id,
      customerId,
      userId,
      subscriptionId: subscription?._id,
      voucherClaimId,
      transactionId: transaction._id,
      status: PROMO_USAGE_STATUS.RESERVED,
      discountAmount,
      vendorCost,
      platformCost,
      reservedAt: new Date(),
    });
  } catch (error) {
    // Ledger insert failed — hand the counter back rather than leaking a use.
    await PromoCode.updateOne(
      { _id: promoCode._id, usedCount: { $gt: 0 } },
      { $inc: { usedCount: -1 } },
    );
    throw error;
  }
};

/**
 * Finalise a reservation once the payment is verified.
 *
 * The counter was already incremented at reservation time, so the normal path
 * just moves the ledger row to CONSUMED. Idempotent: verifying twice does not
 * double-count.
 *
 * **Reconciliation.** A vendor can pay after the reservation has been swept as
 * stale (30 minutes). By then the discount is frozen on the transaction and the
 * money has already been captured at the discounted amount, so it has to be
 * honoured — refusing here would mean money taken and no plan. Previously that
 * left the discount given with *nothing recorded against the code*, which
 * understated redemptions and let `totalUsageLimit` be quietly exceeded.
 *
 * So when the RESERVED row is gone but the transaction carries a frozen promo
 * discount, the claim is **re-made** as CONSUMED and the counter incremented.
 * The ledger then matches reality, including when that pushes a limited code
 * over its cap — an accurate over-count is worth more than a hidden one, and the
 * caller is told so it can raise it.
 *
 * @returns {{ usage, reconciled: boolean, exceededLimit: boolean }|null}
 */
exports.commitPromoCode = async ({
  transactionId,
  subscribedId,
  voucherClaimId,
  // The frozen block from the transaction, used only for reconciliation.
  pricing,
  brandId,
  customerId,
  subscriptionId,
  userId,
}) => {
  const audience = customerId
    ? PROMO_AUDIENCE.CUSTOMER
    : PROMO_AUDIENCE.VENDOR;
  if (!transactionId) return null;

  const usage = await PromoCodeUsage.findOneAndUpdate(
    { transactionId, status: PROMO_USAGE_STATUS.RESERVED },
    {
      $set: {
        status: PROMO_USAGE_STATUS.CONSUMED,
        consumedAt: new Date(),
        ...(subscribedId ? { subscribedId } : {}),
        ...(voucherClaimId ? { voucherClaimId } : {}),
      },
    },
    { new: true },
  );

  if (usage) return { usage, reconciled: false, exceededLimit: false };

  // Nothing reserved. Either there was no promo at all, or the reservation was
  // swept before the vendor paid.
  if (!pricing?.promoCode || !(pricing?.promoDiscount > 0)) return null;

  // Already committed by an earlier settle of the same transaction.
  const existing = await PromoCodeUsage.findOne({
    transactionId,
    status: PROMO_USAGE_STATUS.CONSUMED,
  });
  if (existing) return { usage: existing, reconciled: false, exceededLimit: false };

  const promo = await PromoCode.findOne({ code: pricing.promoCode });
  if (!promo) {
    console.warn(
      `[commitPromoCode] transaction ${transactionId} carries discount for unknown code ${pricing.promoCode} — cannot reconcile`,
    );
    return null;
  }

  const claimed = await PromoCode.findOneAndUpdate(
    { _id: promo._id },
    { $inc: { usedCount: 1 } },
    { new: true },
  );

  const RECLAIM_NOTE =
    "Reservation had lapsed before payment; re-claimed so the ledger matches the discount actually given";

  // There is a unique index on `transactionId` — one claim per transaction — so
  // the swept row is flipped back rather than a second one inserted. That also
  // keeps the row's own history (when it was reserved, when it was released).
  let reconstructed = await PromoCodeUsage.findOneAndUpdate(
    { transactionId, status: PROMO_USAGE_STATUS.RELEASED },
    {
      $set: {
        status: PROMO_USAGE_STATUS.CONSUMED,
        consumedAt: new Date(),
        ...(subscribedId ? { subscribedId } : {}),
        ...(voucherClaimId ? { voucherClaimId } : {}),
        discountAmount: pricing.promoDiscount,
        releaseReason: RECLAIM_NOTE,
      },
    },
    { new: true },
  );

  // No row at all — a transaction from before the ledger existed.
  if (!reconstructed) {
    reconstructed = await PromoCodeUsage.create({
      promoCodeId: promo._id,
      code: promo.code,
      audience,
      brandId,
      customerId,
      userId,
      subscriptionId,
      voucherClaimId,
      transactionId,
      subscribedId,
      status: PROMO_USAGE_STATUS.CONSUMED,
      discountAmount: pricing.promoDiscount,
      reservedAt: new Date(),
      consumedAt: new Date(),
      releaseReason: RECLAIM_NOTE,
    });
  }

  const exceededLimit = Boolean(
    claimed?.totalUsageLimit && claimed.usedCount > claimed.totalUsageLimit,
  );

  console.warn(
    `[commitPromoCode] re-claimed lapsed reservation for ${promo.code} on transaction ${transactionId}` +
      (exceededLimit
        ? ` — usedCount ${claimed.usedCount} now exceeds the limit of ${claimed.totalUsageLimit}`
        : ""),
  );

  return { usage: reconstructed, reconciled: true, exceededLimit, promoCode: claimed };
};

/**
 * Put a reservation back.
 *
 * Never throws — the caller is usually unwinding a failed order, and the
 * stale-reservation sweep will catch anything missed.
 */
exports.releasePromoCode = async ({ transactionId, reason }) => {
  if (!transactionId) return null;
  try {
    const usage = await PromoCodeUsage.findOneAndUpdate(
      { transactionId, status: PROMO_USAGE_STATUS.RESERVED },
      {
        $set: {
          status: PROMO_USAGE_STATUS.RELEASED,
          releasedAt: new Date(),
          releaseReason: reason,
        },
      },
      { new: true },
    );
    if (usage) {
      await PromoCode.updateOne(
        { _id: usage.promoCodeId, usedCount: { $gt: 0 } },
        { $inc: { usedCount: -1 } },
      );
    }
    return usage;
  } catch (error) {
    console.error(
      `[releasePromoCode] failed for transaction ${transactionId}:`,
      error?.message,
    );
    return null;
  }
};

/**
 * Give a **consumed** promo back, because the claim it paid for was refunded.
 *
 * Different from `releasePromoCode`, and deliberately a separate function:
 * that one only touches `RESERVED` rows — a checkout being unwound before it
 * ever completed. By the time a refund happens the usage is `CONSUMED`, so the
 * same call would find nothing and silently do nothing.
 *
 * ### Only on a full refund, and only when the setting says so
 *
 * `refund.releasePromoOnRefund` is `false` by default, and that default is the
 * right one for a promo budget: a customer who claims, refunds, claims again on
 * the same code has spent our campaign money twice for one sale. Switching it on
 * is a decision about being generous, not about correctness — which is why it is
 * a setting rather than behaviour.
 *
 * A **partial** refund never releases it. The customer kept part of what the
 * promo discounted, so the code was genuinely used.
 *
 * Never throws. A promo that stayed consumed is a smaller problem than a refund
 * that rolled back because of it.
 */
exports.releaseConsumedPromoOnRefund = async ({ transactionId, reason }) => {
  if (!transactionId) return null;
  try {
    const usage = await PromoCodeUsage.findOneAndUpdate(
      { transactionId, status: PROMO_USAGE_STATUS.CONSUMED },
      {
        $set: {
          status: PROMO_USAGE_STATUS.RELEASED,
          releasedAt: new Date(),
          releaseReason: reason,
        },
      },
      { returnDocument: "after" },
    );
    if (!usage) return null;

    // The guard matters: without `usedCount: { $gt: 0 }` a double release would
    // drive the counter negative and hand out a single-use code twice.
    await PromoCode.updateOne(
      { _id: usage.promoCodeId, usedCount: { $gt: 0 } },
      { $inc: { usedCount: -1 } },
    );
    return usage;
  } catch (error) {
    console.error(
      `[releaseConsumedPromoOnRefund] failed for transaction ${transactionId}:`,
      error?.message,
    );
    return null;
  }
};

/**
 * Reclaim reservations from checkouts that were never completed.
 *
 * Without this a single-use code stays locked forever the first time someone
 * opens an order and walks away. Registered as a background job.
 */
exports.releaseStalePromoReservations = async () => {
  const cutoff = new Date(
    Date.now() - PROMO_CODE_LIMITS.RESERVATION_TTL_MINUTES * 60 * 1000,
  );

  const stale = await PromoCodeUsage.find({
    status: PROMO_USAGE_STATUS.RESERVED,
    reservedAt: { $lte: cutoff },
  })
    .select("_id promoCodeId")
    .lean();

  if (!stale.length) return { released: 0 };

  await PromoCodeUsage.updateMany(
    { _id: { $in: stale.map((row) => row._id) } },
    {
      $set: {
        status: PROMO_USAGE_STATUS.RELEASED,
        releasedAt: new Date(),
        releaseReason: "Reservation expired — checkout not completed",
      },
    },
  );

  // Decrement each code once per reclaimed row, floored at zero.
  const perCode = stale.reduce((acc, row) => {
    const key = String(row.promoCodeId);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  await Promise.all(
    Object.entries(perCode).map(([id, count]) =>
      PromoCode.updateOne(
        { _id: id, usedCount: { $gte: count } },
        { $inc: { usedCount: -count } },
      ),
    ),
  );

  return { released: stale.length, codes: Object.keys(perCode).length };
};

exports.PROMO_REJECTION = PROMO_REJECTION;
