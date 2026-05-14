const SuggestionAd = require("../../model/SuggestionAds");
const { findOne } = require("../../db/dbServices");

exports.generateUniqueSuggestionId = async () => {
  const prefix = "#S";
  while (true) {
    const randomNumber = Math.floor(100000 + Math.random() * 900000);
    const uniqueId = `${prefix}${randomNumber}`;
    const existingSuggestion = await findOne(SuggestionAd, { uniqueId });
    if (!existingSuggestion) return uniqueId;
  }
};
