const { sendSuccess, sendError } = require("../../utils");
const {
  getSubBrandById,
  getAllSubBrands,
} = require("../../service/subBrandServices");

exports.getAllSubBrands = async (req, res) => {
  const subBrandId = req?.params?.subBrandId;
  try {
    if (subBrandId) {
      const findSubBrand = await getSubBrandById(subBrandId);
      if (!findSubBrand) {
        return sendError(res, 404, "No sub brand found.");
      }
      return sendSuccess(res, 200, "Sub brand fetched successfully", {
        subBrand: findSubBrand,
      });
    }
    const findAllSubBrands = await getAllSubBrands();
    if (!findAllSubBrands || findAllSubBrands.length === 0) {
      return sendError(res, 404, "No sub brand found.");
    }
    return sendSuccess(res, 200, "All sub brands fetched successfully", {
      allSubBrands: findAllSubBrands,
    });
  } catch (error) {
    console.log("error on getAllSubBrands: ", error);
    return sendError(res, 500, error.message);
  }
};
