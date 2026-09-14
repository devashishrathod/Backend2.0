const mongoose = require("mongoose");
const Location = require("../../models/Location");
const { throwError } = require("../../utils");
const { LOCATION_KINDS } = require("../../constants/location");
const {
  resolveExistingLocationTarget,
  kindOfLocation,
} = require("../../helpers/locations");
const { syncSubBrandLocAndGeo } = require("../../helpers/subBrands");

/** Copied as sent. */
const AS_GIVEN = [
  "addressLine1",
  "addressLine2",
  "landmark",
  "zipcode",
  "formattedAddress",
  "addressType",
];

/**
 * Stored lowercase, because every filter and search compares against the
 * lowercased value. A row that kept its capitals is simply never matched.
 */
const UPDATED_FIELDS = ["city", "district", "state", "country"];

/**
 * Only what was sent. A `PUT` here is a partial update — the panel sends the
 * fields the vendor touched, and an absent key must not blank a stored value.
 */
const buildUpdate = (payload, actorUserId) => {
  const update = { updatedBy: actorUserId };

  for (const field of AS_GIVEN) {
    if (payload[field]) update[field] = payload[field];
  }
  for (const field of UPDATED_FIELDS) {
    if (payload[field]) update[field] = String(payload[field]);
  }
  // `false` is a real value here, so presence is the test rather than truth.
  if (payload.isDefault !== undefined) update.isDefault = payload.isDefault;

  return update;
};

/** A form sends `"false"`, JSON sends `false`, and both mean the same thing. */
const asBool = (value) => value === true || value === "true";

/**
 * Refuse an attempt to change what a location is — and only that.
 *
 * ⚠️ Each flag is compared **only if it was sent**, rather than deriving a kind
 * from the pair. A partial update that echoes back one flag and omits the other
 * would otherwise read as "both false", which means CUSTOMER, and every such
 * update to a brand or outlet address would be refused for a change nobody
 * asked for.
 */
const assertKindUnchanged = (kind, { isBrandAddress, isSubBrandAddress }) => {
  const wrong =
    (isBrandAddress !== undefined &&
      asBool(isBrandAddress) !== (kind === LOCATION_KINDS.BRAND)) ||
    (isSubBrandAddress !== undefined &&
      asBool(isSubBrandAddress) !== (kind === LOCATION_KINDS.SUB_BRAND));

  if (wrong) {
    throwError(
      400,
      "A location's type cannot be changed. Delete it and create a new one.",
    );
  }
};

/**
 * @param {{ userId: string, role: string, brandId?: string }} actor
 * @param {object} payload
 */
exports.updateLocation = async (actor, payload) => {
  const { id, coordinates, isBrandAddress, isSubBrandAddress } = payload;

  const location = await Location.findById(id);
  if (!location || location.isDeleted) throwError(404, "Location not found");

  /**
   * ⚠️ This service took a `userId` and never read it. The row was found by id
   * and updated, so any vendor could rewrite any brand's or outlet's address —
   * and a Location can belong to a **customer**, whose voucher feed is built
   * from it, so rewriting one silently changes what somebody else is shown.
   */
  const kind = kindOfLocation(location);
  await resolveExistingLocationTarget(actor, location);

  /**
   * ⚠️ Changing what a location *is* is refused, not applied.
   *
   * Both flags used to be writable here. Flipping one made the row claim a
   * different owner while `Brand.locationId`, `SubBrand.locationId` and
   * `Customer.locationId` all went on pointing where they had — broken from
   * both directions at once, with nothing to notice it. Nothing re-points those
   * three, so the honest answer is that this is not an edit.
   */
  assertKindUnchanged(kind, { isBrandAddress, isSubBrandAddress });

  const locationData = buildUpdate(payload, actor.userId);

  const geo = coordinates ? { type: "Point", coordinates } : null;
  if (geo) locationData.geo = geo;

  /**
   * ⚠️ The outlet's own position moves with the address, in the same
   * transaction.
   *
   * `syncSubBrandLocAndGeo` was called here **without `await`**, so a failure
   * went nowhere: the address updated, `SubBrand.geo` did not, and nothing
   * said so. That field is what the customer's nearest search reads — the
   * voucher pipeline's `$geoNear` runs on `SubBrand`, not on `Location` — so
   * the panel would show the new address while every customer was still
   * directed to the old one.
   */
  const needsGeoSync = geo && kind === LOCATION_KINDS.SUB_BRAND;

  if (!needsGeoSync) {
    return await Location.findByIdAndUpdate(id, locationData, {
      returnDocument: "after",
    });
  }

  const session = await mongoose.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      updated = await Location.findByIdAndUpdate(id, locationData, {
        returnDocument: "after",
        session,
      });
      await syncSubBrandLocAndGeo(location.subBrandId, geo, undefined, session);
    });
  } finally {
    await session.endSession();
  }
  return updated;
};
