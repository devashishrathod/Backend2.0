const { normalizeBusinessName, calculateSimilarity } = require("./nameMatcher");
const { normalizeBusinessEntity } = require("./normalizeBusinessEntity");

module.exports = {
  calculateSimilarity,
  normalizeBusinessName,
  normalizeBusinessEntity,
};
