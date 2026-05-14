const mongoose = require("mongoose");
const { OFFERS_SCOPE, SUGGESTION_STATUS } = require("../constants");
const { usersField, voucherField } = require("./validMogooseObjectId");

const stateSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true },
    countryCode: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["state"], default: "state" },
  },
  { _id: false }
);

const citySchema = new mongoose.Schema(
  {
    countryCode: { type: String, required: true, trim: true },
    stateCode: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["district", "city"], default: "district" },
  },
  { _id: false }
);

const suggestionSchema = new mongoose.Schema(
  {
    users: usersField,
    voucher: voucherField,
    states: { type: [stateSchema], required: true },
    cities: { type: [citySchema], required: true },
    scope: {
      type: String,
      enum: [...Object.values(OFFERS_SCOPE)],
      default: OFFERS_SCOPE.ALL_USERS,
    },
    status: {
      type: String,
      enum: [...Object.values(SUGGESTION_STATUS)],
      required: true,
    },
    image: { type: String, required: true },
    title: {
      type: String,
      required: [true, "Suggestion title is required"],
      minlength: 3,
      maxlength: 100,
      trim: true,
    },
    description: {
      type: String,
      maxlength: 500,
      default: "",
      trim: true,
    },
    discountTitle: { type: String },
    originalPrice: {
      type: Number,
      required: true,
      min: [0, "Price cannot be negative"],
    },
    discountPrice: {
      type: Number,
      required: true,
      min: [0, "Discount price cannot be negative"],
      validate: {
        validator: function (v) {
          return v < this.originalPrice;
        },
        message: "Discount price must be less than original price",
      },
    },
    publishedDate: { type: Date, required: true },
    endDate: {
      type: Date,
      required: true,
      validate: {
        validator: function (v) {
          return v >= this.publishedDate;
        },
        message: "End date must be after or equal to published date",
      },
    },
    valueOfAmount: { type: Number, min: 0 },
    uniqueId: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

suggestionSchema.index({ "states.name": 1 });
suggestionSchema.index({ "states.code": 1 });
suggestionSchema.index({ "cities.name": 1 });
suggestionSchema.index({ "cities.stateCode": 1 });
suggestionSchema.index({ publishedDate: -1, createdAt: -1 });

module.exports = mongoose.model("Suggestion", suggestionSchema);
