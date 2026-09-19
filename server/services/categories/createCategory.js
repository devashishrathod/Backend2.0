const mongoose = require("mongoose");
const { sameNameAs, toDisplayName } = require("../../helpers/common");

const Category = require("../../models/Category");
const { throwError } = require("../../utils");
const { acceptUpload } = require("../storage");
const {
  assertImageFile,
  toMediaDocument,
  discardOnFailure,
} = require("../../helpers/media");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

/**
 * ⚠️ `actor` is new (U-2), and it is not decoration: `acceptUpload` loads the
 * upload intent by id **and** owner, so a signed permission cannot be handed to
 * somebody else. Without it the presigned road has no way to know whose upload
 * this is.
 */
exports.createCategory = async (actor, payload, image) => {
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

  /**
   * ⚠️ Still here, and still only for the multipart road (U-2).
   *
   * It is an **exact mime allow-list**, which the purpose's `kinds` is not —
   * `constants/storage.js` says so out loud: kinds is routing, not the security
   * boundary. `kindFromMime("image/svg+xml")` answers IMAGE, and an SVG served
   * from our own CDN is stored XSS. On the presigned road the same job is done
   * by the magic-byte check at confirm, which refuses an SVG by name.
   */
  assertImageFile(image, "Category image");

  // One door, two roads: a multipart file or an uploadId the client already
  // sent to S3. Which one arrived is the facade's business, not this file's.
  const uploaded = await acceptUpload(actor, {
    file: image,
    uploadId: payload.uploadId,
    purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
    entityId: _id,
  });

  /**
   * ⚠️ The file goes back out if the row does not arrive. The duplicate-name
   * check above covers the ordinary case; what is left is two admins creating
   * the same category at once, where the unique index refuses the second — and
   * a confirmed object has already left `staging/`, so nothing would ever sweep
   * it.
   */
  return await discardOnFailure(uploaded, () =>
    Category.create({
      _id,
      name,
      description,
      image: uploaded?.url,
      imageMedia: toMediaDocument(uploaded),
      isActive,
    }),
  );
};
