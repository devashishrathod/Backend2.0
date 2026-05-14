const Employee = require("../../model/Employee");
const EmployeeReferral = require("../../model/EmployeeReferral");
const { ROLES } = require("../../constants");
const { sendError, sendSuccess } = require("../../utils/response");
const { getUserByPan, updateUserById } = require("../../service/userServices");
const {
  createBrand,
  getBrandByName,
  generateUniqueBrandId,
  getBrandWithAllDetails,
} = require("../../service/brandServices");
const {
  addGst,
  getGstByNumber,
  updateGstByNumber,
} = require("../../service/gstServices");
const { isValidPAN, isValidGSTIN } = require("../../validator/common");
const { asyncWrapper } = require("../../utils");

// Add a new brand by Brand Vendor
exports.addBrand = asyncWrapper(async (req, res) => {
  const brandVendor = req?.payload;
  let errorMsg = null;
  if (
    !brandVendor ||
    brandVendor.role !== ROLES.VENDOR ||
    !brandVendor.isMobileVerified ||
    brandVendor.brand
  ) {
    if (!brandVendor) {
      errorMsg = "Access denied. Vendor not found.";
    } else if (brandVendor.role !== ROLES.VENDOR) {
      errorMsg = "Access restricted. Only vendors can perform this action.";
    } else if (!brandVendor.isMobileVerified) {
      errorMsg = "Please verify your mobile number to proceed.";
    } else if (brandVendor.brand) {
      errorMsg = "Brand already exists! You can register only a brand";
    }
    return sendError(res, 403, errorMsg);
  }
  let {
    name,
    slogan,
    companyName,
    companyEmail,
    panNumber,
    gstNumber,
    referMarketId,
    referMarketMobile,
    currentScreen,
    logo,
  } = req.body;
  name = name?.toLowerCase();
  const checkBrand = await getBrandByName(name);
  if (checkBrand) return sendError(res, 409, "Brand already exists");
  let referredEmployee = null;
  if (referMarketId || referMarketMobile) {
    if (!referMarketId || !referMarketMobile) {
      return sendError(
        res,
        400,
        "Both referMarketId and referMarketMobile are required together"
      );
    }
    referredEmployee = await Employee.findOne({
      referCode: referMarketId,
      whatsappNumber: referMarketMobile,
    });
    if (!referredEmployee) {
      return sendError(res, 400, "Invalid referral details");
    }
  }
  panNumber = panNumber?.toUpperCase();
  gstNumber = gstNumber?.toUpperCase();
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
  }
  if (gstNumber && isValidGSTIN(gstNumber)) {
    const checkGst = await getGstByNumber(gstNumber);
    if (checkGst) return sendError(res, 409, "Gst already exists");
    const gstData = {
      gstNumber,
      panNumber: panNumber ? panNumber : null,
      companyName: companyName?.toLowerCase(),
      user: brandVendor._id,
    };
    brandGst = await addGst(gstData);
  }
  const brandData = {
    name: name?.toLowerCase(),
    slogan: slogan?.toLowerCase(),
    companyName: companyName?.toLowerCase(),
    companyEmail: companyEmail
      ? companyEmail?.toLowerCase()
      : brandVendor?.email,
    whatsappNumber: brandVendor.whatsappNumber,
    panNumber,
    gst: brandGst ? brandGst._id : null,
    referMarketId: referredEmployee ? referredEmployee?.referCode : null,
    referMarketMobile: referredEmployee
      ? referredEmployee?.whatsappNumber
      : null,
    user: brandVendor._id,
    uniqueId: await generateUniqueBrandId(),
    currentScreen: currentScreen?.toUpperCase(),
    logo,
    isSignUpCompleted: true,
  };
  const newBrand = await createBrand(brandData);
  await updateUserById(brandVendor._id, {
    panNumber: panNumber ? panNumber : null,
    gst: brandGst ? brandGst._id : null,
    brand: newBrand._id,
    currentScreen: currentScreen?.toUpperCase(),
    isSignUpCompleted: true,
  });
  if (brandGst) await updateGstByNumber(gstNumber, { brand: newBrand._id });
  if (referredEmployee) {
    await EmployeeReferral.create({
      employee: referredEmployee._id,
      user: newBrand?.user,
      brand: newBrand?._id,
      referCodeUsed: referredEmployee?.referCode,
      referMobile: referredEmployee?.whatsappNumber,
      isSubscribed: false,
    });
  }
  const updatedBrand = await getBrandWithAllDetails(newBrand._id);
  return sendSuccess(res, 201, "Brand added successfully", {
    brand: updatedBrand,
  });
});
