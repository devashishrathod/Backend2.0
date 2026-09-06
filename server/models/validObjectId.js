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
  /*
   * ⚠️ `billField: refField("Bill")` used to sit here, and there is no `Bill`
   * model — there never was. Removed along with its only consumer,
   * `Transaction.billId`, which nothing in the codebase wrote or read.
   *
   * Exactly the same fault as `refundRequestField` below. Mongoose raises a
   * dangling ref only at `populate()` time, so both looked valid for as long as
   * nothing populated them — which for a field nobody used meant for ever.
   * `scripts/verifySchemaRelationships.js` now catches this shape at once.
   */
  settlementField: refField("Settlement"),
  /**
   * The refund record is `RefundRequest`; there is no `Refund` model and there
   * will not be one.
   *
   * This used to ref `"Refund"` — a model that never existed. Mongoose only
   * raises that at `populate()` time, and nothing ever populated it, so it sat
   * silently valid-looking for as long as it existed.
   */
  refundRequestField: refField("RefundRequest"),

  /**
   * Array of location ids, validated element by element.
   *
   * ⚠️ The ref was `"location"` — **lowercase**. Mongoose model names are
   * case-sensitive, so that resolved to nothing and `populate()` on it would
   * have thrown `MissingSchemaError`. Nothing uses this descriptor today,
   * which is the only reason it never fired: a broken ref waiting for its
   * first consumer.
   */
  locationsField: Object.freeze({
    type: [ObjectId],
    ref: "Location",
    validate: {
      validator: (arr) => Array.isArray(arr) && arr.every(isValidId),
      message: (props) =>
        `One or more location IDs in ${props.value} are invalid`,
    },
  }),
});
