const PAN = require("../../models/PAN");
const cgpeyClient = require("../../configs/cgpey");
const { fetchAPI } = require("../../helpers/cgpeyAPIs");
const { throwError } = require("../../utils");

exports.verifyPanAndFetchDetails = async (payload) => {
  let { pan } = payload;
  pan = pan?.toUpperCase()?.trim();
  const existing = await PAN.findOne({ pan, isDeleted: false });
  if (existing) throwError(400, "PAN details already in use.");
  return await fetchAPI(process.env.CGPEY_PAN_ENDPOINT, payload);
};
