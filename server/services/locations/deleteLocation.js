const mongoose = require("mongoose");
const Location = require("../../models/Location");
const SubBrand = require("../../models/SubBrand");
const Brand = require("../../models/Brand");
const Customer = require("../../models/Customer");
const { throwError } = require("../../utils");
const { LOCATION_KINDS } = require("../../constants/location");
const {
  resolveExistingLocationTarget,
  kindOfLocation,
} = require("../../helpers/locations");

/**
 * @param {{ userId: string, role: string, brandId?: string }} actor
 * @param {{ id: string }} payload
 */
exports.deleteLocation = async (actor, payload) => {
  const { id } = payload;

  const location = await Location.findById(id);
  if (!location || location.isDeleted) throwError(404, "Location not found");

  /**
   * ⚠️ This service took no actor at all — the row was found by id and
   * deleted. Since a Location can belong to a **customer**, any vendor token
   * could remove a customer's home address, and with it `Customer.locationId`:
   * their voucher feed is built from that address, so it would simply stop
   * working with an error about needing a location.
   */
  const kind = kindOfLocation(location);
  await resolveExistingLocationTarget(actor, location);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (kind === LOCATION_KINDS.SUB_BRAND && location.subBrandId) {
        /**
         * ⚠️ `geo` is removed, not zeroed.
         *
         * It used to be set to `[0, 0]`, which is not "nowhere" — it is a point
         * in the Gulf of Guinea, and the 2dsphere index treats it as a real
         * one. The outlet stayed in the index and was scanned by every nearest
         * search from then on, matching nothing. `$unset` takes it out
         * entirely: `$geoNear` skips a document with no value at the key.
         *
         * This only holds because `SubBrand.geo.coordinates` no longer defaults
         * to `[0, 0]` — Mongoose applies a default when hydrating a document
         * whose path is missing, so with it the next `subBrand.save()` (and
         * `updateSubBrand` does exactly that) would have put the point straight
         * back.
         */
        await SubBrand.updateOne(
          { _id: location.subBrandId },
          { $set: { locationId: null }, $unset: { geo: "" } },
          { session },
        );
      } else if (kind === LOCATION_KINDS.BRAND && location.brandId) {
        await Brand.updateOne(
          { _id: location.brandId },
          { $set: { locationId: null } },
          { session },
        );
      } else if (location.customerId) {
        await Customer.updateOne(
          { _id: location.customerId },
          { $set: { locationId: null } },
          { session },
        );
      }

      await Location.updateOne(
        { _id: location._id },
        {
          $set: {
            isDeleted: true,
            isActive: false,
            updatedBy: actor.userId,
          },
        },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  return;
};
