const mongoose = require("mongoose");
const Brand = require("../../models/Brand");
const BrandAvoidance = require("../../models/BrandAvoidance");
const { throwError, CustomError } = require("../../utils");
const { resolveCustomerByUserId } = require("../../helpers/customers");

exports.toggleBrandAvoidance = async (userId, brandId) => {
  const customer = await resolveCustomerByUserId(userId);

  const session = await mongoose.startSession();
  let avoided;

  try {
    await session.withTransaction(async () => {
      const brand = await Brand.findOne({
        _id: brandId,
        isDeleted: false,
      }).session(session);
      if (!brand) throwError(404, "Brand not found.");

      const existing = await BrandAvoidance.findOne({
        customerId: customer._id,
        brandId: brand._id,
      }).session(session);

      if (!existing) {
        await BrandAvoidance.create(
          [
            {
              customerId: customer._id,
              brandId: brand._id,
              isDeleted: false,
            },
          ],
          { session },
        );
        avoided = true;
      } else if (existing.isDeleted) {
        existing.isDeleted = false;
        await existing.save({ session });
        avoided = true;
      } else {
        existing.isDeleted = true;
        await existing.save({ session });
        avoided = false;
      }

      if (avoided) {
        await Brand.updateOne(
          { _id: brand._id },
          { $inc: { avoidanceCount: 1 } },
        ).session(session);
      } else {
        await Brand.updateOne(
          { _id: brand._id, avoidanceCount: { $gt: 0 } },
          { $inc: { avoidanceCount: -1 } },
        ).session(session);
      }
    });
  } catch (error) {
    if (error instanceof CustomError) throw error;
    console.error("Error toggling brand avoidance:", error.message);
    throwError(500, "Failed to toggle brand avoidance.");
  } finally {
    await session.endSession();
  }

  const brand = await Brand.findById(brandId).select("avoidanceCount");
  return { brandId, avoided, avoidanceCount: brand?.avoidanceCount ?? 0 };
};
