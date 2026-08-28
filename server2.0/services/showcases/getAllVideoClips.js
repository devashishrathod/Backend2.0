const ShowcaseSection = require("../../models/ShowcaseSection");
const { assertPublicBrand } = require("../../helpers/brands");
const {
  customerSectionMatch,
  sortedClipMedias,
  customerMediaMap,
} = require("../../helpers/showcases");
const { throwError } = require("../../utils");

/**
 * The customer's reels feed for one brand — a flat, paginated list of videos
 * pulled out of every visible section.
 *
 * Eligibility is a **double opt-in**, and every part of it matters:
 *
 *   section: isActive · isVisible · !isDeleted · isShowVideosInClips
 *   media:   type === VIDEO · isActive · !isDeleted · isShowInVideoClips
 *
 * The `type === VIDEO` test is what makes the media flag safe: it is a
 * video-only switch, and a photo carrying a stale `true` from before that rule
 * existed can never reach this feed.
 *
 * The filter runs on the array before `$unwind` now, so a section with no
 * eligible video is dropped whole instead of being unwound and discarded row by
 * row.
 */
exports.getAllVideoClips = async (query) => {
  const brandObjectId = await assertPublicBrand(query.brandId);

  const page = query.page || 1;
  const limit = query.limit || 10;
  const skip = (page - 1) * limit;

  const pipeline = [
    {
      $match: {
        ...customerSectionMatch(brandObjectId),
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
              // A video always has a poster frame from Cloudinary, but if one
              // is ever missing the section cover keeps the player from opening
              // on a blank frame.
              video: {
                $mergeObjects: [
                  "$clips",
                  { thumbnail: { $ifNull: ["$clips.thumbnail", "$coverImage"] } },
                ],
              },
            },
          },
        ],
      },
    },
  ];

  const [result] = await ShowcaseSection.aggregate(pipeline);
  const total = result?.totalCount?.[0]?.count || 0;
  if (total <= 0) throwError(404, "No video clips found for this brand");

  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
    data: result?.data || [],
  };
};
