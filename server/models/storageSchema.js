const mongoose = require("mongoose");

const { STORAGE_PROVIDER } = require("../constants/storage");

/**
 * Where one asset physically lives — the sibling of a URL field.
 *
 * ### Why a sibling and not a nested object
 *
 * The obvious shape is `image: { url, storage }`. That is a **breaking response
 * change**: every client reading `brand.logo` as a string would get an object.
 * A sibling — `logo` stays a string, `logoStorage` appears beside it — changes
 * nothing a client can see, which is the whole point of this step. Only the
 * server ever reads it.
 *
 * ### Why the URL was never enough
 *
 * A delete has to know *where* the bytes are. With only a URL it has to be
 * inferred from the string, and that inference is exactly what kept failing:
 * `deleteFile` compared the host against `CLOUD_BASE_URL` and skipped anything
 * it did not recognise, so an S3 URL was silently ignored and the file stayed.
 * A row that carries its own provider and key has nothing to guess.
 *
 * ### ⚠️ Always `default: undefined` at the point of use
 *
 *     imageStorage: { type: storageSchema, default: undefined }
 *
 * A Mongoose sub-document without it materialises as `{}` on **every** document
 * — including the millions that predate the field — and `{}` reads as
 * `provider: undefined`, which the facade refuses with "Unknown storage
 * provider". Absent means "written before this existed, work it out from the
 * URL"; `{}` means "written by something broken".
 *
 * `_id: false` for the same reason it matters elsewhere: this is a value, not a
 * thing with an identity, and an id here would be written into every row for
 * nothing.
 */
const storageSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: Object.values(STORAGE_PROVIDER),
      required: true,
    },
    /** Cloudinary's handle. Null on S3. */
    publicId: { type: String },
    /** S3 only. */
    bucket: { type: String },
    key: { type: String },
  },
  { _id: false },
);

module.exports = { storageSchema };
