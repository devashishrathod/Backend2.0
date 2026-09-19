const { toMediaResponse } = require("../media");

/**
 * What an admin sees of a banner.
 *
 * ### 🔴 Why the whole document is not just returned any more
 *
 * It used to be. `getBanner` returned the mongoose document and `getAllBanners`
 * returned raw aggregation output, so whatever the schema held went out — which
 * meant `image.storage.publicId` and, once S3 landed, `bucket` and `key`. That
 * is the same shape of mistake the voucher detail and the ticker feed were
 * caught with: nobody chose to send it, the document simply had it.
 *
 * This is a whitelist. A column added to `bannerSchema` tomorrow does not reach
 * the panel until somebody writes it down here.
 *
 * ### ⚠️ There is no `type` key any more
 *
 * It was a second copy of `media.kind` that could disagree with the bytes it
 * described. The kind is on the media, where the file is.
 */
exports.toAdminBannerShape = (banner) => {
  if (!banner) return null;

  const plain = banner.toObject ? banner.toObject() : banner;

  return {
    _id: plain._id,
    title: plain.title,
    description: plain.description ?? null,
    media: toMediaResponse(plain.media, { forAdmin: true }),
    redirect: {
      type: plain.redirect?.type ?? null,
      targetId: plain.redirect?.targetId ?? null,
      url: plain.redirect?.url ?? null,
    },
    startDate: plain.startDate ?? null,
    endDate: plain.endDate ?? null,
    isActive: plain.isActive,
    createdBy: plain.createdBy ?? null,
    updatedBy: plain.updatedBy ?? null,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
};

exports.toAdminBannerListShape = (rows = []) =>
  (rows || []).map(exports.toAdminBannerShape);
