exports.generateUniqueId = async (Model, prefix = "#TD") => {
  while (true) {
    const randomNumber = Math.floor(100000 + Math.random() * 900000);
    const uniqueId = `${prefix}${randomNumber}`;
    const exists = await Model.findOne({ uniqueId });
    if (!exists) return uniqueId;
  }
};
