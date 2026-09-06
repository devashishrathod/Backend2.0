const Brand = require("../../models/Brand");
const { generateUniqueDisplayId } = require("../common");

/** `#TB123456` — see `helpers/common/generateUniqueDisplayId.js`. */
exports.generateUniqueBrandId = async () =>
  generateUniqueDisplayId(Brand, { prefix: "#TB" });
