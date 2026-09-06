const { getCustomerConfig } = require("../../helpers/settings");

/**
 * The chips shown before anybody has typed anything.
 *
 * Curated by an admin through `PUT /settings/update`, **not** derived from
 * traffic — nothing on this platform logs what customers search for, and this
 * endpoint is deliberately not the thing that starts.
 *
 * Guests are the main audience: their own recent searches live on their device,
 * so without this the box opens empty.
 *
 * ⚠️ `isEnabled: false` returns an empty list with a 200, not a 404. Turning a
 * feature off must not look to the app like the endpoint disappeared.
 */
exports.getPopularSearches = async () => {
  const config = (await getCustomerConfig()).search;

  return {
    isEnabled: config.isEnabled,
    queries: config.isEnabled ? config.popularQueries : [],
  };
};
