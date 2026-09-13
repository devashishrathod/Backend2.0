const BrandFeatures = require("../../models/BrandFeatures");
const { resolveActorBrand } = require("../../helpers/brands");
const { throwError } = require("../../utils");
const storage = require("../storage");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

/**
 * @param {{ userId: string, role: string, brandId?: string }} actor
 * @param {object} payload  carries `featureId`; the brand comes off the feature
 */
exports.updateBrandFeature = async (actor, payload, icon) => {
  const { featureId, title, description, isActive } = payload;
  const feature = await BrandFeatures.findOne({
    _id: featureId,
    isDeleted: false,
  });
  /**
   * ⚠️ `throwError` was used on three lines of this file and imported on none,
   * so each of them raised `ReferenceError: throwError is not defined` instead.
   * A missing feature answered 500 rather than 404, and — worse — the ten-active
   * limit below could not report itself either: a vendor at the cap got an
   * unexplained server error instead of being told what the limit was.
   */
  if (!feature) throwError(404, "Brand feature not found!");

  /**
   * Was `Brand.exists({ _id: feature.brandId })` — existence, not ownership.
   * Any vendor could edit any brand's feature by knowing its id, and replacing
   * the icon destroys the previous one, so the damage was not limited to this
   * record. Checked against the brand the feature belongs to, which is the only
   * brand this call may touch.
   */
  await resolveActorBrand(actor, feature.brandId);

  const requestedActive =
    isActive === undefined
      ? feature.isActive
      : typeof isActive === "string"
        ? isActive === "true"
        : isActive;

  if (requestedActive === true && feature.isActive === false) {
    const activeFeatureCount = await BrandFeatures.countDocuments({
      brandId: feature.brandId,
      isActive: true,
      isDeleted: false,
      _id: { $ne: featureId },
    });
    if (activeFeatureCount >= 10) {
      throwError(400, "A brand can have maximum 10 active features!");
    }
  }

  if (title) feature.title = title;
  if (description) feature.description = description;
  /**
   * ⚠️ `if (isActive)` before, which is falsy for the boolean `false` — so
   * turning a feature **off** was accepted, answered "updated successfully",
   * and changed nothing. It only appeared to work from the panel because a
   * multipart form sends the string `"false"`, which is truthy; a JSON update
   * with no icon sent the real boolean and was silently dropped.
   */
  if (isActive !== undefined) feature.isActive = requestedActive;

  if (icon) {
    const oldIcon = feature.icon;
    feature.icon = await storage.uploadUrl({
      filePath: icon.tempFilePath,
      originalFile: icon,
      purpose: UPLOAD_PURPOSE.BRAND_FEATURE_ICON,
      entityId: feature._id,
    });
    await feature.save();
    if (oldIcon) {
      try {
        await storage.deleteAsset({ url: oldIcon });
      } catch (error) {
        console.error("Failed to delete old feature icon:", error);
      }
    }
    return feature;
  }
  await feature.save();
  return feature;
};
