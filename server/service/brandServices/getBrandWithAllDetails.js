const Brand = require("../../model/Brand");

exports.getBrandWithAllDetails = async (id) => {
  return await Brand.findOne({ _id: id, isDeleted: false }).populate(
    "user category subCategory gst location workHours bankAccount transaction subscribed"
  );
};
