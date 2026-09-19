const Banner = require("../../models/Banner");
const {
  BANNER_ACTIVE_LIMIT,
  BANNER_REDIRECT_TYPE,
} = require("../../constants/banner");
const { toMediaResponse } = require("../../helpers/media");
const { MEDIA_KIND } = require("../../constants/storage");

/**
 * The home screen renders the media and the tap target, and nothing else.
 *
 * Titles, schedules, storage metadata and audit fields are admin concerns, so
 * none of them are sent: this is fetched on every cold start, and `storage`
 * would additionally hand a stranger the object key of every asset.
 *
 * ### ⚠️ The existing keys did not move, and that was the point
 *
 * `type` and `url` read exactly as they did when the document carried a `type`
 * field and three media subdocuments. `type` is now `media.kind` and `url` is
 * `toMediaResponse(media)` — same values, same names, so the app was never part
 * of this migration.
 *
 * `thumbnail` is the one addition, and it is additive: a client that does not
 * know the key ignores it and keeps working exactly as before.
 *
 * The upper-casing that used to sit here is gone with the field it defended: the
 * enum's case changed after rows existed, mongoose does not run setters when
 * hydrating, and a legacy `"image"` would then miss the lookup table entirely.
 * `media.kind` is written once from the verified mime type and has never had a
 * lowercase spelling.
 */
const toCustomerShape = (banner) => {
  const url = toMediaResponse(banner.media);

  return {
    redirect: {
      type: banner.redirect?.type || BANNER_REDIRECT_TYPE.NONE,
      targetId: banner.redirect?.targetId ?? null,
      url: banner.redirect?.url ?? null,
    },
    _id: banner._id,
    type: banner.media?.kind ?? null,
    url,
    /**
     * 🔴 The frame to paint before anything plays.
     *
     * A video banner's poster is **mandatory** at upload, and for a while it was
     * stored and then never sent — which made the whole requirement pointless:
     * the app still had a blank rectangle until the `.mp4` had buffered enough
     * to show a frame.
     *
     * ⚠️ Always present, and never null for a banner that renders. On a still
     * or a GIF it is the media's own URL rather than `null`, so a client can
     * write `<img src={thumbnail}>` once instead of branching on `type` to work
     * out which field holds a paintable image. That is the same contract
     * showcase media has always had.
     */
    thumbnail:
      banner.media?.kind === MEDIA_KIND.VIDEO
        ? (banner.media?.poster?.url ?? null)
        : url,
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

/**
 * Exported for the tests only.
 *
 * ⚠️ This is the one piece of the migration the app can see, and the assertions
 * that matter — the key set, and a video answering its poster rather than its
 * `.mp4` — need no database to make. Leaving it reachable only through a live
 * query would have put the customer contract's proof in the money suite, which
 * runs against real Atlas and takes an hour, so in practice it would be checked
 * rarely.
 */
exports.toCustomerShape = toCustomerShape;
