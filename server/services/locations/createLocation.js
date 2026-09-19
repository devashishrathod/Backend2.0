const mongoose = require("mongoose");
const Location = require("../../models/Location");
const Brand = require("../../models/Brand");
const Customer = require("../../models/Customer");
const { LOCATION_KINDS } = require("../../constants/location");
const {
  resolveLocationTarget,
  flagsForKind,
} = require("../../helpers/locations");
const { syncSubBrandLocAndGeo } = require("../../helpers/subBrands");
const { throwError } = require("../../utils");

/**
 * @param {{ userId: string, role: string, brandId?: string }} actor
 * @param {object} payload
 */
exports.createLocation = async (actor, payload) => {
  const {
    addressLine1,
    addressLine2,
    landmark,
    district,
    city,
    zipcode,
    state,
    country,
    formattedAddress,
    coordinates,
    addressType,
    isDefault = false,
  } = payload;

  /**
   * Who this address belongs to, and whether this caller may create it.
   *
   * Everything identifying goes on the row from here — `userId`, `customerId`,
   * `brandId`, `subBrandId` — read off the brand, outlet or customer rather
   * than taken from the request. Before this the service asked only whether the
   * named brand *existed*, so any vendor could attach an address to any brand
   * by naming its id, and a brand or outlet address was stored with no `userId`
   * at all.
   */
  const { kind, ownership } = await resolveLocationTarget(actor, payload);

  const geo = { type: "Point", coordinates };

  const locationData = {
    kind,
    ...ownership,
    ...flagsForKind(kind),
    createdBy: actor.userId,
    updatedBy: actor.userId,
    addressLine1,
    addressLine2,
    landmark,
    city,
    district,
    zipcode,
    state,
    country,
    formattedAddress:
      formattedAddress ||
      [
        addressLine1,
        addressLine2,
        landmark,
        city,
        district,
        state,
        zipcode,
        country,
      ]
        .filter(Boolean)
        .map((value) => String(value))
        .join(", "),
    geo,
    addressType,
    isDefault,
  };

  /**
   * ⚠️ The row and the pointer back to it are one change, not two.
   *
   * `Location.create()` used to run **before** the brand was even looked up, so
   * a wrong `brandId` answered 404 with the row already written — a document
   * nothing referenced, nothing would ever show, and nothing would clean up.
   * Even in the right order the two writes could still part company: a failure
   * between them left an address with no owner pointing at it, which is how
   * seven of the twenty-four rows in the development database ended up
   * unreferenced by their parent.
   */
  const session = await mongoose.startSession();
  let location;
  try {
    await session.withTransaction(async () => {
      const [created] = await Location.create([locationData], { session });
      location = created;

      if (kind === LOCATION_KINDS.BRAND) {
        await Brand.updateOne(
          { _id: ownership.brandId },
          { $set: { locationId: created._id } },
          { session },
        );
      } else if (kind === LOCATION_KINDS.SUB_BRAND) {
        await syncSubBrandLocAndGeo(
          ownership.subBrandId,
          created.geo,
          created._id,
          session,
        );
      } else {
        await Customer.updateOne(
          { _id: ownership.customerId },
          { $set: { locationId: created._id } },
          { session },
        );
      }
    });
  } catch (error) {
    /**
     * ⚠️ A duplicate here is a rule, not a crash.
     *
     * The partial unique indexes allow one **live** address per owner. Without
     * this the raw `E11000` reaches `errorHandler` as a 500, and a vendor whose
     * brand already has an address is told the server broke rather than what to
     * do — which is to delete the old one, since `kind` is immutable and
     * replacing is the supported way to change an address.
     */
    if (error?.code === 11000) {
      throwError(
        409,
        "This already has an address. Delete the existing one before adding another.",
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }

  return location;
};
