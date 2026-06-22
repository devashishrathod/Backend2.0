const GST = require("../../models/GST");
const cgpeyClient = require("../../configs/cgpey");
const { fetchAPI } = require("../../helpers/cgpeyAPIs");
const { throwError } = require("../../utils");

exports.verifyGstAndFetchDetails = async (payload) => {
  let { gstNumber } = payload;
  gstNumber = gstNumber?.toUpperCase()?.trim();
  const existing = await GST.findOne({ gstNumber, isDeleted: false });
  if (existing) throwError(400, "GST detials already in use.");
  return await fetchAPI(process.env.CGPEY_GST_ENDPOINT, payload);
};
