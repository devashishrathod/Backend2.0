const mongoose = require("mongoose");
const WebhookEvent = require("../../models/WebhookEvent");
const { buildAggregateLookup } = require("../../database");
const { pagination, throwError } = require("../../utils");
const { WEBHOOK_STATUS } = require("../../constants/webhook");

/**
 * Admin view of every webhook delivery.
 *
 * Deliveries were already being stored, but there was no way to see them short
 * of opening the database — which meant a FAILED event (money captured, plan not
 * live, Razorpay not retrying) could sit unnoticed indefinitely.
 *
 * The default view is `status: FAILED`, because that is the actionable set. The
 * raw payload is excluded from the list to keep it readable; fetch a single
 * event to see it.
 *
 * ⚠️ Returns 404 when nothing matches — the shared `pagination` behaviour. On
 * this endpoint an empty result is the *good* outcome: no failed deliveries.
 */
exports.getWebhookEvents = async (query = {}) => {
  let {
    page,
    limit,
    status,
    event,
    transactionId,
    brandId,
    razorpayOrderId,
    fromDate,
    toDate,
    sortOrder = "desc",
  } = query;

  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 20;

  const match = {};
  // Explicit "ALL" opts out of the FAILED default without needing a magic blank.
  if (status && status !== "ALL") match.status = status;
  else if (!status) match.status = WEBHOOK_STATUS.FAILED;

  if (event) match.event = event;
  if (razorpayOrderId) match.razorpayOrderId = razorpayOrderId;
  if (transactionId) {
    match.transactionId = new mongoose.Types.ObjectId(transactionId);
  }
  if (brandId) match.brandId = new mongoose.Types.ObjectId(brandId);

  if (fromDate || toDate) {
    match.createdAt = {};
    if (fromDate) match.createdAt.$gte = new Date(fromDate);
    if (toDate) match.createdAt.$lte = new Date(toDate);
  }

  const pipeline = [{ $match: match }];

  pipeline.push(
    ...buildAggregateLookup({
      from: "brands",
      localField: "brandId",
      as: "brand",
      project: { brandName: 1, merchantId: 1 },
    }),
    ...buildAggregateLookup({
      from: "transactions",
      localField: "transactionId",
      as: "transaction",
      project: {
        invoiceId: 1,
        amount: 1,
        status: 1,
        verified: 1,
        subscribedId: 1,
        razorpayOrderId: 1,
      },
    }),
  );

  pipeline.push({
    $addFields: {
      // The one thing an admin scanning this list needs: money in, nothing
      // granted. That is a FAILED delivery on an unverified transaction.
      needsAttention: {
        $and: [
          { $eq: ["$status", WEBHOOK_STATUS.FAILED] },
          { $ne: ["$transaction.verified", true] },
        ],
      },
      isReplayable: {
        $in: ["$status", [WEBHOOK_STATUS.FAILED, WEBHOOK_STATUS.IGNORED]],
      },
    },
  });

  pipeline.push({
    $project: {
      // `payload` is deliberately excluded — it is large and only useful on a
      // single-event read.
      provider: 1,
      eventId: 1,
      event: 1,
      status: 1,
      outcome: 1,
      error: 1,
      attempts: 1,
      razorpayOrderId: 1,
      razorpayPaymentId: 1,
      brand: 1,
      transaction: 1,
      needsAttention: 1,
      isReplayable: 1,
      processedAt: 1,
      createdAt: 1,
    },
  });

  pipeline.push({
    // Anything needing attention floats to the top regardless of date.
    $sort: { needsAttention: -1, createdAt: sortOrder === "asc" ? 1 : -1 },
  });

  const result = await pagination(
    WebhookEvent,
    pipeline,
    page,
    limit,
    "webhook event",
  );

  return {
    ...result,
    // Counted across the whole collection, not just this page, so the panel can
    // badge it.
    needsAttentionTotal: await WebhookEvent.countDocuments({
      status: WEBHOOK_STATUS.FAILED,
    }),
  };
};

/** One delivery, including the raw payload, for inspection before a replay. */
exports.getWebhookEvent = async (payload) => {
  const { eventId } = payload;
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(String(eventId));

  const record = await WebhookEvent.findOne({
    $or: [{ eventId }, ...(isObjectId ? [{ _id: eventId }] : [])],
  })
    .populate("transactionId", "invoiceId amount status verified subscribedId")
    .populate("brandId", "brandName merchantId")
    .lean();

  if (!record) throwError(404, "Webhook event not found.");

  return {
    ...record,
    isReplayable: [WEBHOOK_STATUS.FAILED, WEBHOOK_STATUS.IGNORED].includes(
      record.status,
    ),
  };
};
