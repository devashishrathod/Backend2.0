const levenshtein = require("fast-levenshtein");

function normalizeBusinessName(name = "") {
  return name
    .toUpperCase()
    .replace(/\bPRIVATE LIMITED\b/g, "")
    .replace(/\bPVT LTD\b/g, "")
    .replace(/\bPVT\b/g, "")
    .replace(/\bLIMITED\b/g, "")
    .replace(/\bLLP\b/g, "")
    .replace(/\bENTERPRISES\b/g, "")
    .replace(/\bENTERPRISE\b/g, "")
    .replace(/\bTRADERS\b/g, "")
    .replace(/\bTRADER\b/g, "")
    .replace(/\bCOMPANY\b/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function calculateSimilarity(a, b) {
  const first = normalizeBusinessName(a);
  const second = normalizeBusinessName(b);
  if (!first || !second) return 0;
  const distance = levenshtein.get(first, second);
  const maxLength = Math.max(first.length, second.length);
  return Math.round(((maxLength - distance) / maxLength) * 100);
}

module.exports = { normalizeBusinessName, calculateSimilarity };
