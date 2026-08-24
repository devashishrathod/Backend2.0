const {
  METERED_ENTITLEMENTS,
  BUCKET_BRAND_FIELDS,
  BUCKET_LABELS,
} = require("../../constants/subscription");

/**
 * Turn a brand's cached counters into a uniform per-pool usage summary.
 *
 * One shape used by every response that reports limits — the checkout preview,
 * the vendor's subscription page, activation, admin grant and cancel — so adding
 * a fifth metered pool never means updating five hand-written response blocks.
 *
 * `limit: null` means unlimited, which is friendlier for a client to render than
 * a `0` that has to be read together with a separate boolean.
 *
 * @param {object} brand
 * @param {object} [entitlements] when given, `limit` reflects the plan about to
 *        be applied rather than what is currently cached — used by previews.
 */
exports.summarizeUsage = (brand, entitlements) => {
  const summary = {};

  for (const bucket of METERED_ENTITLEMENTS) {
    const fields = BUCKET_BRAND_FIELDS[bucket];
    const used = brand?.[fields.used] ?? 0;

    const granted = entitlements?.[bucket];
    const isUnlimited = granted
      ? Boolean(granted.isUnlimited)
      : Boolean(brand?.[fields.isUnlimited]);
    const limit = granted ? (granted.limit ?? 0) : (brand?.[fields.limit] ?? 0);

    summary[bucket] = {
      used,
      limit: isUnlimited ? null : limit,
      isUnlimited,
      // 0 when unlimited or within the limit; positive after a grandfathered
      // downgrade left the brand over its new cap.
      overflowBy: isUnlimited ? 0 : Math.max(0, used - limit),
      label: BUCKET_LABELS[bucket]?.many || bucket,
    };
  }

  return summary;
};
