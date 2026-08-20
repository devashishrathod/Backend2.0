const mongoose = require("mongoose");

const voucherSettingSchema = new mongoose.Schema(
  {
    maxOffers: {
      type: Number,
      default: 10,
      min: 1,
      max: 100,
    },
    maxImages: {
      type: Number,
      default: 5,
      min: 1,
    },
    maxDistanceKm: {
      type: Number,
      default: 25,
      min: 1,
    },
  },
  { _id: false },
);

const showcaseSettingSchema = new mongoose.Schema(
  {
    maxSections: {
      type: Number,
      required: true,
      default: 5,
      min: 1,
    },
    maxItemsPerSection: {
      type: Number,
      required: true,
      default: 15,
      min: 1,
    },
    maxImagesPerSection: {
      type: Number,
      required: true,
      default: 15,
      min: 1,
    },
    maxVideosPerSection: {
      type: Number,
      required: true,
      default: 5,
      min: 1,
    },
    maxImageSizeMB: {
      type: Number,
      required: true,
      default: 10,
      min: 1,
    },
    maxVideoSizeMB: {
      type: Number,
      required: true,
      default: 50,
      min: 1,
    },
    allowedImages: {
      type: [String],
      default: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
    },
    allowedVideos: {
      type: [String],
      default: ["video/mp4", "video/webm", "video/quicktime"],
    },
    isActive: { type: Boolean, default: true },
  },
  { _id: false },
);

const vendorSettingSchema = new mongoose.Schema(
  {
    voucher: {
      type: voucherSettingSchema,
      default: () => ({}),
    },
    showcase: {
      type: showcaseSettingSchema,
      default: () => ({}),
    },
  },
  { _id: false },
);

const customerSettingSchema = new mongoose.Schema(
  {
    // Future customer settings
  },
  { _id: false },
);

const settingSchema = new mongoose.Schema(
  {
    vendor: {
      type: vendorSettingSchema,
      default: () => ({}),
    },
    customer: {
      type: customerSettingSchema,
      default: () => ({}),
    },
    isActive: { type: Boolean, default: true },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model("Setting", settingSchema);
