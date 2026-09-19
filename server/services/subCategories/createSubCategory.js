const mongoose = require("mongoose");
const { sameNameAs, toDisplayName } = require("../../helpers/common");

const Category = require("../../models/Category");
const SubCategory = require("../../models/SubCategory");
const { throwError } = require("../../utils");
const storage = require("../storage");
const { acceptUpload } = storage;
const {
  assertImageFile,
  toMediaDocument,
  discardOnFailure,
} = require("../../helpers/media");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

/**
 * ⚠️ `actor` is new (U-5) — `acceptUpload` loads the upload intent by id **and**
 * owner, so a signed permission cannot be handed to somebody else.
 */
exports.createSubCategory = async (actor, categoryId, payload, image) => {
  const category = await Category.findById(categoryId);
  if (!category || category.isDeleted) throwError(404, "Category not found!");
  let { name, description, isActive } = payload;
  name = toDisplayName(name);
  description = description.trim();
  const existingSubCategory = await SubCategory.findOne({
    // Case-insensitive — see `createCategory`.
    name: sameNameAs(name),
    categoryId: categoryId,
    isDeleted: false,
  });
  if (existingSubCategory) {
    throwError(
      400,
      `SubCategory already exist with this name for ${category.name} category`
    );
  }
  // Minted here because the object key carries it and the upload comes first.
  const _id = new mongoose.Types.ObjectId();

  /**
   * ⚠️ Still here, and still only for the multipart road. It is an **exact mime
   * allow-list**, which the purpose's `kinds` deliberately is not — see the note
   * in `createCategory`. On the presigned road the same job is done by the
   * magic-byte check at confirm.
   */
  assertImageFile(image, "Subcategory image");

  // One door, two roads: a multipart file or an uploadId the client already
  // sent to S3.
  const uploaded = await acceptUpload(actor, {
    file: image,
    uploadId: payload.uploadId,
    purpose: UPLOAD_PURPOSE.SUBCATEGORY_IMAGE,
    entityId: _id,
  });

  // ⚠️ The file goes back out if the row does not arrive — see `createCategory`.
  return await discardOnFailure(uploaded, () =>
    SubCategory.create({
      _id,
      name,
      description,
      categoryId,
      image: uploaded?.url,
      imageMedia: toMediaDocument(uploaded),
      isActive,
    }),
  );
};
