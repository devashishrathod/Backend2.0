const ShowcaseSection = require("../../models/ShowcaseSection");
const { assertPublicBrand } = require("../../helpers/brands");
const {
  customerSectionMatch,
  sortedClipMedias,
  customerMediaMap,
} = require("../../helpers/showcases");
const { getShowcaseConfig } = require("../../helpers/settings");

/**
 * The customer's reels feed for one brand — a flat, paginated list of videos
 * pulled out of every visible section.
 *
 * Eligibility is a **double opt-in**, and every part of it matters:
 *
 *   section: isActive · isVisible · !isDeleted · isShowVideosInClips · enough media
 *   media:   type === VIDEO · isActive · !isDeleted · isShowInVideoClips
 *
 * The `type === VIDEO` test is what makes the media flag safe: it is a
 * video-only switch, and a photo carrying a stale `true` from before that rule
 * existed can never reach this feed.
 *
 * The filter runs on the array before `$unwind` now, so a section with no
 * eligible video is dropped whole instead of being unwound and discarded row by
 * row.
 *
 * ### 🆕 S-4 — a section too small to appear cannot leak videos here either
 *
 * The media floor applies to this feed as it does to the gallery. Without it a
 * section the customer cannot open would still put its videos in front of them,
 * and tapping one would lead to a section that does not exist for them — the
 * "hidden" would be true on one screen and false on another, which is the exact
 * shape of the `isVisible` bug this domain already shipped once.
 */
exports.getAllVideoClips = async (query) => {
  const brandObjectId = await assertPublicBrand(query.brandId);

  const page = query.page || 1;
  const limit = query.limit || 10;
  const skip = (page - 1) * limit;

  const { minItems } = await getShowcaseConfig();

  const pipeline = [
    {
      $match: {
        ...customerSectionMatch(brandObjectId, { minItems }),
        isShowVideosInClips: true,
      },
    },
    { $addFields: { clips: sortedClipMedias() } },
    { $match: { "clips.0": { $exists: true } } },
    {
      $project: {
        title: 1,
        coverImage: 1,
        sortOrder: 1,
        clips: customerMediaMap("$clips"),
      },
    },
    { $unwind: "$clips" },
    { $sort: { sortOrder: 1, "clips.sortOrder": 1, "clips.createdAt": -1 } },
    /**
     * 🆕 S-4 — the clip's own `sortOrder` leaves after it has done its job here.
     *
     * It is a **position within a section**, and this feed has taken the video
     * out of its section: the third clip of the feed can be the first of its
     * album, so the number the customer receives would contradict the order they
     * are scrolling. The feed's order is the order.
     *
     * ⚠️ Dropped after the sort, not before — the sort above is what uses it.
     *
     * That tiebreaker stays whether or not it is currently doing anything.
     * `$sort` is documented as **not stable**, so the order of two clips inside
     * one section has to be stated in the sort key rather than inherited from the
     * `$sortArray` further up and `$unwind` after it.
     *
     * Measured, and worth writing down because the measurement is the opposite
     * of what one might expect: removing the tiebreaker changes nothing at this
     * size — ten identical requests still come back in the same order. The
     * mutation run leaves that mutant alive for exactly this reason. So this is
     * a guard against a behaviour the engine is free to change and no test here
     * can provoke, not a fix for something currently observable.
     */
    { $unset: "clips.sortOrder" },
    {
      $facet: {
        totalCount: [{ $count: "count" }],
        data: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              sectionId: "$_id",
              sectionTitle: "$title",
              sectionCoverImage: "$coverImage",
              /**
               * 🔴 The section cover fallback is gone, and that is the fix.
               *
               * This used to be `$ifNull: ["$clips.thumbnail", "$coverImage"]`,
               * written on the belief that "a video always has a poster frame
               * from Cloudinary". It did not: `getOptimizedImageUrl(publicId)`
               * builds an `/image/upload/` path for an asset under
               * `/video/upload/`, so every stored poster was a 404 — and S3
               * produced none at all. The fallback then quietly served somebody
               * else's picture as this clip's frame, and because the section
               * cover is itself computed from the first media, a video-first
               * section showed the `.mp4` link there too.
               *
               * A poster is mandatory on a VIDEO now, and `customerMediaFields`
               * (already applied above) reads `thumbnail` straight from it — so
               * there is nothing left to merge or fall back to.
               */
              video: "$clips",
            },
          },
        ],
      },
    },
  ];

  const [result] = await ShowcaseSection.aggregate(pipeline);
  const total = result?.totalCount?.[0]?.count || 0;

  /**
   * 🆕 S-4 — an empty feed is an empty list, not a `404`.
   *
   * This used to raise "No video clips found for this brand", which the app had
   * to catch and translate into an empty state — and which now fires for a brand
   * whose only fault is that its sections are below the media floor. A 404 says
   * the *brand* is not there; `assertPublicBrand` above is what actually answers
   * that question, and it still does.
   *
   * The gallery endpoint has always answered this way for the same reason.
   */
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
    data: result?.data || [],
  };
};
