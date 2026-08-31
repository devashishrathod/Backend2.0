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
  categoryField: refField("Category"),
  subCategoryField: refField("SubCategory"),
  locationField: refField("Location"),
  customerField: refField("Customer"),
  brandField: refField("Brand"),
  PANField: refField("PAN"),
  GSTField: refField("GST"),
  BankField: refField("Bank"),
  systemVerifyField: refField("SystemVerify"),
  subscriptionField: refField("Subscription"),
  transactionField: refField("Transaction"),
  subscribedField: refField("Subscribed"),
  subBrandField: refField("SubBrand"),
  workHoursField: refField("WorkHours"),
  voucherField: refField("Voucher"),
  voucherSubBrandField: refField("VoucherSubBrand"),
  // Dangling: offers are embedded subdocuments inside VoucherVersion.offers,
  // there is no VoucherOffer model. Kept because existing schemas reference it;
  // new code should use a plain ObjectId for an offer id, not this.
  voucherOfferField: refField("VoucherOffer"),
  voucherVersionField: refField("VoucherVersion"),
  voucherClaimField: refField("VoucherClaim"),
  promoCodeField: refField("PromoCode"),
  billField: refField("Bill"),
  settlementField: refField("Settlement"),
  // Dangling in the same way: there is no Refund model and there will not be
  // one — the refund record is RefundRequest. Left in place only because
  // Transaction.refundId still uses it; that field is dropped in Phase S1.
  refundField: refField("Refund"),

  // Array of ObjectIds with validation
  locationsField: Object.freeze({
    type: [ObjectId],
    ref: "location",
    validate: {
      validator: (arr) => Array.isArray(arr) && arr.every(isValidId),
      message: (props) =>
        `One or more location IDs in ${props.value} are invalid`,
    },
  }),
});
