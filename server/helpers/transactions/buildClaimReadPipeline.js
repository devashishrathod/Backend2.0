const mongoose = require("mongoose");
const { ROLES } = require("../../constants");
const { buildAggregateLookup } = require("../../database");
const { buildTransactionFilter } = require("./buildTransactionFilter");
const { buildAccessScopeFilter } = require("./assertTransactionAccess");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");
// By file, not through the barrel: `helpers/subscribeds` requires
// `helpers/transactions` (settleSubscriptionPayment), so the barrel would close
// a require cycle back onto this very module. `buildInvoiceSnapshot` reaches
// for `../subscribeds/formatDuration` the same way and for the same reason.
const { buildBrandPlanLookup } = require("../subscribeds/brandPlanLookup");

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
 * What each audience may read about **the person who paid**.
 *
 * ### The line is drawn at the phone number, not at contact in general
 *
 * `fullName` and `uniqueId` answer *who is this*. `email` is how a brand reaches
 * a buyer about the sale they just made. `mobile` and `whatsappNumber` are the
 * channel somebody answers at any hour, and they stay admin-only.
 *
 * A vendor reconciling their counter has to be able to name the person on a row
 * and quote a handle in a support thread, and can do neither from an ObjectId.
 *
 * ⚠️ **This moved once already.** The brand side was given name and `uniqueId`
 * and explicitly no contact at all; `email` was added afterwards, deliberately,
 * and `viewer.canSeeCustomerPhone` was added beside `canSeeCustomerContact` at
 * the same time so neither flag had to start lying. If this line moves again,
 * move the flags with it — a flag that disagrees with the projection is worse
 * than no flag, because a client acts on it.
 *
 * ⚠️ `uniqueId`, not `customerId`. The ObjectId is an internal key the vendor
 * projection deliberately omits — see the listing test that pins it — while
 * `uniqueId` is the handle support and the customer themselves already quote.
 *
 * 🔴 **`_id: 0` is load-bearing, not tidiness.** A lookup projection returns
 * `_id` unless told not to, and `Customer._id` **is** `Transaction.customerId` —
 * the exact field `claimProjection` withholds from the brand side. Without this
 * line the block hands back, one key deeper, the identifier the projection two
 * hundred lines above went out of its way to omit, and the test that pins
 * `row.customerId === undefined` would keep passing while it happened.
 *
 * Dropped for the admin too, who already has `customerId` on the row: one shape
 * for every audience beats a second one that exists only to carry a duplicate.
 */
exports.customerIdentityProjection = (role) => {
  /**
   * `email` is in the shared block, `mobile` and `whatsappNumber` are not.
   *
   * A mailbox is asynchronous and the buyer decides whether to open it. A phone
   * number rings, and handing every counter the number of everybody who ever
   * bought there is a different thing entirely — it is also the field that makes
   * a customer list worth selling.
   */
  const identity = { _id: 0, fullName: 1, uniqueId: 1, email: 1 };

  if (role === ROLES.ADMIN) {
    /**
     * 🔴 This is also the fix for a field that was never there.
     *
     * The admin projection has named `email` and `contact` since it was written,
     * and **nothing ever writes either one on a voucher-claim row** —
     * `createVoucherClaimOrder` does not set them, and neither the webhook nor
     * the settler does. Only `createSubscribeOrder` fills those two, on the
     * other flow entirely. So an admin opening a claim payment got a projection
     * that promised contact details and a document that had none, with nothing
     * anywhere saying so. The customer record is where they actually live.
     */
    return { ...identity, mobile: 1, whatsappNumber: 1 };
  }

  return identity;
};

/**
 * Does this audience get a `customer` block joined at all?
 *
 * **No, when they are the customer.** Joining `customers` on every row of
 * somebody's own order history is a round trip that tells them their own name.
 * The lookup is left out of their pipeline rather than added and projected away,
 * so the highest-volume audience here pays nothing for it.
 *
 * Asked in one place because four surfaces ask it — two listings and two detail
 * endpoints — and a listing that joins where a detail does not is exactly the
 * drift `claimProjection`'s header warns about.
 */
exports.showsCustomerIdentity = (role) => role !== ROLES.CUSTOMER;

/**
 * The voucher version a claim was bought from.
 *
 * ⚠️ `versionCode` is on **neither** document this module reads. A transaction
 * carries `voucher.voucherVersionId` and `voucher.versionNumber`, a claim
 * carries the same two at the top level, and `voucherSnapshot` does not freeze
 * it either — the code lives only on `VoucherVersion`. So every surface that
 * shows it joins for it, and there is no shortcut to add later.
 *
 * All three audiences get it. It identifies a voucher version, never a person:
 * the vendor quotes it asking why a September sale priced the way it did, the
 * admin searches by it (`VoucherVersionTextIndex` weights it second), and the
 * customer reads it out on a support call.
 *
 * `versionNumber` rides along because the brand-side and customer projections
 * narrow `voucher` to four fields and never carried it — so this is the only
 * place either of them can see which version they are looking at.
 */
exports.VOUCHER_VERSION_FIELDS = { versionCode: 1, versionNumber: 1 };

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
      // `merchantId` rides along so every surface that shows a brand shows the
      // same identifiers — it is already public on the customer brand
      // endpoints, so this is not new exposure.
      project: { brandName: 1, logo: 1, merchantId: 1 },
    }),
    ...buildAggregateLookup({
      from: "subbrands",
      localField: "subBrandId",
      as: "outlet",
      project: { uniqueId: 1, storeId: 1 },
    }),
    // Beside `brand.merchantId`, matching the voucher listing's brand block.
    ...buildBrandPlanLookup({
      localField: "brandId",
      as: "brand.subscriptionPlan",
    }),
    /**
     * The version the sale was made from — for `versionCode`, which is on no
     * document this pipeline already reads.
     *
     * ⚠️ Joined off `voucher.voucherVersionId`, a path the **brand-side and
     * customer projections drop**: `voucherSlice` names four fields and that is
     * not one of them. So this lookup has to run before the `$project`, not
     * after it the way the brand join does, or it would read a field that is no
     * longer there and silently attach nothing.
     *
     * No `isDeleted` filter. A version can be archived, paused or deleted after
     * it was sold, and a payment row still has to say which one it was.
     */
    ...buildAggregateLookup({
      from: "voucherversions",
      localField: "voucher.voucherVersionId",
      as: "voucherVersion",
      project: exports.VOUCHER_VERSION_FIELDS,
    }),
  );

  /**
   * Who paid — name and unique id, and contact only for an admin.
   *
   * ⚠️ Same reason as the version join for sitting **above** the `$project`:
   * `customerId` survives it only for an admin and for the customer themselves.
   * The vendor projection omits it deliberately, and joining after the
   * projection would mean this block is simply empty for the one audience it
   * was added for — with no error and nothing in the response saying why.
   *
   * ⚠️ No `isDeleted` filter here either. A customer who closes their account
   * does not erase the sale a brand already made and will be settled for.
   */
  if (exports.showsCustomerIdentity(actor.role)) {
    pipeline.push(
      ...buildAggregateLookup({
        from: "customers",
        localField: "customerId",
        as: "customer",
        project: exports.customerIdentityProjection(actor.role),
      }),
    );
  }

  // ⚠️ Must stay below the lookups above. The next lines mutate
  // `pipeline[pipeline.length - 1]`, so anything pushed after this point would
  // have its own stage rewritten instead.
  pipeline.push({ $project: exports.claimProjection(actor.role) });
  // Added after the projection so the joins survive it — a `$project` drops
  // anything it does not name, joined fields included.
  pipeline[pipeline.length - 1].$project.brand = 1;
  pipeline[pipeline.length - 1].$project.outlet = 1;
  pipeline[pipeline.length - 1].$project.voucherVersion = 1;
  if (exports.showsCustomerIdentity(actor.role)) {
    pipeline[pipeline.length - 1].$project.customer = 1;
  }

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

  const pipeline = [{ $match: match }, { $sort: { createdAt: -1 } }];

  /**
   * ---------------- the two joins that must precede the projection ----------------
   *
   * `voucherVersionId` is named by **no** audience's `claimRecordProjection`,
   * and `customerId` only by the admin's and the customer's own. Both keys are
   * therefore gone by the time the brand join below runs, so these two cannot
   * follow the same "join after the projection" pattern — they have to read the
   * document while it still says which version and which buyer.
   *
   * Their output is re-admitted to the projection a few lines down, exactly the
   * way `buildClaimTransactionPipeline` re-admits `brand` and `outlet`.
   */
  pipeline.push(
    ...buildAggregateLookup({
      from: "voucherversions",
      localField: "voucherVersionId",
      as: "voucherVersion",
      project: exports.VOUCHER_VERSION_FIELDS,
    }),
  );

  if (exports.showsCustomerIdentity(actor.role)) {
    pipeline.push(
      ...buildAggregateLookup({
        from: "customers",
        localField: "customerId",
        as: "customer",
        project: exports.customerIdentityProjection(actor.role),
      }),
    );
  }

  // ⚠️ Must stay below the two lookups above, and above the brand joins below.
  // The next lines mutate `pipeline[pipeline.length - 1]`.
  pipeline.push({ $project: exports.claimRecordProjection(actor.role) });
  pipeline[pipeline.length - 1].$project.voucherVersion = 1;
  if (exports.showsCustomerIdentity(actor.role)) {
    pipeline[pipeline.length - 1].$project.customer = 1;
  }

  pipeline.push(
    /**
     * The brand, live — deliberately **alongside** `brandSnapshot`, not
     * instead of it.
     *
     * The snapshot is the whole reason a September claim still reads correctly
     * after the brand was renamed, and nothing here touches it. But
     * `merchantId` and `subscriptionPlan` are not history: they answer "who is
     * this brand today", and freezing them would be actively wrong — a
     * snapshot would show a plan the brand no longer holds, which is the exact
     * bug this change exists to remove.
     *
     * Joined after the projection because `brandId` survives it, so the whole
     * `$lookup` runs on already-narrowed rows.
     */
    ...buildAggregateLookup({
      from: "brands",
      localField: "brandId",
      as: "brand",
      project: { brandName: 1, logo: 1, merchantId: 1 },
    }),
    ...buildBrandPlanLookup({
      localField: "brandId",
      as: "brand.subscriptionPlan",
    }),
  );

  return pipeline;
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
