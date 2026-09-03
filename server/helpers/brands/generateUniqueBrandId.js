const Brand = require("../../models/Brand");

exports.generateUniqueBrandId = async () => {
  const prefix = "#TB";
  while (true) {
    const randomNumber = Math.floor(10000 + Math.random() * 90000);
    const uniqueId = `${prefix}${randomNumber}`;
    const existingBrand = await Brand.findOne({ uniqueId });
    if (!existingBrand) return uniqueId;
  }
};
