const Brand = require("../model/Brand");
const { ROLES } = require("../constants");
const { sendError } = require("../utils");

exports.loadBrand = async (req, res, next) => {
  try {
    const brandId = req.params?.brandId;
    const brand = await Brand.findOne({
      _id: brandId,
      isDeleted: false,
    }).populate("user");

    if (!brand || brand.isDeleted) {
      return sendError(res, 404, "Brand not found");
    }

    // const loggedInUserId = req.payload._id.toString();
    // const brandOwnerId = brand.user._id.toString();

    // if (loggedInUserId !== brandOwnerId) {
    //   return sendError(res, 403, "You are not authorized to access this brand");
    // }

    if (![ROLES.VENDOR, ROLES.ADMIN].includes(req.payload.role)) {
      return sendError(
        res,
        403,
        "Access denied! You are not authorized to access this brand"
      );
    }
    req.brand = brand;
    next();
  } catch (err) {
    console.log("error on loading Brand: ", err.message);
    return sendError(res, 500, err.message);
  }
};
