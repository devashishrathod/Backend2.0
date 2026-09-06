const mongoose = require("mongoose");
const { ROLES } = require("../../constants");
const { buildAggregateLookup } = require("../../database");
const { buildTransactionFilter } = require("./buildTransactionFilter");
const { buildAccessScopeFilter } = require("./assertTransactionAccess");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");

const asId = (value) =>
  value ? new mongoose.Types.ObjectId(String(value)) : undefined;

/**
 * The query filters every money listing accepts.
 *
 * One builder rather than one per endpoint, because the three audiences ask the
 * same questions — what happened, when, at which outlet — and three copies of
 * "parse a date range" is three chances to get the inclusive end wrong.
 *
 * The **scope** is not a filter the caller supplies. It comes from
 * `buildAccessScopeFilter`, and it is merged last so a caller cannot widen it by
 * passing a `customerId` of their own.
 */
exports.buildMoneyListFilter = (actor, query = {}, { forClaims = false } = {}) => {
  const filter = {};

  if (query.status) filter.status = query.status;

  // Inclusive of the whole end day. A report "up to the 31st" that stops at
  // midnight silently drops a day's takings.
  if (query.from || query.to) {
    filter.createdAt = {
      ...(query.from ? { $gte: new Date(query.from) } : {}),
      ...(query.to
        ? { $lte: new Date(new Date(query.to).setHours(23, 59, 59, 999)) }
        : {}),
    };
  }

  if (query.brandId) filter.brandId = asId(query.brandId);
  if (query.outletId) filter.subBrandId = asId(query.outletId);
  if (query.voucherId) filter.voucherId = asId(query.voucherId);
  if (query.claimCode && forClaims) {
    filter.claimCode = String(query.claimCode).trim().toUpperCase();
  }

  const scope = buildAccessScopeFilter(actor);

  /**
   * The scope and the caller's filters are **intersected**, not overlaid.
   *
   * Spreading the scope last is safe — it always wins — but it is also silent:
   * a vendor asking `?brandId=<someone else>` got their **own** rows back, which
   * looks exactly like a filter that worked. That is the shape of bug where
   * somebody builds a report on a filter that never applied and only finds out
   * when the numbers are questioned.
   *
   * Intersecting says the honest thing instead: nothing matches, because nothing
   * does. And it is still impossible to widen — an intersection can only ever
   * return fewer rows than the scope alone.
   */
  const conflicts = Object.keys(scope).some(
    (key) =>
      filter[key] !== undefined && String(filter[key]) !== String(scope[key]),
  );

  if (conflicts) {
    // A filter that matches nothing, rather than one that quietly matches the
    // wrong thing. `_id: null` is never a real row.
    return { _id: null };
  }

  return { ...filter, ...scope, isDeleted: false };
};

/**
 * What each audience is allowed to read off a money row.
 *
 * A projection rather than a delete-after-fetch: a field that is never loaded
 * cannot be leaked by a later refactor that forgets to strip it, and it cannot
 * appear in a log line either.
 *
 * ### What a vendor never gets
 *
 * `gatewayFee`, `netReceived`, `platformPromoCost` — our margin is a commercial
 * disclosure. `email`, `contact` — the customer's details are a privacy one.
 * Both live on the same document, which is why this is decided once.
 */
exports.claimProjection = (role) => {
  /**
   * ⚠️ Never name a path **and** its parent in one `$project`.
   *
   * `{ "voucher.claimId": 1, voucher: 1 }` is rejected outright —
   * *"Path collision at voucher"* — so the admin projection, which wants the
   * whole sub-document, must not inherit the narrowed paths below. The base is
   * therefore only used by the audiences that read a slice of it.
   */
  const voucherSlice = {
    "voucher.claimId": 1,
    "voucher.billAmount": 1,
    "voucher.offerDiscount": 1,
    "voucher.netBill": 1,
  };

  const base = {
    _id: 1,
    createdAt: 1,
    status: 1,
    amount: 1,
    currency: 1,
    verified: 1,
    verifiedAt: 1,
    razorpayOrderId: 1,
    razorpayPaymentId: 1,
    paymentMethod: 1,
    invoiceId: 1,
    brandId: 1,
    subBrandId: 1,
    voucherId: 1,
  };

  if (role === ROLES.ADMIN) {
    // Reconciliation needs the whole row, including what it cost us — so the
    // whole `voucher` sub-document, and none of the narrowed paths.
    return {
      ...base,
      customerId: 1,
      email: 1,
      contact: 1,
      voucher: 1,
      gatewayFee: 1,
      netReceived: 1,
      settlementStage: 1,
      settlementHold: 1,
      settlementId: 1,
      isDisputed: 1,
      disputeStatus: 1,
      amountRefunded: 1,
      // The public link is an admin tool for support conversations.
      documentToken: 1,
    };
  }

  if (role === ROLES.CUSTOMER) {
    return {
      ...base,
      ...voucherSlice,
      customerId: 1,
      "voucher.convenienceFee": 1,
      amountRefunded: 1,
      refundStatus: 1,
      // Their own invoice, and the link they were emailed.
      documentToken: 1,
    };
  }

  // VENDOR and SUB_VENDOR.
  return {
    ...base,
    ...voucherSlice,
    // What they will be paid, and nothing about what it cost us to collect it.
    "voucher.vendorPayable": 1,
    "voucher.vendorPromoCost": 1,
    "voucher.commissionAmount": 1,
    settlementId: 1,
    settlementHold: 1,
    paidToVendorAt: 1,
  };
};

/**
 * The aggregation for a voucher-claim listing.
 *
 * Scoped by `purpose` through `buildTransactionFilter`, so a claim listing can
 * never surface a subscription payment even if a filter is mis-typed.
 */
exports.buildClaimTransactionPipeline = (actor, query = {}) => {
  const match = {
    ...buildTransactionFilter({ purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM }),
    ...exports.buildMoneyListFilter(actor, query),
  };

  const pipeline = [{ $match: match }, { $sort: { createdAt: -1 } }];

  // The brand's name is what a customer recognises; an id is not.
  pipeline.push(
    ...buildAggregateLookup({
      from: "brands",
      localField: "brandId",
      as: "brand",
      project: { brandName: 1, logo: 1 },
    }),
    ...buildAggregateLookup({
      from: "subbrands",
      localField: "subBrandId",
      as: "outlet",
      project: { uniqueId: 1, storeId: 1 },
    }),
  );

  pipeline.push({ $project: exports.claimProjection(actor.role) });
  // Added after the projection so the joins survive it — a `$project` drops
  // anything it does not name, joined fields included.
  pipeline[pipeline.length - 1].$project.brand = 1;
  pipeline[pipeline.length - 1].$project.outlet = 1;

  return pipeline;
};

/**
 * The aggregation for a claim listing (the `VoucherClaim` collection itself).
 *
 * Separate from the transaction listing because they answer different questions:
 * a transaction listing is "what money moved", a claim listing is "what did I
 * buy / what was redeemed at my counter". A customer's order history is the
 * second one.
 */
exports.buildClaimPipeline = (actor, query = {}) => {
  const match = exports.buildMoneyListFilter(actor, query, { forClaims: true });

  // A claim's own status vocabulary, not a payment's.
  if (query.status && !Object.values(VOUCHER_CLAIM_STATUS).includes(query.status)) {
    delete match.status;
  }

  return [
    { $match: match },
    { $sort: { createdAt: -1 } },
    { $project: exports.claimRecordProjection(actor.role) },
  ];
};

/**
 * What each audience reads off a **claim** document.
 *
 * Extracted from the listing pipeline so the detail endpoint cannot drift from
 * it. Two copies of "what may a vendor see" is how a detail page ends up
 * showing a field the listing carefully hides — the bug is invisible until
 * someone opens one row.
 */
exports.claimRecordProjection = (role) => {
  const project = {
    _id: 1,
    createdAt: 1,
    claimCode: 1,
    status: 1,
    billAmount: 1,
    offerApplied: 1,
    paidAt: 1,
    redeemedAt: 1,
    brandId: 1,
    subBrandId: 1,
    voucherId: 1,
    transactionId: 1,
    // The frozen snapshots, which is the whole reason a claim reads correctly
    // years later without joining anything that may have moved.
    voucherSnapshot: 1,
    brandSnapshot: 1,
    outletSnapshot: 1,
    "pricing.billAmount": 1,
    "pricing.offerDiscount": 1,
    "pricing.promoDiscount": 1,
    "pricing.totalPayable": 1,
    "pricing.youSaved": 1,
    "pricing.offerTitle": 1,
  };

  if (role === ROLES.ADMIN) {
    project.customerId = 1;
    // The whole pricing block, so the narrowed paths must go — same collision
    // rule as above.
    for (const key of Object.keys(project)) {
      if (key.startsWith("pricing.")) delete project[key];
    }
    project.pricing = 1;
    project.promoCode = 1;
    project.isOncePerUser = 1;
    project.holdsUsageSlot = 1;
  } else if (role === ROLES.CUSTOMER) {
    project.customerId = 1;
    project["pricing.convenienceFee"] = 1;
    project.promoCode = 1;
    project.refundAmount = 1;
    project.refundedAt = 1;
  } else {
    // The brand side sees what they are owed, never our share of it.
    project["pricing.netBill"] = 1;
    project["pricing.vendorPayable"] = 1;
    project.promoCode = 1;
  }

  return project;
};

/**
 * Apply a Mongo projection to a document **already in memory**.
 *
 * A listing projects in the pipeline, which is strictly better — a field never
 * loaded cannot be leaked. A **detail** endpoint cannot do that, and the reason
 * is worth stating plainly:
 *
 * > Ownership lives in `customerId` / `brandId`. Those are exactly the fields
 * > the vendor projection deliberately omits. Projecting before the access check
 * > means checking "is this yours?" against a document that no longer says whose
 * > it is — so the row has to be read whole, checked, and only then narrowed.
 *
 * So this is a **whitelist**, never a delete-list. `delete doc.gatewayFee` has
 * to be updated every time the model grows a field, and the day someone forgets
 * is the day a vendor reads our margin. A whitelist fails the other way: a new
 * field is invisible until somebody names it.
 *
 * Understands both projection shapes — `{ amount: 1 }` and
 * `{ "voucher.vendorPayable": 1 }` — because `claimProjection` uses both.
 */
exports.pickByProjection = (doc, projection) => {
  if (!doc) return doc;
  const out = {};

  for (const path of Object.keys(projection)) {
    if (!projection[path]) continue;

    const segments = path.split(".");
    let source = doc;
    let missing = false;

    for (const segment of segments) {
      if (source === null || source === undefined) {
        missing = true;
        break;
      }
      source = source[segment];
    }
    // `undefined` means the document simply has no value there. Copying it
    // would turn every unset optional field into an explicit `null` in the
    // response, which reads as "we know it is empty" rather than "not set".
    if (missing || source === undefined) continue;

    let target = out;
    for (let i = 0; i < segments.length - 1; i += 1) {
      target[segments[i]] = target[segments[i]] || {};
      target = target[segments[i]];
    }
    target[segments[segments.length - 1]] = source;
  }

  return out;
};
