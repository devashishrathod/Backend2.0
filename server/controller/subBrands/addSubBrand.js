const { ROLES } = require("../../constants");
const { sendError, sendSuccess, generateReferralCode } = require("../../utils");
const { getSubscribedById } = require("../../service/subscribedServices");
const { createWorkHours } = require("../../service/workHoursServices");
const {
  updateUserById,
  generateUniqueUserId,
  addSubBrandsToBrandUser,
  getUserById,
} = require("../../service/userServices");
const {
  createLacation,
  getLocationByBrandAndSubBrandAddress,
  updateLocationByFields,
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
exports.addSubBrand = async (req, res) => {
  try {
    const brandVendor = req?.payload;
    const brandId = req?.params?.brandId;
    const checkBrand = await getBrandById(brandId);
    if (!checkBrand) return sendError(res, 404, "Brand not found!");
    if (!checkBrand?.isSubscribed) {
      return sendError(
        res,
        403,
        "Access denied. This feature requires an active subscription. Please subscribe to continue."
      );
    } else {
      const currentSubscribed = await getSubscribedById(checkBrand?.subscribed);
      if (currentSubscribed && currentSubscribed?.isExpired) {
        return sendError(
          res,
          403,
          "Your subscription has expired. Please renew or upgrade your plan to continue using this feature."
        );
      }
    }
    const { subBrandsLimit, subBrandsUsed } = checkBrand;
    if (subBrandsLimit == subBrandsUsed) {
      sendError(
        res,
        403,
        "Sub-brand Limit Exceeded! You have reached the maximum number of sub-brands allowed under your current plan. Please upgrade your subscription to add more sub-brands."
      );
    }
    let {
      subBrandUserId,
      companyName,
      companyEmail,
      currentScreen,
      shopOrBuildingNumber,
      address,
      area,
      city,
      state,
      country,
      zipCode,
      landMark,
      lat,
      lng,
      monday,
      tuesday,
      wednesday,
      thursday,
      friday,
      saturday,
      sunday,
    } = req.body;
    const subBrandUser = await getUserById(subBrandUserId);
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
    if ((lat && !lng) || (!lat && lng)) {
      return sendError(res, 409, "Both latitude and longitude are required.");
    }
    let checkLocation = await getLocationByBrandAndSubBrandAddress(
      brandId,
      subBrandUserId,
      shopOrBuildingNumber?.toLowerCase()
    );
    if (checkLocation) {
      return sendError(res, 409, "This outlet location already exist.");
    }
    const locationData = {
      shopOrBuildingNumber: shopOrBuildingNumber?.toLowerCase(),
      address: address?.toLowerCase(),
      area: area?.toLowerCase(),
      city: city?.toLowerCase(),
      state: state?.toLowerCase(),
      country: country?.toLowerCase(),
      zipCode: zipCode?.toLowerCase(),
      landMark: landMark?.toLowerCase(),
    };
    if (lat !== undefined && lng !== undefined && !isNaN(lat) && !isNaN(lng)) {
      locationData.location = {
        type: "Point",
        coordinates: [parseFloat(lng), parseFloat(lat)],
      };
    }
    const newSubBrandLocation = await createLacation({
      brand: brandId,
      user: subBrandUserId,
      ...locationData,
    });
    /** ----------- Update/Add Working Hours ------------ */
    let newWorking;
    const workingFields = {
      monday,
      tuesday,
      wednesday,
      thursday,
      friday,
      saturday,
      sunday,
    };
    const hasWorkingFields = Object.values(workingFields).some(
      (v) => v !== undefined
    );
    if (hasWorkingFields) {
      const parsedWorking = {};
      for (const [day, val] of Object.entries(workingFields)) {
        if (val !== undefined) {
          parsedWorking[day] = typeof val === "string" ? JSON.parse(val) : val;
        }
      }
      newWorking = await createWorkHours({
        user: subBrandUserId,
        brand: brandId,
        ...parsedWorking,
      });
    }
    const subBrandData = {
      companyName: companyName
        ? companyName?.toLowerCase()
        : checkBrand?.companyName,
      companyEmail: companyEmail
        ? companyEmail?.toLowerCase()
        : checkBrand?.email,
      whatsappNumber: subBrandUser?.whatsappNumber,
      user: subBrandUserId,
      brand: brandId,
      location: newSubBrandLocation?._id,
      workHours: newWorking._id,
      uniqueId: await generateUniqueSubBrandId(),
      currentScreen: currentScreen?.toUpperCase(),
      isSignUpCompleted: true,
      isOnBoardingCompleted: true,
    };
    const newSubBrand = await createSubBrand(subBrandData);
    if (!newSubBrand) {
      return sendError(res, 400, "Sub brand not added! try again");
    }
    await updateLocationByFields(
      { brand: brandId, user: subBrandUserId, isDeleted: false },
      { subBrand: newSubBrand?._id }
    );
    await addSubBrandsToBrand(brandId, newSubBrand?._id);
    await addSubBrandsToBrandUser(checkBrand?.user, newSubBrand?._id);
    await updateUserById(subBrandUserId, {
      companyEmail: companyEmail
        ? companyEmail?.toLowerCase()
        : checkBrand?.email,
      brand: brandId,
      subBrand: newSubBrand?._id,
      location: newSubBrandLocation?._id,
      workHours: newWorking._id,
      currentScreen: currentScreen?.toUpperCase(),
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
