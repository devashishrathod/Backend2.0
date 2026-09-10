const Banner = require("../../models/Banner");
const { throwError } = require("../../utils");
const { BANNER_ACTIVE_LIMIT } = require("../../constants/banner");

// Stand-ins for "no lower bound" and "no upper bound". Only a legacy document
// saved before the validator required both dates can reach them; the service
// refuses a half-open range now. They keep this helper total either way, since
// an `undefined` bound would otherwise become an Invalid Date and make every
// comparison silently false.
const OPEN_START = new Date("1970-01-01T00:00:00.000Z");
const OPEN_END = new Date("2999-12-31T23:59:59.999Z");

/**
 * The most banners live at any single instant inside the window.
 *
 * ⚠️ Not the same as counting the banners that overlap the window, which is
 * what a `countDocuments` here would give. Five banners running through January
 * and five more through February all overlap a Jan–Feb window, but only five
 * are ever on screen together — counting overlaps would refuse a perfectly
 * legal eleventh banner and leave the admin no way to see why.
 *
 * A sweep line over the boundaries answers the question that is actually being
 * asked, and hands back the moment it peaked so the refusal can name it.
 */
const peakConcurrency = (ranges, windowStart, windowEnd) => {
  const events = [];
  for (const { start, end } of ranges) {
    const from = start > windowStart ? start : windowStart;
    const to = end < windowEnd ? end : windowEnd;
    if (from > to) continue;
    events.push({ at: from.getTime(), delta: 1 });
    events.push({ at: to.getTime(), delta: -1 });
  }

  // Both bounds are inclusive in the customer query, so a banner ending exactly
  // when another starts is live at that instant and both must be counted. Every
  // +1 at a timestamp is therefore applied before any -1 at the same timestamp.
  events.sort((a, b) => a.at - b.at || b.delta - a.delta);

  let live = 0;
  let peak = 0;
  let peakAt = null;
  for (const event of events) {
    live += event.delta;
    if (live > peak) {
      peak = live;
      peakAt = new Date(event.at);
    }
  }

  return { peak, peakAt };
};

/**
 * Refuses a create or an activation that would put more than
 * `BANNER_ACTIVE_LIMIT` banners on the home screen at once.
 *
 * The two pools are counted separately because they never compete for a slot at
 * write time: scheduled banners take the slots first and evergreen ones fill
 * what is left, so an evergreen banner cannot push a scheduled one off the
 * screen. Sharing one budget would block a campaign for February purely because
 * ten evergreen banners exist, which the reader would never see together.
 */
exports.assertActiveBannerCapacity = async ({
  isActive,
  startDate,
  endDate,
  excludeId,
} = {}) => {
  if (isActive === false) return;

  const baseMatch = { isActive: true, isDeleted: false };
  if (excludeId) baseMatch._id = { $ne: excludeId };

  // Evergreen pool — no dates at all, so there is no window to sweep and every
  // one of them is live the whole time.
  if (!startDate && !endDate) {
    const active = await Banner.countDocuments({
      ...baseMatch,
      startDate: null,
      endDate: null,
    });
    if (active >= BANNER_ACTIVE_LIMIT) {
      throwError(
        409,
        `Only ${BANNER_ACTIVE_LIMIT} active banners without a date range are allowed. Deactivate one first.`,
      );
    }
    return;
  }

  const windowStart = startDate ? new Date(startDate) : OPEN_START;
  const windowEnd = endDate ? new Date(endDate) : OPEN_END;

  const overlapping = await Banner.find({
    ...baseMatch,
    startDate: { $ne: null, $lte: windowEnd },
    endDate: { $ne: null, $gte: windowStart },
  })
    .select("startDate endDate")
    .lean();

  const { peak, peakAt } = peakConcurrency(
    overlapping.map((banner) => ({
      start: banner.startDate,
      end: banner.endDate,
    })),
    windowStart,
    windowEnd,
  );

  // The banner being written spans the whole window, so it is live at the peak
  // too — which is why the limit is reached at `peak >= LIMIT`, not past it.
  if (peak >= BANNER_ACTIVE_LIMIT) {
    throwError(
      409,
      `Only ${BANNER_ACTIVE_LIMIT} banners can be active at once, and ${peak} already are on ${peakAt.toISOString()}. Shift this banner's dates or deactivate one of those.`,
    );
  }
};
