const mongoose = require("mongoose");
const ObjectId = mongoose.Types.ObjectId;
const isValidId = ObjectId.isValid;

const refField = (refModel, errorLabel = refModel) =>
  Object.freeze({
    type: ObjectId,
    ref: refModel,
    validate: {
      validator: (value) => {
        if (value === null || value === undefined) return true;
        return isValidId(value);
      },
      message: (props) => `${props.value} is not a valid ${errorLabel} ID`,
    },
  });

module.exports = Object.freeze({
  userField: refField("User"),
  brandField: refField("Brand"),
  subBrandField: refField("SubBrand"),
  categoryField: refField("Category"),
  subCategoryField: refField("SubCategory"),
  dealOfCategoryField: refField("DealOfCategory"),
  locationField: refField("Location"),
  workHoursField: refField("WorkHours"),
  gstField: refField("Gst"),
  bankAccountField: refField("BankAccount"),
  subscribedField: refField("Subscribed"),
  subscriptionField: refField("Subscription"),
  voucherField: refField("Voucher"),
  transactionField: refField("Transaction"),
  billField: refField("Bill"),
  feedbackField: refField("Feedback"),
  employeeField: refField("Employee"),
  employeeReferralField: refField("EmployeeReferral"),
  pushNotificationField: refField("PushNotification"),
  refundField: refField("Refund"),

  vouchersField: Object.freeze({
    type: [ObjectId],
    ref: "Voucher",
    validate: {
      validator: (arr) => Array.isArray(arr) && arr.every(isValidId),
      message: (props) =>
        `One or more Voucher IDs in ${props.value} are invalid`,
    },
  }),

  subBrandsField: Object.freeze({
    type: [ObjectId],
    ref: "SubBrand",
    validate: {
      validator: (arr) => Array.isArray(arr) && arr.every(isValidId),
      message: (props) =>
        `One or more SubBrand IDs in ${props.value} are invalid`,
    },
  }),

  usersField: Object.freeze({
    type: [ObjectId],
    ref: "User",
    validate: {
      validator: (arr) => Array.isArray(arr) && arr.every(isValidId),
      message: (props) => `One or more Users IDs in ${props.value} are invalid`,
    },
  }),

  imagesField: Object.freeze({
    type: [ObjectId],
    ref: "Image",
    validate: {
      validator: (arr) => Array.isArray(arr) && arr.every(isValidId),
      message: (props) =>
        `One or more Images IDs in ${props.value} are invalid`,
    },
  }),

  subscribedsField: Object.freeze({
    type: [ObjectId],
    ref: "Subscribed",
    validate: {
      validator: (arr) => Array.isArray(arr) && arr.every(isValidId),
      message: (props) =>
        `One or more Subscribed IDs in ${props.value} are invalid`,
    },
  }),
});
