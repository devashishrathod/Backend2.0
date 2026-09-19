const { ROLES } = require("../../constants");
const { LOCATION_KINDS } = require("../../constants/location");
const Location = require("../../models/Location");
const User = require("../../models/User");
const Customer = require("../../models/Customer");
const { flagsForKind } = require("../../helpers/locations");
const { throwError } = require("../../utils");

/**
 * Save (or replace) the signed-in customer's single address.
 *
 * Scoped to the token holder only. `userId` used to be read off the body and
 * preferred over the token — the role check that followed then ran against the
 * *target* account rather than the caller, so any customer could overwrite any
 * other customer's address by naming their id. That is worse than it sounds:
 * the voucher feed is built from this location, so rewriting it silently
 * changes what the victim is shown.
 */
exports.upsertLocation = async (tokenUserId, payload) => {
  let {
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
    isDefault,
  } = payload;
  // ⚠️ No `isBrandAddress` / `isSubBrandAddress` here. `validateUpsertLocation`
  // does not accept them, so they were always `undefined` — and reading them
  // would now overwrite the flags derived from `kind` below.

  const userId = tokenUserId;
  const user = await User.findById(userId);
  if (!user || user.isDeleted) throwError(404, "User not found");
  if (user.role !== ROLES.CUSTOMER) throwError(403, "User is not a customer");
  const customerId = user.customerId;
  const customer = await Customer.findById(customerId);
  if (!customer || customer.isDeleted) throwError(404, "Customer not found");
  let locationData = {
    /**
     * The same three facts every other write records: what this address is,
     * whose it is, and who touched it. `createdBy` is set only on the insert
     * below — an upsert that lands on an existing row must not rewrite who
     * created it.
     */
    kind: LOCATION_KINDS.CUSTOMER,
    ...flagsForKind(LOCATION_KINDS.CUSTOMER),
    updatedBy: userId,
    userId,
    customerId,
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
    geo: { type: "Point", coordinates },
    addressType,
    isDefault,
    isDeleted: false,
  };

  /**
   * ⚠️ Matched on both ids, not on `userId` alone.
   *
   * Brand and outlet addresses now carry a `userId` too — the brand owner's or
   * the outlet's — so `userId` on its own is no longer a statement about whose
   * *kind* of address this is. Pairing it with `customerId` names exactly one
   * row and cannot reach across to another kind.
   *
   * Not filtered on `isDeleted`: an address that was removed and is being saved
   * again should come back on this row rather than leave a deleted one behind
   * and add a second.
   */
  let location = await Location.findOne({ userId, customerId });
  if (location) {
    location = await Location.findByIdAndUpdate(location._id, locationData, {
      returnDocument: "after",
    });
  } else {
    // Only on the insert — an upsert landing on an existing row must not
    // rewrite who created it.
    location = await Location.create({ ...locationData, createdBy: userId });
  }
  customer.locationId = location._id;
  await customer.save();
  return location;
};
