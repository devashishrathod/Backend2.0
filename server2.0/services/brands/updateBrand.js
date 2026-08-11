const mongoose = require("mongoose");
const Brand = require("../../models/Brand");
const User = require("../../models/User");
const SubCategory = require("../../models/SubCategory");
const { SCREENS } = require("../../constants");
const { throwError } = require("../../utils");
const { uploadImage, deleteImage } = require("../uploads");

exports.updateBrand = async (brandId, payload = {}, logo = null) => {
  const session = await mongoose.startSession();
  let oldLogo = null;
  let uploadedLogo = null;
  let brandResult = null;
  try {
    await session.withTransaction(async () => {
      const brand = await Brand.findOne({
        _id: brandId,
        isDeleted: false,
      }).session(session);

      if (!brand) throwError(404, "Brand not found!");

      const user = await User.findOne({
        _id: brand.userId,
        isDeleted: false,
      }).session(session);
      if (!user) throwError(404, "User not found!");

      const {
        brandName,
        email,
        description,
        joinedDate,
        isActive,
        subCategoryId,
        isOnboarding,
      } = payload;

      if (brandName) brand.brandName = brandName.trim().toLowerCase();
      if (email) brand.email = email;
      if (description) brand.description = description
      if (joinedDate) brand.joinedDate = new Date(joinedDate);
      if (isActive !== undefined) brand.isActive = isActive;

      if (isOnboarding === true) {
        if (!subCategoryId) {
          throwError(400, "subCategoryId is required during onboarding!");
        }
        const subCategory = await SubCategory.findOne({
          _id: subCategoryId,
          isDeleted: false,
        }).session(session);
        if (!subCategory) throwError(404, "Sub-category not found!");
        if (!subCategory.categoryId) {
          throwError(
            400,
            "Selected sub-category is not linked with any category!",
          );
        }
        brand.subCategoryId = subCategory._id;
        brand.categoryId = subCategory.categoryId;
        user.currentScreen = SCREENS.UNDER_REVIEW;
        await user.save({ session });
      }
      if (logo) {
        oldLogo = brand.logo || null;
        uploadedLogo = await uploadImage(logo.tempFilePath);
        brand.logo = uploadedLogo;
      }
      brand.updatedAt = new Date();
      await brand.save({ session });
      brandResult = brand;
    });

    if (uploadedLogo && oldLogo) {
      try {
        await deleteImage(oldLogo);
      } catch (deleteError) {
        console.error("Failed to delete old brand logo:", deleteError);
      }
    }
    return brandResult;
  } catch (error) {
    if (uploadedLogo) {
      try {
        await deleteImage(uploadedLogo);
      } catch (deleteError) {
        console.error("Failed to cleanup uploaded brand logo:", deleteError);
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }
};
