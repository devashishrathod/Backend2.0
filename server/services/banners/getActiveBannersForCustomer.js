const Banner = require("../../models/Banner");
const {
  BANNER_ACTIVE_LIMIT,
  BANNER_REDIRECT_TYPE,
} = require("../../constants/banner");
const { toMediaResponse } = require("../../helpers/media");

/**
 * The home screen renders the media and the tap target, and nothing else.
 *
 * Titles, schedules, storage metadata and audit fields are admin concerns, so
 * none of them are sent: this is fetched on every cold start, and `storage`
 * would additionally hand a stranger the object key of every asset.
 *
 * ### ⚠️ The keys here did not move, and that was the point
 *
 * `type` and `url` read exactly as they did when the document carried a `type`
 * field and three media subdocuments. `type` is now `media.kind` and `url` is
 * `toMediaResponse(media)` — same values, same names, so the app was never part
 * of this migration.
 *
 * The upper-casing that used to sit here is gone with the field it defended: the
 * enum's case changed after rows existed, mongoose does not run setters when
 * hydrating, and a legacy `"image"` would then miss the lookup table entirely.
 * `media.kind` is written once from the verified mime type and has never had a
 * lowercase spelling.
 */
const toCustomerShape = (banner) => ({
  redirect: {
    type: banner.redirect?.type || BANNER_REDIRECT_TYPE.NONE,
    targetId: banner.redirect?.targetId ?? null,
    url: banner.redirect?.url ?? null,
  },
  _id: banner._id,
  type: banner.media?.kind ?? null,
  url: toMediaResponse(banner.media),
});

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

/**
 * Exported for the tests only.
 *
 * ⚠️ This is the one piece of the migration the app can see, and the assertion
 * that matters — four keys, same names, same values — needs no database to make.
 * Leaving it reachable only through a live query would have put the customer
 * contract's proof in the money suite, which runs against real Atlas and takes
 * an hour, so in practice it would be checked rarely.
 */
exports.toCustomerShape = toCustomerShape;
