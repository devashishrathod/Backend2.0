const Image = require("../../model/Image");
const { createItem } = require("../../db/dbServices");

exports.createImage = async (payload) => {
  return await createItem(Image, payload);
};
