const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const { UPLOAD_PURPOSES } = require("../constants/storage");

/**
 * Asking for permission to write one object (U-1).
 *
 * ⚠️ Everything here is a **claim**, and the validator's job is only to make it
 * a well-formed one. `contentType` and `sizeBytes` shape the S3 policy, and S3
 * enforces that policy — but neither is evidence about the bytes. What the file
 * actually is gets settled at confirm, from its own first bytes.
 */
exports.validatePresignUpload = {
  body: Joi.object({
    /**
     * The surface, not the folder. It decides the bucket, the allowed kinds and
     * the size ceiling — so a caller cannot presign an avatar and use it for a
     * video.
     */
    purpose: Joi.string()
      .valid(...Object.keys(UPLOAD_PURPOSES))
      .required()
      .messages({
        "any.only": `Unknown upload purpose. Allowed: ${Object.keys(UPLOAD_PURPOSES).join(", ")}.`,
        "any.required": "An upload purpose is required.",
      }),
    contentType: Joi.string().trim().max(120).required().messages({
      "any.required": "The file's content type is required.",
    }),
    /**
     * ⚠️ This buys a **readable refusal**, not the limit itself.
     *
     * The signed policy's range is `1..maxBytes` — the **surface** ceiling, not
     * this number — so a caller who understates their size is still stopped by
     * S3. What declaring it earns is a 413 that names the limit in megabytes,
     * instead of an opaque refusal from a bucket at the end of a long upload.
     */
    sizeBytes: Joi.number().integer().min(1).required().messages({
      "any.required": "The file size in bytes is required.",
      "number.min": "An empty file cannot be uploaded.",
    }),
    fileName: Joi.string().trim().max(255).optional(),
  }),
};

/**
 * Turning a finished upload into something a row can point at (U-1).
 *
 * ⚠️ `entityId` is optional on purpose. A logo knows its brand before the
 * upload starts; a voucher image belongs to a version that does not exist yet
 * when the file is sent. The key simply carries one segment less in that case.
 */
exports.validateConfirmUpload = {
  body: Joi.object({
    uploadId: objectId().required().messages({
      "any.required": "The uploadId from presign is required.",
      "any.invalid": "Invalid uploadId.",
    }),
    entityId: objectId().optional().messages({
      "any.invalid": "Invalid entity id.",
    }),
  }),
};
