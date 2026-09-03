const GST = require("../../models/GST");
const PAN = require("../../models/PAN");
const Location = require("../../models/Location");

const compact = (parts) =>
  parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(", ");

const normalize = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * The GST record's address is the registered place of business, which is what
 * belongs on a tax invoice — so it is preferred over the brand's map location.
 *
 * The provider often returns `location` already flattened to the full address,
 * repeating the individual parts. Naively joining every field then produces
 * "2nd Floor, Phase-3, 2nd Floor, Phase-3, Suite 250, …", so any part already
 * contained in `location` is dropped.
 */
const formatGstAddress = (address = {}) => {
  const location = String(address.location ?? "").trim();
  const haystack = normalize(location);

  const parts = [
    address.floorNumber,
    address.buildingNumber,
    address.buildingName,
    location,
    address.city,
    address.district,
    address.state,
    address.pin,
  ].filter((part) => {
    const text = String(part ?? "").trim();
    if (!text) return false;
    if (text === location) return true;
    const needle = normalize(text);
    return needle.length > 0 && !haystack.includes(needle);
  });

  return compact(parts);
};

const formatLocationAddress = (location = {}) =>
  location.formattedAddress?.trim() ||
  compact([
    location.addressLine1,
    location.addressLine2,
    location.landmark,
    location.city,
    location.district,
    location.state,
    location.zipcode,
  ]);

const formatPanAddress = (address = {}) =>
  compact([
    address.buildingName,
    address.streetName,
    address.locality,
    address.city,
    address.state,
    address.pincode,
  ]);

/**
 * Assemble the "Billing Details" block shown on the checkout page, and the
 * buyer identity the tax calculation needs.
 *
 * Address resolution order — registered GST address, then the brand's saved
 * location, then the PAN address. `addressSource` is returned so the panel can
 * tell the vendor why it is showing what it is showing.
 *
 * `stateCode` / `state` feed `calculatePricing`'s place-of-supply decision,
 * which is what makes the tax line read IGST vs CGST+SGST.
 */
exports.buildBillingDetails = async (brand) => {
  const [gst, pan, location] = await Promise.all([
    brand?.GSTId
      ? GST.findOne({ _id: brand.GSTId, isDeleted: false })
          .select("gstNumber legalName tradeName address stateCode")
          .lean()
      : null,
    brand?.PANId
      ? PAN.findOne({ _id: brand.PANId, isDeleted: false })
          .select("pan fullName addressDetails")
          .lean()
      : null,
    brand?.locationId
      ? Location.findOne({ _id: brand.locationId, isDeleted: false })
          .select(
            "addressLine1 addressLine2 landmark city district state zipcode formattedAddress",
          )
          .lean()
      : null,
  ]);

  const gstAddress = gst?.address ? formatGstAddress(gst.address) : "";
  const locationAddress = location ? formatLocationAddress(location) : "";
  const panAddress = pan?.addressDetails
    ? formatPanAddress(pan.addressDetails)
    : "";

  let address = "";
  let addressSource = null;
  if (gstAddress) {
    address = gstAddress;
    addressSource = "GST";
  } else if (locationAddress) {
    address = locationAddress;
    addressSource = "LOCATION";
  } else if (panAddress) {
    address = panAddress;
    addressSource = "PAN";
  }

  const gstin = gst?.gstNumber || null;

  return {
    brandName: brand?.brandName || brand?.legalBusinessName || null,
    legalBusinessName: brand?.legalBusinessName || null,
    address: address || null,
    addressSource,
    gstin,
    pan: pan?.pan || null,
    email: brand?.email || null,
    whatsappNumber: brand?.whatsappNumber || brand?.mobile || null,
    // Place-of-supply inputs. The GSTIN's first two digits are the state code;
    // the state name is only used when there is no GSTIN at all.
    stateCode: gstin ? String(gstin).slice(0, 2) : gst?.stateCode || null,
    state: gst?.address?.state || location?.state || null,
  };
};
