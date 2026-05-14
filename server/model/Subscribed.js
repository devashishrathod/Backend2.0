const mongoose = require("mongoose");
const {
  subscriptionField,
  brandField,
  userField,
  transactionField,
  subscribedsField,
  subscribedField,
} = require("./validMogooseObjectId");

const subscribedSchema = new mongoose.Schema(
  {
    user: userField,
    brand: brandField,
    subscribedBy: userField,
    upgradedBy: userField,
    transaction: transactionField,
    subscription: subscriptionField,
    upgradedTo: subscribedField,
    previousPlans: subscribedsField,
    durationInDays: { type: Number },
    durationInYears: { type: Number },
    startDate: { type: Date },
    endDate: { type: Date },
    expiryDate: { type: Date },
    price: { type: Number },
    discount: { type: Number },
    numberOfSubBrands: { type: Number },
    paidAmount: { type: Number },
    dueAmount: { type: Number },
    upgradeDate: { type: Date },
    numberOfUpgrade: { type: Number, default: 0 },
    isCoolingPlan: { type: Boolean, default: false },
    isExpired: { type: Boolean, default: false },
    isUpgraded: { type: Boolean, default: false },
    isActive: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

subscribedSchema.index({ endDate: 1, isExpired: 1 });

module.exports = mongoose.model("Subscribed", subscribedSchema);
