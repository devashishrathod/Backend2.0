const { generateUniqueSubBrandId } = require("./generateUniqueSubBrandId");
const { generateSubBrandStoreId } = require("./generateSubBrandStoreId");
const { syncSubBrandLocAndGeo } = require("./syncSubBrandLocAndGeo");
const {
  reserveOutletSlot,
  bucketFor,
  bucketNoun,
} = require("./reserveOutletSlot");
const { releaseOutletSlot } = require("./releaseOutletSlot");
const { switchOutletType } = require("./switchOutletType");

module.exports = {
  generateUniqueSubBrandId,
  generateSubBrandStoreId,
  syncSubBrandLocAndGeo,
  reserveOutletSlot,
  releaseOutletSlot,
  switchOutletType,
  bucketFor,
  bucketNoun,
};
