const mongoose = require("mongoose");
const { toDisplayName } = require("../../helpers/common");

const BrandFeatures = require("../../models/BrandFeatures");
const { resolveActorBrand } = require("../../helpers/brands");
const { throwError } = require("../../utils");
const storage = require("../storage");
const { describeIncoming } = storage;
const {
  assertImageFile,
  toMediaDocument,
  discardOnFailure,
} = require("../../helpers/media");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

/**
 * @param {{ userId: string, role: string, brandId?: string }} actor
 * @param {object} payload  carries `brandId` — required, and now verified
 */
exports.addBrandFeature = async (actor, payload, icon) => {
  const { brandId, title, description, isActive = true } = payload;

  /**
   * Was `Brand.findOne({ _id: brandId })` — which asked whether the brand
   * exists, never whether the caller owns it. `brandId` arrives in the body, so
   * any vendor could add a feature to any brand simply by naming it. The route
   * gate (`isVendorOrAdmin`) only established that the caller was *a* vendor.
   *
   * `resolveActorBrand` is the same check the showcase, voucher and
   * subscription writes use: an admin may name any brand, a vendor only their
   * own, and ownership is read off the brand rather than trusted from the token.
   */
  const brand = await resolveActorBrand(actor, brandId);

  if (isActive === true || isActive === "true") {
    const activeFeatureCount = await BrandFeatures.countDocuments({
      brandId: brand._id,
      isActive: true,
      isDeleted: false,
    });
    if (activeFeatureCount >= 10) {
      throwError(400, "A brand can have maximum 10 active features!");
    }
  }

  /**
   * ⚠️ Described before it is spent (U-5). Everything above can still refuse —
   * the ten-feature ceiling most of all — so the upload has to stay spendable
   * until this point.
   */
  assertImageFile(icon, "Feature icon");
  const incoming = await describeIncoming(actor, {
    file: icon,
    uploadId: payload.iconUploadId,
    purpose: UPLOAD_PURPOSE.BRAND_FEATURE_ICON,
  });
  if (!incoming) throwError(400, "Feature icon is required!");

  // Minted up front: the icon's key carries the feature id, and the upload has
  // to happen before the row exists.
  const _id = new mongoose.Types.ObjectId();

  /**
   * 🔴 This used to sit in a `try` that turned **every** failure into
   * `500 Failed to upload feature icon!`.
   *
   * That was already wrong — a vendor attaching a PDF got a 500 with nothing in
   * it to act on — and G1/G2 made it worse, because the facade now answers with
   * the specific refusals: `413` naming the 2 MB ceiling, `422` naming the type
   * it found in the bytes. Flattening those to a 500 would throw away the only
   * sentence the vendor can do anything with.
   *
   * A genuine provider failure still surfaces, with its own status, from the one
   * place that knows what actually went wrong.
   */
  const uploaded = await storage.acceptUpload(actor, {
    file: incoming.file,
    uploadId: incoming.uploadId,
    purpose: UPLOAD_PURPOSE.BRAND_FEATURE_ICON,
    entityId: _id,
  });

  // ⚠️ The icon goes back out if the row does not arrive — see `createCategory`.
  return await discardOnFailure(uploaded, () =>
    BrandFeatures.create({
      _id,
      brandId: brand._id,
      title: toDisplayName(title),
      description,
      icon: uploaded.url,
      iconMedia: toMediaDocument(uploaded),
      isActive: typeof isActive === "string" ? isActive === "true" : isActive,
    }),
  );
};
