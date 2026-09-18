const mongoose = require("mongoose");

const { userField } = require("./validObjectId");
const { UPLOAD_PURPOSE } = require("../constants/storage");
const { storageSchema } = require("./storageSchema");

/**
 * One intent to upload, and what became of it.
 *
 * ### Why a record exists at all
 *
 * A presigned POST hands the client a signed permission to write **one** key.
 * Between that and the row that finally points at the file, the server sees
 * nothing — so without a record there is no way to answer, at confirm time:
 *
 *   - is the caller confirming the upload they were given, or somebody else's?
 *   - has this already been consumed? (a replayed confirm must not attach the
 *     same file to a second row)
 *   - what was it *for*? The purpose decides the bucket, the prefix and the
 *     allowed types, and it must be fixed when the permission is issued — a
 *     client that could name it at confirm time could put a file anywhere.
 *
 * ### It is deliberately short-lived
 *
 * Most of these are never confirmed: a user opens the picker, changes their
 * mind, or the app is killed mid-upload. Those rows are not history, they are
 * litter — so they expire on their own, and the object they were pointing at is
 * swept by the bucket's own lifecycle rule on `staging/`.
 */
const uploadSchema = new mongoose.Schema(
  {
    /**
     * Who asked. Confirm compares against the caller — a signed permission is
     * not transferable, and an id in a request body is a claim, not proof.
     */
    userId: { ...userField, required: true },

    /**
     * What it is for — bucket, prefix, allowed types, size cap.
     *
     * ⚠️ Written **here**, when the permission is issued, and read from here at
     * confirm. Accepting it again at confirm time would let a caller presign a
     * one-megabyte avatar and then confirm it as a fifty-megabyte showcase
     * video, which is the same file in a place it was never allowed.
     */
    purpose: {
      type: String,
      enum: Object.values(UPLOAD_PURPOSE),
      required: true,
    },

    /**
     * Where the client was allowed to write — under `staging/`, outside the
     * type tree.
     *
     * A key like `images/…` is a claim about content, and at this point the
     * only evidence is what the client said. The object moves under its real
     * type prefix after its bytes have been read.
     */
    stagingKey: { type: String, required: true },

    /** What the client said it was sending. Believed for nothing but the size cap. */
    declaredContentType: { type: String },
    declaredSizeBytes: { type: Number },

    /**
     * Where it ended up, once confirmed — the same shape every other row uses.
     */
    storage: { type: storageSchema, default: undefined },

    /** What the bytes turned out to be. Written by the confirm step, from the file. */
    verified: {
      contentType: { type: String },
      kind: { type: String },
      sizeBytes: { type: Number },
      width: { type: Number, default: null },
      height: { type: Number, default: null },
    },

    /**
     * ⚠️ The replay guard. Set inside the same transaction that attaches the
     * file to its row, so a second confirm cannot hand the same object to a
     * second brand — and a retry after a network drop is answered honestly
     * rather than producing a duplicate.
     */
    consumedAt: { type: Date, default: null },

    /**
     * ⚠️ A **TTL index**, and the reason this collection does not grow without
     * bound. Mongo removes the row once this passes.
     *
     * It is not a security boundary — the signed URL has its own, shorter
     * expiry, and the bucket lifecycle rule removes the object. This just stops
     * abandoned intents from accumulating for ever.
     */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

/** Mongo's TTL monitor deletes a document once `expiresAt` is in the past. */
uploadSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Confirm looks a row up by its id and its owner together, so a valid id
 * belonging to somebody else never even loads.
 */
uploadSchema.index({ _id: 1, userId: 1 });

module.exports = mongoose.model("Upload", uploadSchema);
