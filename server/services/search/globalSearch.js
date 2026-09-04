const { throwError } = require("../../utils");
const { getCustomerConfig } = require("../../helpers/settings");
const { resolveCustomerCoordinates } = require("../../helpers/customers");
const {
  SEARCH_RESULT_TYPES,
  SEARCH_SECTION_ORDER,
  SEARCH_SECTION_LABELS,
  SEARCH_LIMITS,
} = require("../../constants/search");
const {
  normalizeQuery,
  buildBrandSection,
  buildVoucherSection,
  buildCategorySection,
  buildSubCategorySection,
  buildAreaSection,
  recordSearchQuery,
} = require("../../helpers/search");

/**
 * The customer home screen's search box.
 *
 * Open to guests. A signed-in customer gets two extras and nothing else
 * changes: their saved address stands in for missing coordinates, and a
 * committed query is remembered.
 *
 * Two modes, decided by `type`:
 *   absent  → overview: every requested section, each with its first rows
 *   present → one section, paginated — see the note on `seeAll` below.
 */

const SECTION_BUILDERS = Object.freeze({
  [SEARCH_RESULT_TYPES.BRAND]: buildBrandSection,
  [SEARCH_RESULT_TYPES.VOUCHER]: buildVoucherSection,
  [SEARCH_RESULT_TYPES.CATEGORY]: buildCategorySection,
  [SEARCH_RESULT_TYPES.SUB_CATEGORY]: buildSubCategorySection,
  [SEARCH_RESULT_TYPES.AREA]: buildAreaSection,
});

const isTrue = (value) => value === true || value === "true";

/**
 * Save the term — but only when the app says the customer meant it.
 *
 * The search box calls this endpoint on every keystroke. Saving each one turns
 * a customer's recent list into "p, pi, piz, pizz, pizza" and makes the feature
 * worse than not having it. `commit=true` is sent on Enter or on opening a
 * result, and nowhere else.
 *
 * Awaited rather than fired and forgotten: an un-awaited promise that rejects
 * is an unhandled rejection, and in Node 24 that is fatal to the process. The
 * write itself is one indexed upsert and never throws — see `recordSearchQuery`.
 */
const commitHistory = ({ userId, query, term, normalized, config }) => {
  if (!isTrue(query.commit)) return null;
  return recordSearchQuery({
    userId,
    query: term,
    normalizedQuery: normalized,
    limit: config.historyLimit,
  });
};

exports.globalSearch = async (userId, query) => {
  const config = (await getCustomerConfig()).search;

  /**
   * ⚠️ A disabled search answers 200 with empty sections, not an error.
   *
   * A 404 or 503 reaches the app's generic error handler and paints a
   * something-broke screen — for what was an admin deliberately turning a
   * feature off. `isEnabled: false` on the response lets the app say so.
   */
  if (!config.isEnabled) {
    return {
      query: query.q,
      isEnabled: false,
      hasLocation: false,
      totalResults: 0,
      sections: [],
    };
  }

  const term = String(query.q || "").trim();
  const normalized = normalizeQuery(term);

  // Enforced here rather than in Joi: the minimum is admin-configurable, and a
  // Joi schema is built once at require time.
  if (term.length < config.minQueryLength) {
    throwError(
      422,
      `Search text must be at least ${config.minQueryLength} characters.`,
    );
  }

  /**
   * `required: false` — the same resolver the voucher feed uses, but a missing
   * location is not fatal here. A guest who declined the permission can still
   * look up a brand or a category by name; only the offers section needs a
   * point, and it says so on the response instead of failing the request.
   */
  const coordinates = await resolveCustomerCoordinates({
    userId,
    latitude: query.latitude,
    longitude: query.longitude,
    required: false,
  });
  const hasGeo = Boolean(coordinates);
  const latitude = coordinates?.latitude;
  const longitude = coordinates?.longitude;

  const base = { term, normalized, latitude, longitude, hasGeo };

  // ── Single-type mode ──────────────────────────────────────────────────────
  if (query.type) {
    const build = SECTION_BUILDERS[query.type];
    if (!build) {
      throwError(400, `Search does not support type ${query.type} yet.`);
    }
    const limit = Math.min(
      query.limit || config.sectionLimit,
      SEARCH_LIMITS.MAX_TYPE_LIMIT,
    );
    const section = await build({ ...base, page: query.page || 1, limit });
    await commitHistory({ userId, query, term, normalized, config });

    return {
      query: term,
      isEnabled: true,
      type: query.type,
      hasLocation: hasGeo,
      total: section.total,
      totalPages: section.totalPages,
      page: query.page || 1,
      limit,
      items: section.items,
    };
  }

  // ── Overview mode ─────────────────────────────────────────────────────────
  const requested = query.types?.length
    ? SEARCH_SECTION_ORDER.filter((type) => query.types.includes(type))
    : SEARCH_SECTION_ORDER;

  const limit = Math.min(
    query.limit || config.sectionLimit,
    SEARCH_LIMITS.MAX_SECTION_LIMIT,
  );

  /**
   * Every section at once.
   *
   * Sequentially, the voucher section's geo pipeline — six lookups over a 25 km
   * radius — would hold up four cheap queries behind it. A search box has to
   * answer while the customer is still typing the next character.
   */
  const built = await Promise.all(
    requested.map(async (type) => {
      const build = SECTION_BUILDERS[type];
      // A type in the enum with no builder yet (the phases land one at a time)
      // returns an honest empty section rather than throwing.
      if (!build) return [type, { total: 0, items: [], seeAll: null }];
      return [type, await build({ ...base, page: 1, limit })];
    }),
  );

  const sections = built.map(([type, section]) => ({
    type,
    label: SEARCH_SECTION_LABELS[type],
    total: section.total,
    items: section.items,
    seeAll: section.seeAll ?? null,
    ...(section.extra || {}),
  }));

  await commitHistory({ userId, query, term, normalized, config });

  return {
    query: term,
    isEnabled: true,
    hasLocation: hasGeo,
    totalResults: sections.reduce((sum, section) => sum + section.total, 0),
    // Empty sections are kept, not dropped. The app needs somewhere to say
    // "no brands matched", and `totalResults === 0` is what tells it nothing
    // matched at all.
    sections,
  };
};
