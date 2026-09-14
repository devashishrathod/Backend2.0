const mongoose = require("mongoose");
const { isValidZipCode } = require("../validator/common");
const {
  userField,
  brandField,
  subBrandField,
  customerField,
} = require("./validObjectId");
const { ADDRESS_TYPES } = require("../constants");
const { LOCATION_KINDS } = require("../constants/location");

const locationSchema = new mongoose.Schema(
  {
    /**
     * What this address belongs to — the single source of truth for that.
     *
     * `isBrandAddress` / `isSubBrandAddress` below are its projection, kept
     * because the API has always returned them and the panels read them. They
     * are written from `kind` and never independently; see the `pre("validate")`
     * hook. Before this they were the only answer, and they disagreed with the
     * ids on the same row — three rows carried a `brandId` while
     * `isBrandAddress` was `false`, and no row anywhere had it `true`.
     *
     * ⚠️ `required`, and only safe to be so after
     * `scripts/backfillLocationOwnership.js` has run: making it required while
     * older rows lacked it would have failed `.save()` on them, and
     * `deleteLocation` saves.
     */
    kind: {
      type: String,
      enum: Object.values(LOCATION_KINDS),
      required: true,
    },
    /**
     * Whose address this is — the brand's owner, the outlet's user, or the
     * customer. Derived from the entity, never accepted from a client.
     *
     * ⚠️ Distinct from `createdBy`. An admin fixing a customer's address leaves
     * `userId` on the customer and records themselves in `updatedBy`; without
     * that separation the customer could no longer find their own address.
     *
     * `required` now. It was optional — and `createLocation` actively set it to
     * `undefined` for anything that was not a customer's own address, so 19 of
     * 24 rows had no owner recorded at all. Among other things that made the
     * seeder's own clear, which matches on `userId`, unable to see them.
     */
    userId: { ...userField, required: true },
    customerId: customerField,
    /**
     * Set on an **outlet's** address too, not only a brand's own. "Every
     * address under this brand" is then one indexed query rather than a `$in`
     * over every outlet id, and that same query is what scopes a vendor's list
     * to their own rows.
     */
    brandId: brandField,
    subBrandId: subBrandField,
    // Who performed the write. Answers "who changed this", which `userId`
    // cannot: it names the owner, and the owner is often not the actor.
    createdBy: userField,
    updatedBy: userField,
    addressLine1: { type: String, required: true },
    addressLine2: { type: String },
    landmark: { type: String },
    addressType: {
      type: String,
      enum: Object.values(ADDRESS_TYPES),
      default: ADDRESS_TYPES.HOME,
    },
    // name: { type: String },
    // shopOrBuildingNumber: { type: String },
    city: { type: String },
    district: { type: String },
    state: { type: String },
    country: { type: String },
    formattedAddress: { type: String },
    zipcode: {
      type: String,
      validate: {
        validator: function (value) {
          //  if (!value) return true;
          return isValidZipCode(this.country, value);
        },
        message: (props) =>
          `${props.value} is not a valid ZIP/postal code for country ${props.instance.country}`,
      },
    },
    geo: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
        required: true,
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: function (value) {
            if (!Array.isArray(value)) return false;
            if (value.length !== 2) return false;
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
          message:
            "Geo coordinates must be [longitude, latitude] with valid values.",
        },
      },
    },
    // ⚠️ Derived from `kind` — see the hook below. Kept as real fields rather
    // than virtuals because `getAllLocations` runs an aggregation, and a
    // virtual does not exist in a pipeline's output.
    isBrandAddress: { type: Boolean, default: false },
    isSubBrandAddress: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

/**
 * The two flags can never disagree with `kind`, because nothing writes them.
 *
 * A hook rather than trusting each caller: `Location.create()` is also reached
 * from seed and maintenance scripts, and a flag set by hand there is exactly
 * how the three inconsistent rows got in.
 *
 * ⚠️ Does not fire on `findOneAndUpdate`. That is fine and deliberate — `kind`
 * is immutable after creation (changing it would mean re-pointing
 * `Brand.locationId` / `SubBrand.locationId` / `Customer.locationId` and the
 * outlet's `geo`, and nothing does that), so an update never has to move them.
 *
 * ⚠️ Nor on `validateSync()`, which skips promise-style middleware. Nothing
 * here calls it, and the services set both flags from the same `kind` anyway
 * (`flagsForKind` in `helpers/locations`) — this is the backstop for the paths
 * that build a document directly, such as the seeder.
 */
locationSchema.pre("validate", function () {
  if (!this.kind) return;
  this.isBrandAddress = this.kind === LOCATION_KINDS.BRAND;
  this.isSubBrandAddress = this.kind === LOCATION_KINDS.SUB_BRAND;
});

/**
 * ⚠️ `Location.geo` is never queried geospatially — every read of this
 * collection follows a `locationId` pointer. The index is kept because the
 * field is real and populated, and building a 2dsphere over a large collection
 * later is far more expensive than carrying it now.
 *
 * Not to be confused with `location_2dsphere`, a leftover index on a field
 * named `location` that this model does not have and no document carries. That
 * one is dropped by `scripts/ensureIndexes.js`.
 */
locationSchema.index({ geo: "2dsphere" });

// locationSchema.index({ userId: 1, isActive: 1, isDeleted: 1 });

locationSchema.index({ customerId: 1, isActive: 1, isDeleted: 1 });

locationSchema.index({ subBrandId: 1, isActive: 1, isDeleted: 1 });

/**
 * A vendor's whole surface in one query — the brand's own address and every
 * outlet's. Without it that query, which is also the scope filter on
 * `GET /locations/getAll`, scans the collection: customers' home addresses
 * included.
 */
locationSchema.index({ brandId: 1, isActive: 1, isDeleted: 1 });

/**
 * One live address per owner — enforced by the database, not by intention.
 *
 * A parent points at one address through `locationId`, but nothing stopped a
 * second being created: `Location.create()` and the pointer update were two
 * separate writes, so a failure between them left an address nothing referenced
 * and the next attempt made another. Seven of the twenty-four rows in the
 * development database were live and unreferenced — the panel showing one
 * address while the listing showed three, with no way to tell which was real.
 *
 * ⚠️ Partial on `isDeleted: false`, so the rule is about **live** rows only.
 * Deleting an address and adding a new one still works, which is the whole
 * point — `kind` is immutable, so replacing is the supported way to change what
 * an address belongs to.
 *
 * ⚠️ Partial on `kind` rather than on the id alone, because an outlet's address
 * carries its `brandId` too. A unique index on `brandId` by itself would let a
 * brand have exactly one outlet.
 *
 * ⚠️ These cannot be built while duplicates exist — the build fails with
 * `E11000` naming one pair rather than the problem. Run
 * `scripts/backfillLocationOwnership.js --apply` first.
 */
locationSchema.index(
  { brandId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      kind: LOCATION_KINDS.BRAND,
      isDeleted: false,
    },
  },
);
locationSchema.index(
  { subBrandId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      kind: LOCATION_KINDS.SUB_BRAND,
      isDeleted: false,
    },
  },
);
locationSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      kind: LOCATION_KINDS.CUSTOMER,
      isDeleted: false,
    },
  },
);

// The AREA section of the global customer search, which only ever looks at
// outlet addresses. Without this every area search scans the whole
// collection — customers' home addresses included.
locationSchema.index({ subBrandId: 1, city: 1 });

// locationSchema.index(
//   { userId: 1, isDefault: 1 },
//   {
//     unique: true,
//     partialFilterExpression: {
//       isDefault: true,
//       isActive: true,
//       isDeleted: false,
//     },
//   },
// );

module.exports = mongoose.model("Location", locationSchema);
