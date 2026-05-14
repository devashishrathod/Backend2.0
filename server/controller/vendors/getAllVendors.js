const Brand = require("../../model/Brand");

exports.getAllVendors = async (req, res) => {
  const id = req?.params?.id;
  try {
    if (id) {
      const result = await Brand.findById(id).populate("user");
      if (result) {
        return res
          .status(200)
          .json({ success: true, msg: "Vendor details", result });
      }
      return res.status(404).json({ msg: "Vendor not found", success: false });
    }
    const result = await Brand.find().sort({ createdAt: -1 }).populate("user");
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Vendor details", result });
    }
    return res.status(404).json({ msg: "Vendor not found", success: false });
  } catch (error) {
    console.log("error on getAllVendors: ", error);
    return res
      .status(500)
      .json({ error: error, success: false, msg: error.message });
  }
};
