const Banner = require("../../models/Banner");
const { throwError, validateObjectId } = require("../../utils");
const { deleteAudioOrVideo, deleteImage } = require("../uploads");

exports.deleteBanner = async (id) => {
  validateObjectId(id, "Banner Id");
  const result = await Banner.findById(id);
  if (!result || result.isDeleted) throwError(404, "Banner not found");
  await deleteAudioOrVideo(result?.video);
  await deleteImage(result?.image);
  result.isDeleted = true;
  result.isActive = false;
  result.image = null;
  result.video = null;
  result.updatedAt = new Date();
  await result.save();
  return;
};
