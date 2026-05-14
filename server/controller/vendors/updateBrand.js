const { sendError, sendSuccess } = require("../../utils");
const { getCategoryById } = require("../../service/categories");
const { getSubCategoryById } = require("../../service/subCategories");
const { addGst, getGstByNumber } = require("../../service/gstServices");
const { getUserByFields, getUserByPan } = require("../../service/userServices");
const {
  getBrandWithAllDetails,
  getBrandByUserAndVendorId,
} = require("../../service/brandServices");
const {
  createWorkHours,
  getWorkHoursByUserAndBrandId,
} = require("../../service/workHoursServices");
const {
  createLacation,
  getLocationByUserAndBrandId,
} = require("../../service/locationServices");
const {
  getBankByUserId,
  addBankAccount,
  updateBankAccountById,
  getBankByAccountNumber,
} = require("../../service/bankAccountServices");
const {
  isValidPAN,
  isValidGSTIN,
  isValidAccountNumber,
  isValidIFSC,
  isValidMICR,
  isValidUpiId,
  isValidAccountType,
} = require("../../validator/common");
const { ROLES } = require("../../constants");

// Update Brand Details
exports.updateBrand = async (req, res) => {
  try {
    const brandId = req.params?.id;
    const userId = req.query?.userId || req.payload?._id;
    const checkVendor = await getUserByFields({ _id: userId });
    if (!checkVendor) return sendError(res, 404, "Vendor not found!");
    if (checkVendor.role !== ROLES.VENDOR) {
      return sendError(res, 403, "You are not authorized to update brand!");
    }
    const checkBrand = await getBrandByUserAndVendorId(brandId, userId);
    if (!checkBrand) return sendError(res, 404, "No brand found!");
    const {
      categoryId,
      subCategoryId,
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
      panNumber: rawPanNumber,
      gstNumber: rawGstNumber,
      accountType,
      bankName,
      branchName,
      ifscCode,
      accountNumber,
      holderName,
      micrCode,
      upiId,
      upiName,
      currentScreen,
      isOnBoardingCompleted,
    } = req.body;
    /** ----------- Update Category/Subcategory ------------ */
    if (categoryId || subCategoryId) {
      const checkCategory = await getCategoryById(categoryId);
      if (!checkCategory) {
        return await sendError(res, 404, "Category not found!");
      }
      checkBrand.category = categoryId;
      const checkSubCategory = await getSubCategoryById(subCategoryId);
      if (!checkSubCategory) {
        return await sendError(res, 404, "Sub-Category not found!");
      }
      checkBrand.subCategory = subCategoryId;
    }
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
      let checkLocation = await getLocationByUserAndBrandId(brandId, userId);
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
          user: userId,
          brand: brandId,
          ...locationData,
        });
        checkBrand.location = newLocation._id;
        checkVendor.location = newLocation._id;
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
      (v) => v !== undefined,
    );
    if (hasWorkingFields) {
      const parsedWorking = {};
      for (const [day, val] of Object.entries(workingFields)) {
        if (val !== undefined) {
          parsedWorking[day] = typeof val === "string" ? JSON.parse(val) : val;
        }
      }
      let checkWorking = await getWorkHoursByUserAndBrandId(brandId, userId);
      if (checkWorking) {
        Object.entries(parsedWorking).forEach(([day, value]) => {
          checkWorking[day] = value;
        });
        await checkWorking.save();
      } else {
        const newWorking = await createWorkHours({
          user: userId,
          brand: brandId,
          ...parsedWorking,
        });
        checkBrand.workHours = newWorking._id;
        checkVendor.workHours = newWorking._id;
      }
    }
    /** ----------- Update PAN / GST with Validation ------------ */
    let panNumber = rawPanNumber?.toUpperCase();
    let gstNumber = rawGstNumber?.toUpperCase();
    let brandGst = null;
    if (panNumber) {
      const isValid = isValidPAN(panNumber);
      const checkPan = isValid ? await getUserByPan(panNumber) : null;
      if (!isValid || checkPan) {
        const message = !isValid
          ? "Invalid PAN number"
          : "PAN number already exists";
        return sendError(res, 400, message);
      }
      checkBrand.panNumber = panNumber;
      checkVendor.panNumber = panNumber;
    }
    if (gstNumber) {
      if (!isValidGSTIN(gstNumber)) {
        return sendError(res, 400, "Invalid GST number");
      }
      const checkGst = await getGstByNumber(gstNumber);
      if (checkGst) return sendError(res, 409, "GST already exists");
      const gstData = {
        gstNumber,
        panNumber: panNumber || null,
        companyName: checkBrand.companyName,
        user: userId,
        brand: brandId,
      };
      brandGst = await addGst(gstData);
      checkBrand.gst = brandGst._id;
      checkVendor.gst = brandGst._id;
    }
    /** ----------- Add Or Update Bank Account Details ------------ */
    if (
      accountType ||
      bankName ||
      branchName ||
      ifscCode ||
      accountNumber ||
      holderName ||
      micrCode ||
      upiId ||
      upiName
    ) {
      const bankFields = {
        accountType,
        bankName,
        branchName,
        ifscCode,
        accountNumber,
        holderName,
        micrCode,
        upiId,
        upiName,
      };
      const hasBankFields = Object.values(bankFields).some(
        (v) => v !== undefined && v !== null && v !== "",
      );
      if (hasBankFields) {
        const validationMap = [
          {
            value: accountType,
            isValid: isValidAccountType,
            message: "Invalid account type.",
          },
          {
            value: accountNumber,
            isValid: isValidAccountNumber,
            message: "Invalid account number.",
          },
          {
            value: ifscCode,
            isValid: isValidIFSC,
            message: "Invalid IFSC code.",
          },
          {
            value: micrCode,
            isValid: isValidMICR,
            message: "Invalid MICR Code.",
          },
          { value: upiId, isValid: isValidUpiId, message: "Invalid UPI ID." },
        ];
        for (const { value, isValid, message } of validationMap) {
          if (value && !isValid(value)) {
            return sendError(res, 400, message);
          }
        }
        if (accountNumber) {
          const existingByAccount = await getBankByAccountNumber(accountNumber);
          if (
            existingByAccount &&
            existingByAccount.user.toString() !== userId.toString()
          ) {
            return sendError(
              res,
              409,
              "Account number already exists with another user.",
            );
          }
        }
        const existingBank = await getBankByUserId(userId);
        const cleanBankFields = {};
        for (const [key, value] of Object.entries(bankFields)) {
          if (value !== undefined && value !== null && value !== "") {
            cleanBankFields[key] = value;
          }
        }
        if (existingBank) {
          await updateBankAccountById(existingBank._id, cleanBankFields);
        } else {
          const newBankAccount = await addBankAccount({
            user: userId,
            brand: brandId,
            ...cleanBankFields,
          });
          checkBrand.bankAccount = newBankAccount._id;
          checkVendor.bankAccount = newBankAccount._id;
        }
      }
    }
    /** ----------- Update Current Screen Or OnBoarding Flow ------------ */
    if (currentScreen) {
      checkBrand.currentScreen = currentScreen;
      checkVendor.currentScreen = currentScreen;
    }
    if (isOnBoardingCompleted) {
      checkBrand.isOnBoardingCompleted = isOnBoardingCompleted;
      checkVendor.isOnBoardingCompleted = isOnBoardingCompleted;
    }
    await checkBrand.save();
    await checkVendor.save();
    const updatedBrand = await getBrandWithAllDetails(checkBrand._id);
    return sendSuccess(
      res,
      200,
      "Brand and Vendor details updated successfully.",
      { brand: updatedBrand },
    );
  } catch (error) {
    console.log("Error in updateBrandDetails:", error);
    return sendError(res, 500, error.message);
  }
};
