const {
  resolveLocationTarget,
  resolveExistingLocationTarget,
  kindOfLocation,
  deriveKind,
  flagsForKind,
} = require("./resolveLocationTarget");

/**
 * ⚠️ A `helpers/locations/` existed before and was deleted — it held a
 * geo-lookup (pincode → city) that nothing imported. This is not that coming
 * back: same folder name, unrelated job. Everything here has a caller.
 */
module.exports = {
  // The one place that decides who may write a location and whose it is.
  resolveLocationTarget,
  // …and the same, for a row that already exists. Use this for update and
  // delete: it also compares the resolved owner against the row, which the
  // create-time version deliberately does not do.
  resolveExistingLocationTarget,
  kindOfLocation,
  deriveKind,
  // `isBrandAddress` / `isSubBrandAddress` from a `kind`. The API has always
  // returned both, so they are still stored — but only ever written from here.
  flagsForKind,
};
