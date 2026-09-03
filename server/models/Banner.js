const mongoose = require("mongoose");
const { BANNER_TYPE, BANNER_MEDIA_FIELD } = require("../constants/banner");

const bannerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    type: {
      type: String,
      enum: Object.values(BANNER_TYPE),
      required: true,
      // Normalizes legacy lowercase values (image/video/gif) written before
      // BANNER_TYPE switched to uppercase, so old documents keep validating.
      set: (value) => (typeof value === "string" ? value.toUpperCase() : value),
    },
    redirect: {
      type: {
        type: String,
        enum: ["NONE", "CATEGORY", "DEAL", "BRAND", "OFFER", "EXTERNAL_URL"],
        default: null,
      },
      targetId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
      url: {
        type: String,
        default: null,
      },
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    image: {
      url: {
        type: String,
        trim: true,
      },
      storage: {
        provider: {
          type: String,
          enum: ["CLOUDINARY", "S3"],
        },
        publicId: { type: String },
        bucket: { type: String },
        key: { type: String },
      },
    },
    video: {
      url: {
        type: String,
        trim: true,
      },
      storage: {
        provider: {
          type: String,
          enum: ["CLOUDINARY", "S3"],
        },
        publicId: { type: String },
        bucket: { type: String },
        key: { type: String },
      },
    },
    gif: {
      url: {
        type: String,
        trim: true,
      },
      storage: {
        provider: {
          type: String,
          enum: ["CLOUDINARY", "S3"],
        },
        publicId: { type: String },
        bucket: { type: String },
        key: { type: String },
      },
    },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

bannerSchema.index({ isDeleted: 1, isActive: 1, startDate: 1, endDate: 1 });

bannerSchema.pre("validate", function () {
  const normalizedType = String(this.type || "").toUpperCase();
  const field =
    BANNER_MEDIA_FIELD[normalizedType] || String(this.type || "").toLowerCase();
  const media = this[field];
  if (!media || !media.url) {
    throw new Error(
      `${field} media is required for banner type '${this.type}'.`,
    );
  }
});

module.exports = mongoose.model("Banner", bannerSchema);
