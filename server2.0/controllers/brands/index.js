const { addOrUpdateBasicDetails } = require("./addOrUpdateBasicDetails");
const { addPanDetails } = require("./addPanDetails");
const { addGstDetails } = require("./addGstDetails");
const { addBankDetails } = require("./addBankDetails");
const { verifyBrand } = require("./verifyBrand");
const { acceptPartnershipDeed } = require("./acceptPartnershipDeed");

module.exports = {
  addOrUpdateBasicDetails,
  addPanDetails,
  addGstDetails,
  addBankDetails,
  verifyBrand,
  acceptPartnershipDeed,
};
