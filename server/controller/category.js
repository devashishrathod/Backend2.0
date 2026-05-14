// const Category = require("../model/Category");
// const {
//   uploadToCloudinary,
//   deleteFromCloudinary,
// } = require("../service/uploadImage");

// exports.getAllCategory = async (req, res) => {
//   const id = req?.params?.id;
//   try {
//     if (id) {
//       const result = await Category.findById(id);
//       if (result) {
//         return res
//           .status(200)
//           .json({ success: true, msg: "Category details", result });
//       }
//       return res
//         .status(404)
//         .json({ msg: "Category not found", success: false });
//     }
//     const result = await Category.find().sort({ createdAt: -1 });
//     if (result) {
//       return res
//         .status(200)
//         .json({ success: true, msg: "Category details", result });
//     }
//     return res.status(404).json({ msg: "Category not found", success: false });
//   } catch (error) {
//     console.log("error on getAllCategory: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };

// exports.getCategoryPagination = async (req, res) => {
//   const page = parseInt(req?.query?.page) || 1;
//   const limit = parseInt(req?.query?.limit) || 10;
//   const skip = (page - 1) * limit;
//   const type = req?.query?.type;
//   const search = req?.query?.search;
//   try {
//     let matchStage = {};
//     if (type) {
//       matchStage.type = type;
//     }
//     if (search) {
//       matchStage.$or = [
//         { firstName: { $regex: search, $options: "i" } },
//         { lastName: { $regex: search, $options: "i" } },
//         { name: { $regex: search, $options: "i" } },
//       ];
//     }

//     const aggregationPipeline = [
//       { $match: matchStage },
//       { $sort: { createdAt: -1 } },
//       { $skip: skip },
//       { $limit: limit },
//       {
//         $lookup: {
//           from: "subcategories",
//           localField: "_id",
//           foreignField: "category",
//           as: "subCategories",
//         },
//       },
//       {
//         $addFields: {
//           subCategoryCount: { $size: "$subCategories" },
//         },
//       },
//       {
//         $project: {
//           subCategories: 0,
//         },
//       },
//     ];
//     const result = await Category.aggregate(aggregationPipeline);
//     const totalDocuments = await Category.countDocuments(matchStage);
//     const totalPages = Math.ceil(totalDocuments / limit);
//     return res.status(200).json({
//       success: true,
//       msg: "Category details",
//       result,
//       pagination: { totalDocuments, totalPages, currentPage: page, limit },
//     });
//   } catch (error) {
//     console.log("error on getCategoryPagination: ", error);
//     return res.status(500).json({ success: false, msg: error.message });
//   }
// };

// exports.addCategory = async (req, res) => {
//   const firstName = req.body?.firstName;
//   const lastName = req.body?.lastName;
//   const name = req.body?.name;
//   const image = req.files?.image;
//   const type = req.body?.type;
//   try {
//     // const checkCategory = await Category.findOne({ $or: [{ firstName }, { lastName }] });
//     // const checkCategory = await Category.findOne({ firstName }, { lastName });
//     const checkCategory = await Category.findOne({
//       $and: [{ name }, { type }],
//     });
//     if (checkCategory) {
//       return res
//         .status(400)
//         .json({ success: false, msg: "Category already exists" });
//     }
//     const category = new Category({ firstName, lastName, name, type });
//     if (image) {
//       let imageUrl = await uploadToCloudinary(image.tempFilePath);
//       category.image = imageUrl;
//     }
//     const result = await category.save();
//     return res
//       .status(200)
//       .json({ success: true, msg: "Category added successfully.", result });
//   } catch (error) {
//     console.log("error on addCategory: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };

// exports.updateCategory = async (req, res) => {
//   const id = req.params?.id;
//   const firstName = req.body?.firstName;
//   const lastName = req.body?.lastName;
//   const name = req.body?.name;
//   const image = req.files?.image;
//   const type = req.files?.type;
//   try {
//     const checkCategory = await Category.findById(id);
//     if (!checkCategory) {
//       return res
//         .status(400)
//         .json({ success: false, msg: "Category not found" });
//     }
//     if (firstName) checkCategory.firstName = firstName;
//     if (lastName) checkCategory.lastName = lastName;
//     if (name) checkCategory.name = name;
//     if (type) checkCategory.type = type;
//     if (image) {
//       let imageUrl = await uploadToCloudinary(image.tempFilePath);
//       if (checkCategory?.image) {
//         await deleteFromCloudinary(checkCategory?.image);
//       }
//       checkCategory.image = imageUrl;
//     }
//     const result = await checkCategory.save();
//     return res
//       .status(200)
//       .json({ success: true, msg: "Category updated successfully.", result });
//   } catch (error) {
//     console.log("error on updateCategory: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };

// exports.updateStatus = async (req, res) => {
//   const id = req.params?.id;
//   try {
//     const checkCategory = await Category.findById(id);
//     if (!checkCategory) {
//       return res
//         .status(400)
//         .json({ success: false, msg: "Category not found" });
//     }
//     checkCategory.isActive = !checkCategory.isActive;
//     const result = await checkCategory.save();
//     return res.status(200).json({
//       success: true,
//       msg: "Category status updated successfully.",
//       result,
//     });
//   } catch (error) {
//     console.log("error on updateStatus: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };

// exports.deleteCategory = async (req, res) => {
//   const id = req?.params?.id;
//   try {
//     const checkCategory = await Category.findById(id);
//     if (!checkCategory) {
//       return res
//         .status(400)
//         .json({ success: false, msg: "Category not found" });
//     }
//     if (checkCategory?.image) {
//       await deleteFromCloudinary(checkCategory?.image);
//     }
//     const result = await Category.findByIdAndDelete(id);
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
