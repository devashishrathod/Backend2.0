const User = require("../../models/User");
const { throwError } = require("../../utils");

exports.getUserById = async (userId) => {
  const user = await User.findOne({ _id: userId, isDeleted: false })
    .select("-password -otp -isDeleted")
    .populate({
      path: "customerId",
      select: "-isDeleted -userId -__v -createdAt -updatedAt",
      populate: {
        path: "locationId",
        select: "-isDeleted -userId -__v -createdAt -updatedAt",
      },
    });
  if (!user) throwError(401, "Unauthorized access! User not found.");
  return user;
};
