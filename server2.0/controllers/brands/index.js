const { addOrUpdateBasicDetails } = require("./addOrUpdateBasicDetails");
const { addPanDetails } = require("./addPanDetails");
const { addGstDetails } = require("./addGstDetails");
const { addBankDetails } = require("./addBankDetails");
const { verifyBrand } = require("./verifyBrand");
const { acceptPartnershipDeed } = require("./acceptPartnershipDeed");
const { get } = require("./get");
const { update } = require("./update");

module.exports = {
  addOrUpdateBasicDetails,
  addPanDetails,
  addGstDetails,
  addBankDetails,
  verifyBrand,
  acceptPartnershipDeed,
  get,
  update,
};
