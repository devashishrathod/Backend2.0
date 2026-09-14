const mongoose = require("mongoose");
const { storageSchema } = require("./storageSchema");
const { OUTLET_TYPES } = require("../constants");
const { isValidateStoreId } = require("../validator/common");
const { emailField, mobileField, whatsappField } = require("./contactFields");
const {
  userField,
  brandField,
  locationField,
  workHoursField,
} = require("./validObjectId");

/**
 * Where the outlet is — and **absent** when nobody has said yet.
 *
 * ⚠️ A sub-schema with `default: undefined`, not an inline object, and that is
 * the whole point of it. `geo.coordinates` used to default to `[0, 0]`, which
 * is not "no position": it is a point in the Gulf of Guinea, and the 2dsphere
 * index treats it as a real one. `signUpSubBrandWithWhatsapp` never sets `geo`,
 * so **every outlet was born there** and stayed until somebody added an
 * address. Nothing failed — the outlet simply never matched a nearest search,
 * and neither did its vouchers. The vendor saw a voucher created, approved and
 * published that no customer was ever shown, with nothing anywhere to say why.
 *
 * Dropping that default is not enough on its own, in two ways that only show up
 * against a real Mongo:
 *
 *  - a Mongoose array path defaults to `[]` unless told otherwise, and `[]`
 *    fails the validator below;
 *  - with `geo.type` still defaulting to `"Point"`, an outlet with no address
 *    stores `{ type: "Point" }` — half a GeoJSON object, which the 2dsphere
 *    index **refuses outright**: *"Can't extract geo keys … Point must be an
 *    array or object, instead got type missing"*. Every outlet insert failed.
 *
 * A sub-schema whose default is `undefined` leaves the field off the document
 * entirely, and `$geoNear` skips a document with no value at its key. Set
 * coordinates and `type` still fills itself in.
 */
const geoPointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: {
      type: [Number],
      validate: {
        validator: function (value) {
          if (!Array.isArray(value) || value.length !== 2) {
            return false;
          }
          const [lng, lat] = value;
          return (
            Number.isFinite(lng) &&
            Number.isFinite(lat) &&
            lng >= -180 &&
            lng <= 180 &&
            lat >= -90 &&
            lat <= 90
          );
        },
        message: "SubBrand geo coordinates must be [longitude, latitude].",
      },
    },
  },
  { _id: false },
);

const subBrandSchema = new mongoose.Schema(
  {
    userId: { ...userField, required: true },
    brandId: { ...brandField, required: true },
    locationId: locationField,
    workHoursId: workHoursField,
    joinedDate: { type: Date, default: Date.now },
    outletType: {
      type: String,
      enum: Object.values(OUTLET_TYPES),
      default: OUTLET_TYPES.OUTLET,
    },
    // Mirrors of the outlet manager's `User` — see `models/contactFields.js`.
    email: emailField,
    mobile: mobileField,
    whatsappNumber: whatsappField,
    uniqueId: { type: String, required: true, unique: true },
    storeId: {
      type: String,
      required: true,
      validate: {
        validator: isValidateStoreId,
        message: (props) => `${props.value} is not a valid Store Id`,
      },
      unique: true,
    },
    geo: { type: geoPointSchema, default: undefined },
    logo: { type: String },
    // Sibling of the field above — provider + key, so a delete does not have
    // to infer where the bytes are from the URL. Absent on rows written
    // before this existed; `deleteAsset` falls back to the URL for those.
    logoStorage: { type: storageSchema, default: undefined },
    coverImage: { type: String },
    coverImageStorage: { type: storageSchema, default: undefined },
    description: { type: String },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

subBrandSchema.index({ geo: "2dsphere" });

subBrandSchema.index({ isActive: 1, isDeleted: 1 });

subBrandSchema.index({ brandId: 1, isActive: 1, isDeleted: 1 });

subBrandSchema.index({ locationId: 1 });

subBrandSchema.index({ userId: 1, isActive: 1, isDeleted: 1 });

module.exports = mongoose.model("SubBrand", subBrandSchema);
