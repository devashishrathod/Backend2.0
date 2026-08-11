const SubBrand = require("../../models/SubBrand");

exports.generateUniqueSubBrandId = async () => {
  const prefix = "#TS";
  while (true) {
    const randomNumber = Math.floor(10000 + Math.random() * 90000);
    const uniqueId = `${prefix}${randomNumber}`;
    const existing = await SubBrand.findOne({ uniqueId });
    if (!existing) return uniqueId;
  }
};
