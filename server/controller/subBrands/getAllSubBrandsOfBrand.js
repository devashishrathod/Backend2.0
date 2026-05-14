const { sendSuccess, sendError } = require("../../utils");
const { getAllSubBrandsOfOneBrand } = require("../../service/subBrandServices");

exports.getAllSubBrandsOfBrand = async (req, res) => {
  try {
    const brandId = req?.params?.brandId;
    if (!brandId) {
      return sendError(res, 404, "No brand Id found.");
    }
    const findAllSubBrands = await getAllSubBrandsOfOneBrand(brandId);
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
