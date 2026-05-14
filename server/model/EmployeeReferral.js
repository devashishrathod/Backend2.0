const mongoose = require("mongoose");
const {
  employeeField,
  brandField,
  userField,
} = require("./validMogooseObjectId");

const employeeReferralSchema = new mongoose.Schema(
  {
    employee: employeeField,
    user: userField,
    brand: brandField,
    referCodeUsed: { type: String },
    referMobile: { type: String },
    subscriptionCount: {
      noOfCoolingPeriod: { type: Number, default: 0 },
      noOfStarterPlan: { type: Number, default: 0 },
      noOfProfessionalPlan: { type: Number, default: 0 },
      noOfEntrepreneurPlan: { type: Number, default: 0 },
    },
    isSubscribed: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("EmployeeReferral", employeeReferralSchema);
