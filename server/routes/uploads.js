const express = require("express");
const router = express.Router();

const { validateSchema, verifyJwtToken } = require("../middlewares");
const { presign, confirm } = require("../controllers/uploads");
const {
  validatePresignUpload,
  validateConfirmUpload,
} = require("../validator/uploads");

/**
 * Direct-to-S3 upload, in two steps (U-1).
 *
 * ### 🔴 Why the file stops coming through this server at all
 *
 * Today every image, video and PDF is posted to this process, written to a temp
 * file, read back, and pushed to storage. A 100 MB video therefore costs this
 * server 100 MB of disk, the memory to move it, and the whole upload's duration
 * of a held connection — for a file it does nothing with except forward.
 *
 * Presigned upload removes the middle. The client asks for permission, S3 takes
 * the bytes, and this server only ever sees two small JSON requests.
 *
 * ### ⚠️ `verifyJwtToken`, not a role gate
 *
 * A vendor uploads voucher images, a customer uploads an avatar, an admin
 * uploads a category picture. What may be uploaded is decided by the
 * **purpose** — its bucket, its allowed kinds, its size ceiling — not by the
 * caller's role, so narrowing the route to one role would only shut out the
 * other two from surfaces that are theirs.
 *
 * ⚠️ The signature is scoped to one exact key, one content type and one size
 * range, and the intent row records who asked. `confirm` then loads that row by
 * id **and** owner, so a permission cannot be handed to somebody else.
 */
router.post(
  "/presign",
  verifyJwtToken,
  validateSchema(validatePresignUpload),
  presign,
);

/**
 * 🔴 The step that decides what the file actually is.
 *
 * Everything before this read a `Content-Type` the client chose. This one reads
 * the object's own first bytes, refuses anything the surface does not accept,
 * and moves it from `staging/` to the key it will live at — with the type taken
 * from the bytes rather than the claim.
 */
router.post(
  "/confirm",
  verifyJwtToken,
  validateSchema(validateConfirmUpload),
  confirm,
);

module.exports = router;
