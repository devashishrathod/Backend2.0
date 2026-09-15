const mongoose = require("mongoose");
const { sameNameAs, toDisplayName } = require("../../helpers/common");

const Category = require("../../models/Category");
const { throwError } = require("../../utils");
const storage = require("../storage");
const { assertImageFile, toMediaDocument } = require("../../helpers/media");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

exports.createCategory = async (payload, image) => {
  let { name, description, isActive } = payload;
  name = toDisplayName(name);
  // ⚠️ Case-insensitive on purpose — the row stores what was typed, so an
  // exact match would let "Pizza" and "pizza" both exist.
  const existingCategory = await Category.findOne({
    name: sameNameAs(name),
    isDeleted: false,
  });
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
