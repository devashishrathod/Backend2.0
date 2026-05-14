const Brand = require("../../model/Brand");
const { createItem } = require("../../db/dbServices");

exports.createBrand = async (payload) => {
  return await createItem(Brand, payload);
};
