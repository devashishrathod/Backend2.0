const {
  normalizeQuery,
  searchRegex,
  searchPrefixRegex,
} = require("./searchTerm");
const { matchRankExpression } = require("./matchRank");
const { buildBrandSection } = require("./buildBrandSection");
const { buildVoucherSection } = require("./buildVoucherSection");
const { buildAreaSection } = require("./buildAreaSection");
const { recordSearchQuery } = require("./recordSearchQuery");
const {
  buildCategorySection,
  buildSubCategorySection,
} = require("./buildTaxonomySections");

module.exports = {
  normalizeQuery,
  searchRegex,
  searchPrefixRegex,
  matchRankExpression,
  buildBrandSection,
  buildVoucherSection,
  buildCategorySection,
  buildSubCategorySection,
  buildAreaSection,
  recordSearchQuery,
};
