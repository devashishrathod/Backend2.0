// const { generateToken } = require("../middleware/authValidation");
// const Brand = require("../model/Brand");
// const Gst = require("../model/Gst");
// const Location = require("../model/Location");
// const User = require("../model/User");
// const WorkHours = require("../model/WorkHours");

// exports.registerVendor = async (req, res) => {
//   const brandName = req.body?.brandName;
//   const brandSlogan = req.body?.brandSlogan;
//   const companyName = req.body?.companyName;
//   const companyEmail = req.body?.companyEmail;
//   const mobile = req.body?.mobile;
//   const whatsappNumber = req.body?.whatsappNumber;
//   const gst = req.body?.gst;
//   const pan = req.body?.pan;
//   const referCode = req.body?.referCode;
//   try {
//     const checkUser = await User.findOne({ mobile, role: "vendor" });
//     if (!checkUser) {
//       return res.status(404).json({
//         msg: "No register mobile number found or verify your mobile number",
//         success: false,
//       });
//     }
//     const checkReferUser = await User.findOne({ referCode });
//     if (!checkReferUser) {
//       return res
//         .status(404)
//         .json({ msg: "No refer code found!", success: false });
//     }
//     if (!checkUser.isMobileVerify) {
//       return res.status(400).json({
//         msg: "Please verify your mobile number first.",
//         success: false,
//       });
//     }
//     // const checkBrand = await Brand.findOne({ user: checkUser?._id, mobile })
//     const checkBrand = await Brand.findOne({
//       $or: [{ user: checkUser?._id }, { mobile }],
//     });
//     if (checkBrand) {
//       return res
//         .status(400)
//         .json({ msg: "Brand already exists!", success: false });
//     }
//     checkUser.email = companyEmail;
//     const brand = new Brand({
//       user: checkUser?._id,
//       name: brandName,
//       slogan: brandSlogan,
//       companyName,
//       email: companyEmail,
//       mobile,
//       whatsappNumber,
//       gst,
//       pan,
//       referApply: referCode,
//     });
//     const gstResult = await Gst.create({
//       companyName: companyName,
//       gstNumber: gst,
//       user: checkUser?._id,
//       brand: brand?._id,
//     });
//     brand.gst = gstResult?._id;
//     await brand.save();
//     await checkUser.save();
//     const token = await generateToken(checkUser);
//     return res.status(200).json({
//       msg: "Vendor registered successfully.",
//       success: true,
//       token,
//       result: brand,
//     });
//   } catch (error) {
//     console.log("error on registerVendor: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };

// exports.addCategorySubCategory = async (req, res) => {
//   const brandId = req.params?.id;
//   // const mobile = req.body?.mobile
//   const category = req.body?.category;
//   const subCategory = req.body?.subCategory;
//   const userId = req.payload?._id;
//   try {
//     const checkBrand = await Brand.findOne({ _id: brandId, user: userId });
//     if (!checkBrand) {
//       return res.status(404).json({ msg: "No brand found!", success: false });
//     }
//     checkBrand.category = category;
//     checkBrand.subCategory = subCategory;
//     await checkBrand.save();
//     return res
//       .status(200)
//       .json({ msg: "Category added successfully.", success: true });
//   } catch (error) {
//     console.log("error on addCategorySubCategory: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };

// exports.addLocation = async (req, res) => {
//   const brandId = req.params?.id;
//   const userId = req.payload?._id;
//   const address = req.body?.address;
//   const area = req.body?.area;
//   const city = req.body?.city;
//   const state = req.body?.state;
//   const zipCode = req.body?.zipCode;
//   const landMark = req.body?.landMark;
//   const lat = req.body?.lat;
//   const lng = req.body?.lng;
//   try {
//     const checkBrand = await Brand.findOne({ _id: brandId, user: userId });
//     if (!checkBrand) {
//       return res.status(404).json({ msg: "No brand found!", success: false });
//     }
//     const checkLocation = await Location.findOne({
//       user: userId,
//       brand: brandId,
//     });
//     if (checkLocation) {
//       checkLocation.name = checkBrand?.name;
//       checkLocation.address = address;
//       checkLocation.area = area;
//       checkLocation.city = city;
//       checkLocation.state = state;
//       checkLocation.zipCode = zipCode;
//       checkLocation.landMark = landMark;
//       checkLocation.location = { type: "Point", coordinates: [lng, lat] };
//       await checkLocation.save();
//       return res
//         .status(200)
//         .json({ msg: "Location updated successfully.", success: true });
//     }
//     const location = new Location({
//       user: userId,
//       brand: brandId,
//       name: checkBrand?.name,
//       address,
//       area,
//       city,
//       state,
//       zipCode,
//       landMark,
//       location: { type: "Point", coordinates: [lng, lat] },
//     });
//     checkBrand.location = location?._id;
//     await location.save();
//     await checkBrand.save();
//     return res
//       .status(200)
//       .json({ msg: "Location added successfully.", success: true });
//   } catch (error) {
//     console.log("error on addLocation: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };

// exports.addWorking = async (req, res) => {
//   const brandId = req.params?.id;
//   const userId = req.payload?._id;
//   const monday =
//     typeof req.body?.monday == "string"
//       ? JSON.parse(req.body?.monday)
//       : req.body?.monday;
//   const tuesday =
//     typeof req.body?.tuesday == "string"
//       ? JSON.parse(req.body?.tuesday)
//       : req.body?.tuesday;
//   const wednesday =
//     typeof req.body?.wednesday == "string"
//       ? JSON.parse(req.body?.wednesday)
//       : req.body?.wednesday;
//   const thursday =
//     typeof req.body?.thursday == "bigint"
//       ? JSON.parse(req.body?.thursday)
//       : req.body?.thursday;
//   const friday =
//     typeof req.body?.friday == "string"
//       ? JSON.parse(req.body?.friday)
//       : req.body?.friday;
//   const saturday =
//     typeof req.body?.saturday == "string"
//       ? JSON.parse(req.body?.saturday)
//       : req.body?.saturday;
//   const sunday =
//     typeof req.body?.sunday == "string"
//       ? JSON.parse(req.body?.sunday)
//       : req.body?.sunday;
//   try {
//     const checkBrand = await Brand.findOne({ _id: brandId, user: userId });
//     if (!checkBrand) {
//       return res.status(404).json({ msg: "No brand found!", success: false });
//     }
//     const checkWorking = await WorkHours.findOne({
//       user: userId,
//       brand: brandId,
//     });
//     if (checkWorking) {
//       checkWorking.monday = monday;
//       checkWorking.tuesday = tuesday;
//       checkWorking.wednesday = wednesday;
//       checkWorking.thursday = thursday;
//       checkWorking.friday = friday;
//       checkWorking.saturday = saturday;
//       checkWorking.sunday = sunday;
//       await checkWorking.save();
//       return res
//         .status(200)
//         .json({ msg: "Working updated successfully.", success: true });
//     }
//     const working = new WorkHours({
//       user: userId,
//       brand: brandId,
//       monday,
//       tuesday,
//       wednesday,
//       thursday,
//       friday,
//       saturday,
//       sunday,
//     });
//     checkBrand.workHours = working?._id;
//     await working.save();
//     await checkBrand.save();
//     return res
//       .status(200)
//       .json({ msg: "Working added successfully.", success: true });
//   } catch (error) {
//     console.log("error on addWorking: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };
