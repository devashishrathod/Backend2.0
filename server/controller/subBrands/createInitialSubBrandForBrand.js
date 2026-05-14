const { ROLES } = require("../../constants");
const { sendError, sendSuccess, generateReferralCode } = require("../../utils");
// const {
//   createWorkHours,
//   getWorkHoursByUserAndBrandId,
// } = require("../../service/workHoursServices");
const {
  updateUserById,
  generateUniqueUserId,
  addSubBrandsToBrandUser,
  getUserByFields,
} = require("../../service/userServices");
const {
  createLacation,
  updateLocationByFields,
  getLocationByUserAndBrandId,
} = require("../../service/locationServices");
const {
  createSubBrand,
  generateUniqueSubBrandId,
  getSubBrandWithAllDetails,
} = require("../../service/subBrandServices");
const {
  addSubBrandsToBrand,
  getBrandById,
  getBrandWithAllDetails,
} = require("../../service/brandServices");

// Add Sub-Vendor brand by Original/Head Brand Vendor
exports.createInitialSubBrandForBrand = async (req, res) => {
  try {
    const brandVendor = req?.payload;
    const brandId = req?.params?.brandId;
    const checkBrand = await getBrandById(brandId);
    if (!checkBrand) return sendError(res, 404, "Brand not found!");
    const subBrandUser = await getUserByFields({
      whatsappNumber: brandVendor?.whatsappNumber,
      role: ROLES.SUB_VENDOR,
    });
    if (!subBrandUser) {
      return sendError(res, 404, "Sub-Vendor user not found!");
    }
    let errorMsg = null;
    if (
      !brandVendor ||
      brandVendor?.role !== ROLES.VENDOR ||
      !brandVendor?.isMobileVerified ||
      !brandVendor?.brand ||
      !subBrandUser ||
      !subBrandUser?.isMobileVerified ||
      subBrandUser?.subBrand
    ) {
      if (!brandVendor) {
        errorMsg = "Access denied. Vendor not found.";
      } else if (brandVendor?.role !== ROLES.VENDOR) {
        errorMsg = "Access restricted. Only vendor can perform this action.";
      } else if (
        !subBrandUser &&
        !brandVendor?.isMobileVerified &&
        !subBrandUser?.isMobileVerified
      ) {
        errorMsg = "Please verify your mobile number to proceed.";
      } else if (!brandVendor?.brand) {
        errorMsg =
          "You have not authorized to add sub-brand! Please first register your head brand";
      } else if (subBrandUser?.subBrand) {
        errorMsg =
          "You are already registered a sub-brand with this mobile number! Please change mobile number and register again";
      }
      return sendError(res, 403, errorMsg);
    }
    /** ----------- Add Location ------------ */
    let checkLocation = await getLocationByUserAndBrandId(
      brandId,
      brandVendor?._id
    );
    const newSubBrandLocation = await createLacation({
      brand: brandId,
      user: subBrandUser?._id,
      location: {
        type: "Point",
        coordinates:
          checkLocation?.location?.coordinates?.length === 2
            ? checkLocation.location.coordinates
            : [0, 0],
      },
      shopOrBuildingNumber: checkLocation?.shopOrBuildingNumber,
      area: checkLocation?.area,
      country: checkLocation?.country,
      zipCode: checkLocation?.zipCode,
      landMark: checkLocation?.landMark,
      address: checkLocation?.address,
      city: checkLocation?.city,
      state: checkLocation?.state,
    });
    /** ----------- Update/Add Working Hours ------------ */
    // const brandWorking = getWorkHoursByUserAndBrandId(
    //   brandId,
    //   brandVendor?._id
    // );
    // const newWorking = await createWorkHours({
    //   user: subBrandUser?._id,
    //   brand: brandId,
    //   ...brandWorking,
    // });
    const subBrandData = {
      companyName: checkBrand?.companyName,
      companyEmail: checkBrand?.companyEmail,
      whatsappNumber: subBrandUser?.whatsappNumber,
      user: subBrandUser?._id,
      brand: brandId,
      location: newSubBrandLocation?._id,
      //  workHours: newWorking?._id,
      uniqueId: await generateUniqueSubBrandId(),
      currentScreen: "HOME_SCREEN",
      isSignUpCompleted: true,
      isOnBoardingCompleted: true,
    };
    const newSubBrand = await createSubBrand(subBrandData);
    if (!newSubBrand) {
      return sendError(res, 400, "Sub brand not added! try again");
    }
    await updateLocationByFields(
      { brand: brandId, user: subBrandUser?._id, isDeleted: false },
      { subBrand: newSubBrand?._id }
    );
    await addSubBrandsToBrand(brandId, newSubBrand?._id);
    await addSubBrandsToBrandUser(checkBrand?.user, newSubBrand?._id);
    await updateUserById(subBrandUser?._id, {
      companyEmail: checkBrand?.companyEmail,
      brand: brandId,
      subBrand: newSubBrand?._id,
      location: newSubBrandLocation?._id,
      // workHours: newWorking._id,
      currentScreen: "HOME_SCREEN",
      uniqueId: await generateUniqueUserId(),
      referCode: generateReferralCode(6),
      subBrands: undefined,
      isSignUpCompleted: true,
      isOnBoardingCompleted: true,
    });
    const updatedSubBrand = await getSubBrandWithAllDetails(newSubBrand?._id);
    const updatedBrand = await getBrandWithAllDetails(brandId);
    return sendSuccess(res, 201, "Sub Brand added successfully", {
      brand: updatedBrand,
      subBrand: updatedSubBrand,
    });
  } catch (error) {
    console.log("error on addBrand: ", error);
    return sendError(res, 500, error.message);
  }
};
