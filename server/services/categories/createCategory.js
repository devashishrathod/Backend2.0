const mongoose = require("mongoose");

const Category = require("../../models/Category");
const { throwError } = require("../../utils");
const storage = require("../storage");
const { assertImageFile } = require("../../helpers/media");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

exports.createCategory = async (payload, image) => {
  let { name, description, isActive } = payload;
  const existingCategory = await Category.findOne({ name, isDeleted: false });
  if (existingCategory) {
    throwError(400, "Category already exist with this name");
  }

  // The id is minted here rather than by `create`, because the object key
  // carries it — `images/categories/<id>/<uuid>.webp` — and the upload has to
  // happen before the row exists. Mongo generates ids client-side anyway, so
  // this is the same value `create` would have produced.
  const _id = new mongoose.Types.ObjectId();

  let uploaded = null;
  assertImageFile(image, "Category image");

  if (image) {
    uploaded = await storage.uploadFromPath({
      filePath: image.tempFilePath,
      originalFile: image,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      entityId: _id,
    });
  }

  return await Category.create({
    _id,
    name,
    description,
    image: uploaded?.url,
    imageMedia: toMediaDocument(uploaded),
    isActive,
  });
};
