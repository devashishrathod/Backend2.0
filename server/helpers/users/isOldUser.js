const { getUserByWhatsapp } = require("../../service/userServices");

exports.isOldUser = async (phone, currentUserId) => {
  const reused = await getUserByWhatsapp(phone);
  if (!reused) return false;
  return reused._id.toString() !== currentUserId.toString();
};
