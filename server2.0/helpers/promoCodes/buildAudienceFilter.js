const { PROMO_AUDIENCE } = require("../../constants/promoCode");

/**
 * The Mongo filter that selects one audience's promo codes — or its ledger rows.
 *
 * The asymmetry is the whole point. `audience` was added after these codes and
 * their `PromoCodeUsage` rows already existed, and a Mongoose default applies on
 * **write** only, so every pre-existing document has no `audience` field at all.
 * Those are vendor subscription codes by definition — that was the only kind —
 * so:
 *
 *   CUSTOMER -> `{ audience: "CUSTOMER" }`   (explicit; only new rows can be one)
 *   VENDOR   -> `{ audience: { $ne: "CUSTOMER" } }`
 *
 * Matching `VENDOR` exactly would quietly hide every legacy code from the admin
 * listing and drop every legacy claim out of the campaign report — a filter that
 * looks like it works, returns a smaller number, and never errors.
 *
 * Kept in one place so the listing, the report and the checkout validator cannot
 * drift on it. Verified against the live dev DB: 4 of the codes there predate the
 * field.
 *
 * @param {string} [audience] PROMO_AUDIENCE value; anything falsy means "both"
 * @returns {object} spreadable filter fragment — `{}` when no audience is given
 */
exports.buildAudienceFilter = (audience) => {
  if (!audience) return {};
  if (audience === PROMO_AUDIENCE.CUSTOMER) {
    return { audience: PROMO_AUDIENCE.CUSTOMER };
  }
  return { audience: { $ne: PROMO_AUDIENCE.CUSTOMER } };
};
