const { createTodayOffer } = require("../../service/todayOfferServices");
const { sendSuccess, sendError } = require("../../utils");

exports.addTodayOffer = async (req, res) => {
  try {
    const todayOffer = await createTodayOffer(req.body);
    return sendSuccess(res, 201, "Today offer created", todayOffer);
  } catch (err) {
    console.log("error on creating today offer", err);
    return sendError(res, 500, err.message);
  }
};
