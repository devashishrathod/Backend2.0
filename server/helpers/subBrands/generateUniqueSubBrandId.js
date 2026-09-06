const SubBrand = require("../../models/SubBrand");
const { generateUniqueDisplayId } = require("../common");

/** `#TS123456` — see `helpers/common/generateUniqueDisplayId.js`. */
exports.generateUniqueSubBrandId = async () =>
  generateUniqueDisplayId(SubBrand, { prefix: "#TS" });
