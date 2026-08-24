const Brand = require("../../models/Brand");
const {
  BUCKET_BRAND_FIELDS,
  BUCKET_LABELS,
} = require("../../constants/subscription");
const { throwError } = require("../../utils");

const fieldsFor = (bucket) => {
  const fields = BUCKET_BRAND_FIELDS[bucket];
  if (!fields) throw new Error(`Unknown entitlement bucket: ${bucket}`);
  return fields;
};

const labelFor = (bucket) =>
  BUCKET_LABELS[bucket] || { one: bucket, many: bucket, title: bucket };

/**
 * Atomically claim one slot in a metered plan pool.
 *
 * Deliberately *not* a read-then-write check: two concurrent creates would both
 * read `used < limit` and both pass, overshooting the plan. Instead the limit
 * test lives inside the update filter, so Mongo evaluates it and increments the
 * counter in a single atomic operation — if the filter does not match, nothing
 * is incremented and no slot is handed out.
 *
 * Generic over every bucket (outlets, franchises, vouchers, showcase sections)
 * so there is one implementation of the rule rather than one per domain.
 *
 * @param {string|object} brandId
 * @param {string} bucket  a key of BUCKET_BRAND_FIELDS
 * @returns {Promise<object>} the updated brand
 * @throws {CustomError} 403 when the pool is full or excluded from the plan
 */
exports.reserveSlot = async (brandId, bucket) => {
  const fields = fieldsFor(bucket);

  const brand = await Brand.findOneAndUpdate(
    {
      _id: brandId,
      isDeleted: false,
      $or: [
        { [fields.isUnlimited]: true },
        { $expr: { $lt: [`$${fields.used}`, `$${fields.limit}`] } },
      ],
    },
    { $inc: { [fields.used]: 1 } },
    { new: true },
  );

  if (brand) return brand;

  // The reserve failed. Re-read to say *why*, so the vendor gets something they
  // can act on instead of a bare "limit reached".
  const current = await Brand.findById(brandId)
    .select(`${fields.limit} ${fields.used} ${fields.isUnlimited} isDeleted`)
    .lean();

  if (!current || current.isDeleted) throwError(404, "Brand not found!");

  const label = labelFor(bucket);
  const limit = current[fields.limit] ?? 0;
  const used = current[fields.used] ?? 0;

  if (limit === 0) {
    throwError(
      403,
      `Your current plan does not include ${label.many}. Please upgrade your subscription to add ${label.many}.`,
    );
  }

  throwError(
    403,
    `${label.title} limit reached — ${used} of ${limit} used on your current plan. Please upgrade your subscription to add more.`,
  );
};

/**
 * Give a reserved slot back.
 *
 * Called when something downstream of a successful reserve fails, so a failed
 * create does not permanently eat a slot from the vendor's plan.
 *
 * Guarded so the counter can never go negative. Never throws — the caller is
 * already unwinding a more important error, and `recountBrandUsage` will
 * reconcile anything missed.
 */
exports.releaseSlot = async (brandId, bucket) => {
  const fields = fieldsFor(bucket);
  try {
    await Brand.updateOne(
      { _id: brandId, [fields.used]: { $gt: 0 } },
      { $inc: { [fields.used]: -1 } },
    );
  } catch (error) {
    console.error(
      `[releaseSlot] failed to release ${fields.used} for brand ${brandId}:`,
      error?.message,
    );
  }
};

/**
 * Move one item between two pools — used when a SubBrand's outletType changes.
 *
 * The claim on the target pool uses the same atomic filter as creation, so a
 * switch cannot overshoot its limit even under concurrency, and the source
 * pool's decrement rides along in the same operation.
 *
 * @returns {{ brand: object, revert: function }}
 */
exports.switchSlot = async (brandId, fromBucket, toBucket) => {
  const from = fieldsFor(fromBucket);
  const to = fieldsFor(toBucket);

  const brand = await Brand.findOneAndUpdate(
    {
      _id: brandId,
      isDeleted: false,
      $or: [
        { [to.isUnlimited]: true },
        { $expr: { $lt: [`$${to.used}`, `$${to.limit}`] } },
      ],
    },
    // The source pool is floored afterwards rather than filtered on — a drifted
    // counter should not block a legitimate change.
    { $inc: { [to.used]: 1, [from.used]: -1 } },
    { new: true },
  );

  if (!brand) {
    const current = await Brand.findById(brandId)
      .select(`${to.limit} ${to.used} ${to.isUnlimited} isDeleted`)
      .lean();
    if (!current || current.isDeleted) throwError(404, "Brand not found!");

    const label = labelFor(toBucket);
    const limit = current[to.limit] ?? 0;
    const used = current[to.used] ?? 0;

    if (limit === 0) {
      throwError(
        403,
        `Cannot switch — your current plan does not include ${label.many}. Please upgrade your subscription first.`,
      );
    }
    throwError(
      403,
      `Cannot switch — ${label.one} limit reached (${used} of ${limit} used on your current plan). Please upgrade your subscription or free up a ${label.one} first.`,
    );
  }

  if ((brand[from.used] ?? 0) < 0) {
    await Brand.updateOne({ _id: brandId }, { $set: { [from.used]: 0 } });
  }

  const revert = async () => {
    try {
      await Brand.updateOne(
        { _id: brandId },
        { $inc: { [to.used]: -1, [from.used]: 1 } },
      );
    } catch (error) {
      console.error(
        `[switchSlot] revert failed for brand ${brandId}:`,
        error?.message,
      );
    }
  };

  return { brand, revert };
};

exports.bucketLabel = labelFor;
