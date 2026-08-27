const Brand = require("../../models/Brand");
const GST = require("../../models/GST");
const User = require("../../models/User");

/**
 * Neutral last resort. A greeting reading "Hey there" is fine; a WhatsApp
 * template variable arriving empty is not — Meta rejects the message, and the
 * rejection happens downstream where nobody sees it.
 */
const FALLBACK_NAME = "there";

/**
 * Who a brand is, for the purpose of addressing them in a notification.
 *
 * One place resolves this so every channel — in-app, email, WhatsApp, push —
 * greets the same vendor by the same name. Without it each notice would pick
 * whichever field it happened to know about, and the same vendor would be
 * "Zomato" in an email and "ZOMATO PRIVATE LIMITED" on WhatsApp.
 *
 * Precedence, deliberate:
 *
 *   1. `GST.legalName`          — the registered legal name. Authoritative,
 *                                 because it came from the GST portal rather
 *                                 than from something the vendor typed.
 *   2. `Brand.brandName`        — the trading name they chose.
 *   3. `Brand.legalBusinessName`— what they typed at onboarding, before GST
 *                                 verification had anything to say.
 *   4. the owner's own name, then `"there"`.
 *
 * Returns both a `name` (how to greet them) and a `brandName` (what to call the
 * business), because a good message uses both: *"Hey Zomato, your brand Zomato
 * Kitchens is approved."* They can be the same string, and that is fine.
 *
 * **Never throws.** Called only from notification paths, which must not be able
 * to fail the operation that triggered them — so a lookup failure degrades to
 * whatever the caller already had.
 *
 * @param {object|string} brandOrId  a brand document (or lean object), or its id
 * @returns {Promise<{brandId, name, brandName, legalName, email, phone, userId}>}
 */
exports.resolveBrandIdentity = async (brandOrId) => {
  try {
    const isDoc = brandOrId && typeof brandOrId === "object";
    const brandId = isDoc ? brandOrId._id : brandOrId;

    // Re-read when the caller handed over an id, or a partial document that is
    // missing the fields the name precedence needs.
    let brand = isDoc ? brandOrId : null;
    const needsRead =
      !brand ||
      (brand.brandName === undefined && brand.legalBusinessName === undefined);

    if (needsRead && brandId) {
      brand = await Brand.findOne({ _id: brandId, isDeleted: false })
        .select(
          "_id userId brandName legalBusinessName email mobile whatsappNumber uniqueId merchantId",
        )
        .lean();
    }

    if (!brand) {
      return {
        brandId: brandId || null,
        name: FALLBACK_NAME,
        brandName: null,
        legalName: null,
        email: null,
        phone: null,
        userId: null,
      };
    }

    // The GST record is the authoritative source for the legal name, and it is
    // a separate document — so this is a second read rather than a field.
    let legalName = null;
    try {
      const gst = await GST.findOne({ brandId: brand._id, isDeleted: false })
        .select("legalName tradeName")
        .lean();
      legalName = gst?.legalName || gst?.tradeName || null;
    } catch {
      // A brand that has not reached GST verification yet simply has no record.
      legalName = null;
    }

    // Only read the user when the brand itself yields no name at all — the
    // common case needs no extra query.
    let ownerName = null;
    if (!legalName && !brand.brandName && !brand.legalBusinessName && brand.userId) {
      try {
        const user = await User.findById(brand.userId).select("name").lean();
        ownerName = user?.name || null;
      } catch {
        ownerName = null;
      }
    }

    const name =
      legalName ||
      brand.brandName ||
      brand.legalBusinessName ||
      ownerName ||
      FALLBACK_NAME;

    return {
      brandId: brand._id,
      userId: brand.userId || null,
      // How to greet them.
      name,
      // What to call the business. Falls back through the same chain so a
      // template variable is never empty, but prefers the trading name — that
      // is what a vendor recognises as "their brand".
      brandName:
        brand.brandName || legalName || brand.legalBusinessName || name,
      legalName,
      email: brand.email || null,
      phone: brand.whatsappNumber || brand.mobile || null,
      uniqueId: brand.uniqueId || null,
      merchantId: brand.merchantId || null,
    };
  } catch (error) {
    console.error("[resolveBrandIdentity] failed:", error?.message);
    return {
      brandId: null,
      userId: null,
      name: FALLBACK_NAME,
      brandName: null,
      legalName: null,
      email: null,
      phone: null,
    };
  }
};

exports.BRAND_IDENTITY_FALLBACK_NAME = FALLBACK_NAME;
