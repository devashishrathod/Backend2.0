const User = require("../../models/User");
const { generateUniqueDisplayId } = require("../common");

/** `#TU123456` — see `helpers/common/generateUniqueDisplayId.js` for the why. */
exports.generateUniqueUserId = async () =>
  generateUniqueDisplayId(User, { prefix: "#TU" });
