const mongoose = require("mongoose");
const { SUBSCRIPTION_PLAN_TYPE } = require("../constants");

const subscriptionSchema = new mongoose.Schema(
  {
    name: { type: String },
    price: { type: Number },
    description: { type: String },
    durationInDays: { type: Number },
    durationInYears: { type: Number },
    numberOfSubBrands: { type: Number },
    discount: { type: Number },
    benefits: [String],
    limitations: [String],
    type: {
      type: String,
      enum: [...Object.values(SUBSCRIPTION_PLAN_TYPE)],
      default: SUBSCRIPTION_PLAN_TYPE.ANNUAL,
    },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model("Subscription", subscriptionSchema);
