const { ROLES } = require("../../constants");
const Location = require("../../models/Location");
const User = require("../../models/User");
const Customer = require("../../models/Customer");
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
    isBrandAddress,
    isSubBrandAddress,
    isDefault,
  } = payload;

  const userId = tokenUserId;
  const user = await User.findById(userId);
  if (!user || user.isDeleted) throwError(404, "User not found");
  if (user.role !== ROLES.CUSTOMER) throwError(403, "User is not a customer");
  const customerId = user.customerId;
  const customer = await Customer.findById(customerId);
  if (!customer || customer.isDeleted) throwError(404, "Customer not found");
  let locationData = {
    userId,
    customerId,
    addressLine1,
    addressLine2,
    landmark,
    city: city?.toLowerCase(),
    district: district?.toLowerCase(),
    zipcode,
    state: state?.toLowerCase(),
    country: country?.toLowerCase(),
    formattedAddress:
      formattedAddress ||
      `${addressLine1?.toLowerCase()}, ${addressLine2?.toLowerCase()}, ${landmark?.toLowerCase()}, ${city?.toLowerCase()}, ${district?.toLowerCase()}, ${state?.toLowerCase()}, ${zipcode}, ${country?.toLowerCase()}`.trim(),
    geo: { type: "Point", coordinates },
    addressType,
    isBrandAddress,
    isSubBrandAddress,
    isDefault,
    isDeleted: false,
  };
  let location = await Location.findOne({ userId });
  if (location) {
    location = await Location.findByIdAndUpdate(location._id, locationData, {
      returnDocument: "after",
    });
  } else {
    location = await Location.create(locationData);
  }
  customer.locationId = location._id;
  await customer.save();
  return location;
};
