const SubBrand = require("../../model/SubBrand");
const { createItem } = require("../../db/dbServices");

exports.createSubBrand = async (payload) => {
  return await createItem(SubBrand, payload);
};
