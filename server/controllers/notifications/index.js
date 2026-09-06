const { getAll } = require("./getAll");
const { markRead } = require("./markRead");
const { broadcast } = require("./broadcast");
const {
  getMyPreferences,
  updateMyPreferences,
  getPreferencesForUser,
  updatePreferencesForUser,
} = require("./preferences");

module.exports = {
  getAll,
  markRead,
  broadcast,
  getMyPreferences,
  updateMyPreferences,
  getPreferencesForUser,
  updatePreferencesForUser,
};
