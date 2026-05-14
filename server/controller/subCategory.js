// const SubCategory = require("../model/SubCategory");
// const {
//   uploadToCloudinary,
//   deleteFromCloudinary,
// } = require("../service/uploadImage");

// exports.getAllSubCategory = async (req, res) => {
//   const id = req?.params?.id;
//   try {
//     if (id) {
//       const result = await SubCategory.findById(id);
//       if (result) {
//         return res
//           .status(200)
//           .json({ success: true, msg: "SubCategory details", result });
//       }
//       return res
//         .status(404)
//         .json({ msg: "SubCategory not found", success: false });
//     }
//     const result = await SubCategory.find().sort({ createdAt: -1 });
//     if (result) {
//       return res
//         .status(200)
//         .json({ success: true, msg: "SubCategory details", result });
//     }
//     return res
//       .status(404)
//       .json({ msg: "SubCategory not found", success: false });
//   } catch (error) {
//     console.log("error on getAllSubCategory: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };

// exports.getSubCategoryPagination = async (req, res) => {
//   const page = parseInt(req?.query?.page);
//   const limit = parseInt(req?.query?.limit);
//   const skip = (page - 1) * limit;
//   try {
//     const result = await SubCategory.find()
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit);
//     const totalDocuments = await SubCategory.countDocuments();
//     const totalPages = Math.ceil(totalDocuments / limit);
//     if (result) {
//       return res.status(200).json({
//         success: true,
//         msg: "SubCategory details",
//         result,
//         pagination: { totalDocuments, totalPages, currentPage: page, limit },
//       });
//     }
//     return res
//       .status(404)
//       .json({ msg: "SubCategory not found", success: false });
//   } catch (error) {
//     console.log("error on getCategoryPagination: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };

// exports.subCategoryByCategoryPagination = async (req, res) => {
//   const id = req?.params?.id;
//   const page = parseInt(req?.query?.page);
//   const limit = parseInt(req?.query?.limit);
//   const skip = (page - 1) * limit;
//   try {
//     const result = await SubCategory.find({ category: id })
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit);
//     const totalDocuments = await SubCategory.countDocuments({ category: id });
//     const totalPages = Math.ceil(totalDocuments / limit);
//     if (result) {
//       return res.status(200).json({
//         success: true,
//         msg: "SubCategory details",
//         result,
//         pagination: { totalDocuments, totalPages, currentPage: page, limit },
//       });
//     }
//     return res
//       .status(404)
//       .json({ msg: "SubCategory not found", success: false });
//   } catch (error) {
//     console.log("error on subCategoryByCategoryPagination: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };

// exports.subCategoryByCategory = async (req, res) => {
//   const id = req?.params?.id;
//   try {
//     const result = await SubCategory.find({ category: id }).sort({
//       createdAt: -1,
//     });
//     if (result) {
//       return res
//         .status(200)
//         .json({ success: true, msg: "SubCategory details", result });
//     }
//     return res
//       .status(404)
//       .json({ msg: "SubCategory not found", success: false });
//   } catch (error) {
//     console.log("error on subCategoryByCategory: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };

// exports.addSubCategory = async (req, res) => {
//   const firstName = req.body?.firstName;
//   const lastName = req.body?.lastName;
//   const name = req.body?.name;
//   const image = req.files?.image;
//   const category = req.body?.category;
//   const type = req.body?.type;
//   try {
//     const checkCategory = await SubCategory.findOne({
//       $and: [{ name }, { type }],
//     });
//     if (checkCategory) {
//       return res
//         .status(400)
//         .json({ success: false, msg: "Sub Category already exists" });
//     }
//     const subCategory = new SubCategory({ firstName, lastName, type, name });
//     if (image) {
//       let imageUrl = await uploadToCloudinary(image.tempFilePath);
//       subCategory.image = imageUrl;
//     }
//     if (category) subCategory.category = category;
//     const result = await subCategory.save();
//     return res
//       .status(200)
//       .json({ success: true, msg: "Sub Category added successfully.", result });
//   } catch (error) {
//     console.log("error on addSubCategory: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };

// exports.updateSubCategory = async (req, res) => {
//   const id = req.params?.id;
//   const firstName = req.body?.firstName;
//   const lastName = req.body?.lastName;
//   const name = req.body?.name;
//   const image = req.files?.image;
//   const category = req.body?.category;
//   const type = req.body?.type;
//   try {
//     const checkCategory = await SubCategory.findById(id);
//     if (!checkCategory) {
//       return res
//         .status(400)
//         .json({ success: false, msg: "Sub Category not found" });
//     }
//     if (firstName) checkCategory.firstName = firstName;
//     if (lastName) checkCategory.lastName = lastName;
//     if (name) checkCategory.name = name;
//     if (category) checkCategory.category = category;
//     if (type) checkCategory.type = type;
//     if (image) {
//       let imageUrl = await uploadToCloudinary(image.tempFilePath);
//       if (checkCategory?.image) {
//         await deleteFromCloudinary(checkCategory?.image);
//       }
//       checkCategory.image = imageUrl;
//     }
//     const result = await checkCategory.save();
//     return res.status(200).json({
//       success: true,
//       msg: "Sub Category updated successfully.",
//       result,
//     });
//   } catch (error) {
//     console.log("error on updateSubCategory: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };

// exports.updateStatus = async (req, res) => {
//   const id = req.params?.id;
//   try {
//     const checkCategory = await SubCategory.findById(id);
//     if (!checkCategory) {
//       return res
//         .status(400)
//         .json({ success: false, msg: "Sub Category not found" });
//     }
//     checkCategory.isActive = !checkCategory.isActive;
//     const result = await checkCategory.save();
//     return res.status(200).json({
//       success: true,
//       msg: "Sub Category status updated successfully.",
//       result,
//     });
//   } catch (error) {
//     console.log("error on updateStatus: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };

// exports.deleteSubCategory = async (req, res) => {
//   const id = req?.params?.id;
//   try {
//     const checkCategory = await SubCategory.findById(id);
//     if (!checkCategory) {
//       return res
//         .status(400)
//         .json({ success: false, msg: "Category not found" });
//     }
//     if (checkCategory?.image) {
//       await deleteFromCloudinary(checkCategory?.image);
//     }
//     const result = await SubCategory.findByIdAndDelete(id);
//     return res
//       .status(200)
//       .json({ success: true, msg: "Category deleted successfully.", result });
//   } catch (error) {
//     console.log("error on deleteCategory: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };
