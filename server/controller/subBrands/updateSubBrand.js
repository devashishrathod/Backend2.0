const { sendError, sendSuccess } = require("../../utils");
const {
  getBrandOrSubBrandUserById,
  getUserById,
} = require("../../service/userServices");
const {
  createWorkHours,
  getWorkHoursBySubBrandId,
} = require("../../service/workHoursServices");
const {
  getSubBrandById,
  getSubBrandWithAllDetails,
} = require("../../service/subBrandServices");
const {
  createLacation,
  getLocationBySubBrandId,
  getLocationByBrandAndSubBrandAddress,
} = require("../../service/locationServices");

// Update Sub Brand Details
exports.updateSubBrand = async (req, res) => {
  try {
    const subBrandId = req?.params?.subBrandId;
    const brandOrSubBrandVendorId = req?.payload;
    const checkVendorOrSubVendor = await getBrandOrSubBrandUserById(
      brandOrSubBrandVendorId
    );
    if (!checkVendorOrSubVendor)
      return sendError(res, 404, "Vendor/Sub-vendor not found!");
    const checksubBrand = await getSubBrandById(subBrandId);
    if (!checksubBrand)
      return sendError(res, 404, "No sub-brand/outlet found!");
    const subBrandOwnerId = checksubBrand?.user;
    const checkSubBrandUser = await getUserById(subBrandOwnerId);
    if (!checkSubBrandUser)
      return sendError(res, 404, "No sub-brand/outlet owner found!");
    const {
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
      isArchive,
      currentScreen,
      isOnBoardingCompleted,
    } = req.body;
    /** ----------- Update/Add Location ------------ */
    if (
      shopOrBuildingNumber ||
      address ||
      area ||
      city ||
      state ||
      zipCode ||
      landMark ||
      lat ||
      lng ||
      country
    ) {
      if ((lat && !lng) || (!lat && lng)) {
        return sendError(res, 409, "Both latitude and longitude are required.");
      }
      const checkExistingLocation = await getLocationByBrandAndSubBrandAddress(
        checkSubBrandUser?.brand,
        subBrandOwnerId,
        shopOrBuildingNumber?.toLowerCase()
      );
      if (checkExistingLocation) {
        return sendError(res, 409, "This outlet location already exist.");
      }
      let checkLocation = await getLocationBySubBrandId(subBrandId);
      const locationData = {
        shopOrBuildingNumber,
        address,
        area,
        city,
        state,
        country,
        zipCode,
        landMark,
      };
      if (
        lat !== undefined &&
        lng !== undefined &&
        !isNaN(lat) &&
        !isNaN(lng)
      ) {
        locationData.location = {
          type: "Point",
          coordinates: [parseFloat(lng), parseFloat(lat)],
        };
      }
      if (checkLocation) {
        Object.entries(locationData).forEach(([key, value]) => {
          if (value !== undefined) checkLocation[key] = value;
        });
        await checkLocation.save();
      } else {
        const newLocation = await createLacation({
          user: subBrandOwnerId,
          brand: checksubBrand?.brand,
          subBrand: subBrandId,
          ...locationData,
        });
        checksubBrand.location = newLocation._id;
        checkSubBrandUser.location = newLocation._id;
      }
    }
    /** ----------- Update/Add Working Hours ------------ */
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
      let checkWorking = await getWorkHoursBySubBrandId(subBrandId);
      if (checkWorking) {
        Object.entries(parsedWorking).forEach(([day, value]) => {
          checkWorking[day] = value;
        });
        await checkWorking.save();
      } else {
        const newWorking = await createWorkHours({
          user: subBrandOwnerId,
          brand: checksubBrand?.brand,
          subBrand: subBrandId,
          ...parsedWorking,
        });
        checksubBrand.workHours = newWorking._id;
        checkSubBrandUser.workHours = newWorking._id;
      }
    }
    /** ----------- Update Current Screen Or OnBoarding Flow ------------ */
    if (currentScreen) {
      checksubBrand.currentScreen = currentScreen;
      checkSubBrandUser.currentScreen = currentScreen;
    }
    if (isOnBoardingCompleted) {
      checksubBrand.isOnBoardingCompleted = isOnBoardingCompleted;
      checkSubBrandUser.isOnBoardingCompleted = isOnBoardingCompleted;
    }
    if (isArchive !== undefined) checksubBrand.isArchive = isArchive;
    await checksubBrand.save();
    await checkSubBrandUser.save();
    const updatedSubBrand = await getSubBrandWithAllDetails(subBrandId);
    return sendSuccess(
      res,
      200,
      "Sub-brand and sub-vendor details updated successfully.",
      { subBrand: updatedSubBrand }
    );
  } catch (error) {
    console.log("Error in updateSubBrandDetails:", error);
    return sendError(res, 500, error.message);
  }
};
