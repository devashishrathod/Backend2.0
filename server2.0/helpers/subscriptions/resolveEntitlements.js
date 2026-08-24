const {
  ENTITLEMENT_SOURCE,
  DEFAULT_ENTITLEMENTS,
  METERED_ENTITLEMENTS,
  FLAG_ENTITLEMENTS,
  ENTITLEMENT_FEATURE_TITLES,
  UNLIMITED_TOKENS,
  TRUTHY_TOKENS,
  FALSY_TOKENS,
} = require("../../constants/subscription");

const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/**
 * Which entitlement key, if any, a free-text feature title refers to.
 * Exact match on the normalized title only — no fuzzy matching, because a
 * wrong guess here silently changes what a paying vendor is allowed to do.
 */
const matchEntitlementKey = (title) => {
  const needle = normalize(title);
  if (!needle) return null;
  for (const [key, aliases] of Object.entries(ENTITLEMENT_FEATURE_TITLES)) {
    if (aliases.includes(needle)) return key;
  }
  return null;
};

/**
 * Read a count out of a legacy free-text value.
 *
 * Returns `{ isUnlimited }`, `{ limit }`, or null when the string carries no
 * count at all. "Yes" is the important null case: it says the feature exists
 * but not how much of it, so it cannot produce a limit.
 */
const parseMeteredValue = (rawValue, available) => {
  if (available === false) return { limit: 0, isUnlimited: false };

  const value = normalize(rawValue);
  if (!value) return null;
  if (UNLIMITED_TOKENS.includes(value)) return { limit: 0, isUnlimited: true };
  if (FALSY_TOKENS.includes(value)) return { limit: 0, isUnlimited: false };

  // "01" -> 1, "15" -> 15, "5 outlets" -> 5
  const digits = value.match(/\d+/);
  if (digits) {
    return { limit: Number.parseInt(digits[0], 10), isUnlimited: false };
  }

  // "yes"/"included" — the feature is on but the count is unknown.
  return null;
};

const parseFlagValue = (rawValue, available) => {
  if (available === false) return { isEnabled: false };
  const value = normalize(rawValue);
  if (TRUTHY_TOKENS.includes(value)) return { isEnabled: true };
  if (FALSY_TOKENS.includes(value)) return { isEnabled: false };
  // A number or a blank value alongside available !== false still means "on".
  return { isEnabled: available !== false };
};

const hasConfiguredEntitlements = (entitlements) => {
  if (!entitlements) return false;
  const plain =
    typeof entitlements.toObject === "function"
      ? entitlements.toObject()
      : entitlements;

  const meteredSet = METERED_ENTITLEMENTS.some((key) => {
    const bucket = plain?.[key];
    return Boolean(bucket) && (bucket.isUnlimited || bucket.limit > 0);
  });
  const flagSet = FLAG_ENTITLEMENTS.some((key) => plain?.[key]?.isEnabled);
  return meteredSet || flagSet;
};

const clone = (source) => ({
  subBrands: { ...source.subBrands },
  franchises: { ...source.franchises },
  vouchers: { ...source.vouchers },
  dealPack: { ...source.dealPack },
  prioritySupport: { ...source.prioritySupport },
  showcase: { ...source.showcase },
});

/**
 * Resolve the entitlements actually to be enforced for a plan.
 *
 * Resolution order:
 *   1. `subscription.entitlements` — the structured field. Always wins.
 *   2. Parsed out of the legacy free-text `features[]`. A compatibility bridge
 *      for plans created before `entitlements` existed, and the *only* place in
 *      the codebase that reads display strings for enforcement.
 *   3. `DEFAULT_ENTITLEMENTS` — deliberately stingy.
 *
 * Anything the bridge cannot determine (e.g. `Franchise: "Yes"`, which has no
 * count) is reported in `warnings` and left at the default, so a missing number
 * never silently becomes unlimited.
 *
 * @returns {{ entitlements: object, source: string, warnings: string[] }}
 */
exports.resolveEntitlements = (subscription) => {
  const warnings = [];

  if (hasConfiguredEntitlements(subscription?.entitlements)) {
    const stored =
      typeof subscription.entitlements.toObject === "function"
        ? subscription.entitlements.toObject()
        : subscription.entitlements;
    return {
      entitlements: { ...clone(DEFAULT_ENTITLEMENTS), ...stored },
      source: ENTITLEMENT_SOURCE.DB,
      warnings,
    };
  }

  const features = Array.isArray(subscription?.features)
    ? subscription.features
    : [];

  if (!features.length) {
    return {
      entitlements: clone(DEFAULT_ENTITLEMENTS),
      source: ENTITLEMENT_SOURCE.DEFAULT,
      warnings: [
        `Plan "${subscription?.name || "unknown"}" has no entitlements and no features to derive them from. Falling back to defaults.`,
      ],
    };
  }

  const resolved = clone(DEFAULT_ENTITLEMENTS);
  let derivedAnything = false;

  for (const feature of features) {
    const key = matchEntitlementKey(feature?.title);
    if (!key) continue;

    if (METERED_ENTITLEMENTS.includes(key)) {
      const parsed = parseMeteredValue(feature?.value, feature?.available);
      if (parsed) {
        resolved[key] = parsed;
        derivedAnything = true;
      } else {
        warnings.push(
          `Plan "${subscription?.name}": feature "${feature?.title}" = "${feature?.value}" carries no count, so the ${key} limit fell back to ${DEFAULT_ENTITLEMENTS[key].limit}. Set entitlements.${key} explicitly on this plan.`,
        );
      }
      continue;
    }

    if (FLAG_ENTITLEMENTS.includes(key)) {
      resolved[key] = parseFlagValue(feature?.value, feature?.available);
      derivedAnything = true;
    }
  }

  return {
    entitlements: resolved,
    source: derivedAnything
      ? ENTITLEMENT_SOURCE.DERIVED
      : ENTITLEMENT_SOURCE.DEFAULT,
    warnings,
  };
};
