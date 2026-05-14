const Brand = require("../../model/Brand");
const SubBrand = require("../../model/SubBrand");
const Image = require("../../model/Image");
const { createImage } = require("../../service/imageServices");
const { sendError, sendSuccess } = require("../../utils");

const FIELD_MAP = ["gallery", "menu"];

exports.updateImagesForBrandOrSubBrand = async (req, res) => {
  try {
    const entityId = req.params?.entityId;
    const { fieldType, newImages, deletedImageIds, type } = req.body;
    if (!entityId || !fieldType || !type) {
      return sendError(res, 400, "Missing required fields");
    }
    if (!FIELD_MAP.includes(fieldType)) {
      return sendError(
        res,
        400,
        "Invalid fieldType. Must be 'gallery' or 'menu'"
      );
    }
    let entityType = null;
    let brand = null;
    let user = null;
    let subBrand = null;

    const brandDoc = await Brand.findOne({ _id: entityId, isDeleted: false });
    if (brandDoc) {
      entityType = "brand";
      brand = brandDoc._id;
      user = brandDoc.user;
    } else {
      const subBrandDoc = await SubBrand.findOne({
        _id: entityId,
        isDeleted: false,
      });
      if (!subBrandDoc) {
        return sendError(res, 404, "No brand or subBrand found with given ID");
      }
      entityType = "subBrand";
      subBrand = subBrandDoc._id;
      brand = subBrandDoc.brand;
      user = subBrandDoc.user;
    }

    const Model = entityType === "brand" ? Brand : SubBrand;
    const entity = await Model.findOne({ _id: entityId, isDeleted: false });

    const newImagesArray = Array.isArray(newImages) ? newImages : [newImages];
    const deletedImagesIds = Array.isArray(deletedImageIds)
      ? deletedImageIds
      : [deletedImageIds];

    if (deletedImagesIds && deletedImagesIds.length > 0) {
      await Image.updateMany(
        { _id: { $in: deletedImagesIds } },
        { $set: { isDeleted: true, isActive: false } }
      );
      entity[fieldType] = (entity[fieldType] || []).filter(
        (imgId) => !deletedImagesIds.includes(imgId.toString())
      );
    }
    let createdImages = [];
    if (newImagesArray && newImagesArray.length > 0) {
      createdImages = await Promise.all(
        newImagesArray.map((img) =>
          createImage({
            user,
            brand,
            subBrand,
            imageUrl: img.imageUrl,
            filename: img.filename,
            size: img.size,
            mime: img.mime,
            type,
          })
        )
      );
      const newImageIds = createdImages.map((img) => img._id.toString());
      entity[fieldType] = [
        ...new Set([...(entity[fieldType] || []), ...newImageIds]),
      ];
    }
    await entity.save();
    return sendSuccess(
      res,
      200,
      `Images updated in ${entityType}'s ${fieldType}`,
      {
        addedImages: createdImages,
        deletedImageIds,
        updatedField: entity[fieldType],
      }
    );
  } catch (error) {
    console.error("Error in updateImagesForBrandOrSubBrand:", error);
    return sendError(res, 500, error.message);
  }
};
