const mongoose = require("mongoose");
const Follow = require("../../models/Follow");
const Brand = require("../../models/Brand");
const { throwError, CustomError } = require("../../utils");
const { resolveCustomerByUserId } = require("../../helpers/customers");

exports.toggleFollow = async (userId, brandId) => {
  const customer = await resolveCustomerByUserId(userId);

  const session = await mongoose.startSession();
  let followed;

  try {
    await session.withTransaction(async () => {
      const brand = await Brand.findOne({
        _id: brandId,
        isDeleted: false,
      }).session(session);
      if (!brand) throwError(404, "Brand not found.");

      const existing = await Follow.findOne({
        followerId: customer._id,
        followeeId: brand._id,
      }).session(session);

      if (!existing) {
        await Follow.create(
          [
            {
              followerId: customer._id,
              followeeId: brand._id,
              isDeleted: false,
            },
          ],
          { session },
        );
        followed = true;
      } else if (existing.isDeleted) {
        existing.isDeleted = false;
        await existing.save({ session });
        followed = true;
      } else {
        existing.isDeleted = true;
        await existing.save({ session });
        followed = false;
      }

      if (followed) {
        await Brand.updateOne(
          { _id: brand._id },
          { $inc: { followersCount: 1 } },
        ).session(session);
      } else {
        await Brand.updateOne(
          { _id: brand._id, followersCount: { $gt: 0 } },
          { $inc: { followersCount: -1 } },
        ).session(session);
      }
    });
  } catch (error) {
    if (error instanceof CustomError) throw error;
    console.error("Error toggling brand follow:", error.message);
    throwError(500, "Failed to toggle brand follow.");
  } finally {
    await session.endSession();
  }

  const brand = await Brand.findById(brandId).select("followersCount");
  return { brandId, followed, followersCount: brand?.followersCount ?? 0 };
};
