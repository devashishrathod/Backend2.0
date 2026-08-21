const mongoose = require("mongoose");

const promotionalTickerSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    icon: {
      url: {
        type: String,
        required: true,
        trim: true,
      },
      storage: {
        provider: {
          type: String,
          enum: ["CLOUDINARY", "S3"],
          default: "CLOUDINARY",
        },
        publicId: { type: String },
        bucket: { type: String },
        key: { type: String },
      },
    },
    redirect: {
      type: {
        type: String,
        enum: ["NONE", "CATEGORY", "DEAL", "BRAND", "OFFER", "EXTERNAL_URL"],
        default: "NONE",
      },
      targetId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
      url: {
        type: String,
        trim: true,
        default: null,
      },
    },
    displayOrder: {
      type: Number,
      required: true,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
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
  },
  { timestamps: true, versionKey: false },
);

promotionalTickerSchema.index({
  isDeleted: 1,
  isActive: 1,
  displayOrder: 1,
});

module.exports = mongoose.model("PromotionalTicker", promotionalTickerSchema);
