const { getSetting } = require("./getSetting");
const { SHOWCASE_MEDIA_CONFIG } = require("../../constants/showcase");

// DB config (Setting.vendor.showcase) always wins; SHOWCASE_MEDIA_CONFIG only
// kicks in as a last-resort fallback if the singleton Setting doc somehow
// lacks a value. Field names are re-shaped to match what
// helpers/showcases/validateMedia.js already expects (maxItems/maxImages/...)
// so no caller needs to change how it reads the config object.
exports.getShowcaseConfig = async () => {
  const setting = await getSetting();
  const showcase = setting?.vendor?.showcase || {};
  return {
    maxSections: showcase.maxSections ?? 5,
    maxItems: showcase.maxItemsPerSection ?? SHOWCASE_MEDIA_CONFIG.maxItems,
    maxImages: showcase.maxImagesPerSection ?? SHOWCASE_MEDIA_CONFIG.maxImages,
    maxVideos: showcase.maxVideosPerSection ?? SHOWCASE_MEDIA_CONFIG.maxVideos,
    maxImageSizeMB:
      showcase.maxImageSizeMB ?? SHOWCASE_MEDIA_CONFIG.maxImageSizeMB,
    maxVideoSizeMB:
      showcase.maxVideoSizeMB ?? SHOWCASE_MEDIA_CONFIG.maxVideoSizeMB,
    allowedImages: showcase.allowedImages?.length
      ? showcase.allowedImages
      : SHOWCASE_MEDIA_CONFIG.allowedImages,
    allowedVideos: showcase.allowedVideos?.length
      ? showcase.allowedVideos
      : SHOWCASE_MEDIA_CONFIG.allowedVideos,
  };
};
