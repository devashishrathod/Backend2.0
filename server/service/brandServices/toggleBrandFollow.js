const mongoose = require("mongoose");
const Follow = require("../../model/Follow");
const Brand = require("../../model/Brand");
const User = require("../../model/User");
const { throwError } = require("../../utils");

exports.toggleBrandFollow = async (userId, brandId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const brand = await Brand.findOne(
      { _id: brandId, isDeleted: false, isActive: true },
      null,
      { session }
    );
    if (!brand) throwError(404, "Brand not found.");
    const existing = await Follow.findOne(
      { follower: userId, followee: brandId },
      null,
      { session }
    );
    if (existing && !existing.isDeleted) {
      await Follow.updateOne(
        { _id: existing._id },
        { $set: { isDeleted: true, updatedAt: new Date() } },
        { session }
      );
      await Brand.updateOne(
        { _id: brandId },
        { $inc: { followersCount: -1 } },
        { session }
      );
      await User.updateOne(
        { _id: userId },
        { $inc: { followingBrandsCount: -1 } },
        { session }
      );
      await session.commitTransaction();
      session.endSession();
      return { followed: false, action: "unfollowed" };
    }
    if (existing && existing.isDeleted) {
      await Follow.updateOne(
        { _id: existing._id },
        { $set: { isDeleted: false, updatedAt: new Date() } },
        { session }
      );
      await Brand.updateOne(
        { _id: brandId },
        { $inc: { followersCount: 1 } },
        { session }
      );
      await User.updateOne(
        { _id: userId },
        { $inc: { followingBrandsCount: 1 } },
        { session }
      );
      await session.commitTransaction();
      session.endSession();
      return { followed: true, action: "restored" };
    }
    await Follow.create(
      [
        {
          follower: userId,
          followee: brandId,
          isDeleted: false,
        },
      ],
      { session }
    );
    await Brand.updateOne(
      { _id: brandId },
      { $inc: { followersCount: 1 } },
      { session }
    );
    await User.updateOne(
      { _id: userId },
      { $inc: { followingBrandsCount: 1 } },
      { session }
    );
    await session.commitTransaction();
    session.endSession();
    return { followed: true, action: "created" };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
};
