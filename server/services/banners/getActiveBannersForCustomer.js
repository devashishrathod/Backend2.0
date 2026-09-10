const Banner = require("../../models/Banner");
const {
  BANNER_ACTIVE_LIMIT,
  BANNER_MEDIA_FIELD,
  BANNER_REDIRECT_TYPE,
} = require("../../constants/banner");

/**
 * The home screen renders the media and the tap target, and nothing else.
 *
 * Titles, schedules, storage metadata and audit fields are admin concerns, so
 * none of them are sent: this is fetched on every cold start, and `storage`
 * would additionally hand a stranger the Cloudinary public id of every asset.
 * The admin endpoints still return the whole document.
 *
 * ⚠️ `type` is upper-cased on the way out. The model normalizes on write, but
 * mongoose does not run setters when hydrating, so a document saved before
 * BANNER_TYPE became uppercase still reads back as `image` — and the media
 * field would then be looked up under a key that does not exist.
 */
const toCustomerShape = (banner) => {
  const type = String(banner.type || "").toUpperCase();
  return {
    redirect: {
      type: banner.redirect?.type || BANNER_REDIRECT_TYPE.NONE,
      targetId: banner.redirect?.targetId ?? null,
      url: banner.redirect?.url ?? null,
    },
    _id: banner._id,
    type,
    url: banner[BANNER_MEDIA_FIELD[type]]?.url ?? null,
  };
};

/**
 * Up to `BANNER_ACTIVE_LIMIT` banners for the customer home screen.
 *
 * Scheduled banners take the slots first, newest schedule leading — a campaign
 * someone deliberately dated for today is the thing they wanted seen. Evergreen
 * banners (no start or end date) then fill whatever is left, so the carousel is
 * never emptier than it has to be, and they disappear entirely once ten
 * scheduled banners are live.
 */
exports.getActiveBannersForCustomer = async () => {
  const now = new Date();
  const baseMatch = { isActive: true, isDeleted: false };

  const scheduled = await Banner.find({
    ...baseMatch,
    startDate: { $ne: null, $lte: now },
    endDate: { $ne: null, $gte: now },
  })
    .sort({ startDate: -1 })
    .limit(BANNER_ACTIVE_LIMIT)
    .lean();

  if (scheduled.length >= BANNER_ACTIVE_LIMIT) {
    return scheduled.map(toCustomerShape);
  }

  const fallback = await Banner.find({
    ...baseMatch,
    startDate: null,
    endDate: null,
  })
    .sort({ createdAt: -1 })
    .limit(BANNER_ACTIVE_LIMIT - scheduled.length)
    .lean();

  return [...scheduled, ...fallback].map(toCustomerShape);
};
