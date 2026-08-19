const mongoose = require("mongoose");
const VoucherVersion = require("../../models/VoucherVersion");
const { buildAggregateLookup } = require("../../database");
const { pagination, validateObjectId } = require("../../utils");

exports.getAllVoucherVersions = async (query) => {
  let {
    page,
    limit,
    search,
    voucherId,
    brandId,
    categoryId,
    subCategoryId,
    createdBy,
    submittedBy,
    reviewedBy,
    approvedBy,
    rejectedBy,
    versionNumber,
    name,
    versionCode,
    status,
    isImmutable,
    isActive,
    fromDate,
    toDate,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;

  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 10;

  const match = { isDeleted: false };

  if (voucherId) {
    validateObjectId(voucherId, "Voucher Id");
    match.voucherId = new mongoose.Types.ObjectId(voucherId);
  }
  if (brandId) {
    validateObjectId(brandId, "Brand Id");
    match.brandId = new mongoose.Types.ObjectId(brandId);
  }
  if (categoryId) {
    validateObjectId(categoryId, "Category Id");
    match.categoryId = new mongoose.Types.ObjectId(categoryId);
  }
  if (subCategoryId) {
    validateObjectId(subCategoryId, "Sub Category Id");
    match.subCategoryId = new mongoose.Types.ObjectId(subCategoryId);
  }
  if (createdBy) {
    validateObjectId(createdBy, "Created By Id");
    match.createdBy = new mongoose.Types.ObjectId(createdBy);
  }
  if (submittedBy) {
    validateObjectId(submittedBy, "Submitted By Id");
    match.submittedBy = new mongoose.Types.ObjectId(submittedBy);
  }
  if (reviewedBy) {
    validateObjectId(reviewedBy, "Reviewed By Id");
    match.reviewedBy = new mongoose.Types.ObjectId(reviewedBy);
  }
  if (approvedBy) {
    validateObjectId(approvedBy, "Approved By Id");
    match.approvedBy = new mongoose.Types.ObjectId(approvedBy);
  }
  if (rejectedBy) {
    validateObjectId(rejectedBy, "Rejected By Id");
    match.rejectedBy = new mongoose.Types.ObjectId(rejectedBy);
  }
  if (versionNumber) match.versionNumber = Number(versionNumber);
  if (status) match.status = status;
  if (isImmutable !== undefined) {
    match.isImmutable = isImmutable === "true" || isImmutable === true;
  }
  if (isActive !== undefined) {
    match.isActive = isActive === "true" || isActive === true;
  }
  if (name) match.name = { $regex: new RegExp(name, "i") };
  if (versionCode) {
    match.versionCode = { $regex: new RegExp(versionCode, "i") };
  }

  if (search) {
    match.$or = [
      { name: { $regex: new RegExp(search, "i") } },
      { description: { $regex: new RegExp(search, "i") } },
      { versionCode: { $regex: new RegExp(search, "i") } },
      { tags: { $regex: new RegExp(search, "i") } },
    ];
  }

  if (fromDate || toDate) {
    match.createdAt = {};
    if (fromDate) match.createdAt.$gte = new Date(fromDate);
    if (toDate) {
      const d = new Date(toDate);
      d.setHours(23, 59, 59, 999);
      match.createdAt.$lte = d;
    }
  }

  const sortStage = {};
  sortStage[sortBy] = sortOrder === "asc" ? 1 : -1;

  const userProject = { password: 0, otp: 0, refreshToken: 0 };

  const pipeline = [
    { $match: match },
    { $sort: sortStage },

    // =========================================================
    // VOUCHER
    // =========================================================
    ...buildAggregateLookup({
      from: "vouchers",
      localField: "voucherId",
      as: "voucher",
    }),

    // =========================================================
    // BRAND
    // =========================================================
    ...buildAggregateLookup({
      from: "brands",
      localField: "brandId",
      as: "brand",
    }),

    // =========================================================
    // CATEGORY
    // =========================================================
    ...buildAggregateLookup({
      from: "categories",
      localField: "categoryId",
      as: "category",
    }),

    // =========================================================
    // SUB CATEGORY
    // =========================================================
    ...buildAggregateLookup({
      from: "subcategories",
      localField: "subCategoryId",
      as: "subCategory",
    }),

    // =========================================================
    // CREATED BY
    // =========================================================
    ...buildAggregateLookup({
      from: "users",
      localField: "createdBy",
      as: "createdByUser",
      project: userProject,
    }),

    // =========================================================
    // SUBMITTED BY
    // =========================================================
    ...buildAggregateLookup({
      from: "users",
      localField: "submittedBy",
      as: "submittedByUser",
      project: userProject,
    }),

    // =========================================================
    // REVIEWED BY
    // =========================================================
    ...buildAggregateLookup({
      from: "users",
      localField: "reviewedBy",
      as: "reviewedByUser",
      project: userProject,
    }),

    // =========================================================
    // APPROVED BY
    // =========================================================
    ...buildAggregateLookup({
      from: "users",
      localField: "approvedBy",
      as: "approvedByUser",
      project: userProject,
    }),

    // =========================================================
    // REJECTED BY
    // =========================================================
    ...buildAggregateLookup({
      from: "users",
      localField: "rejectedBy",
      as: "rejectedByUser",
      project: userProject,
    }),

    { $project: { __v: 0 } },
  ];

  return await pagination(VoucherVersion, pipeline, page, limit);
};
