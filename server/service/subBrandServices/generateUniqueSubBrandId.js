const SubBrand = require("../../model/SubBrand");

exports.generateUniqueSubBrandId = async () => {
  const prefix = "#BN";
  while (true) {
    const randomNumber = Math.floor(10000 + Math.random() * 90000);
    const uniqueId = `${prefix}${randomNumber}`;
    const existingSubBrand = await SubBrand.findOne({ uniqueId });
    if (!existingSubBrand) return uniqueId;
  }
};
