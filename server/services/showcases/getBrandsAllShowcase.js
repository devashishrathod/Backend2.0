const ShowcaseSection = require("../../models/ShowcaseSection");
const { assertPublicBrand } = require("../../helpers/brands");
const {
  customerSectionMatch,
  sortedVisibleMedias,
  mediaCounts,
  customerMediaMap,
  applyDisplayPositions,
} = require("../../helpers/showcases");
const { getShowcaseConfig } = require("../../helpers/settings");

/**
 * Sections returned when the caller does not ask for a page.
 *
 * A plan caps a brand at a handful of sections, so in practice this returns
 * everything — but the endpoint used to have no bound at all, and an
 * unlimited-showcase brand could answer with the whole gallery in one payload.
 */
const DEFAULT_SECTION_LIMIT = 50;

/**
 * The customer's full showcase for one brand — every album, every media.
 *
 * Three rules decide what comes out, and only the first two were here before:
 *
 *   1. `isActive` / `isDeleted` — operational state.
 *   2. `isVisible` — the vendor's public switch. **This was missing**, so a
 *      section the vendor had hidden was still served here even though the
 *      brand profile (`getCustomerBrand`) filtered it correctly. Hiding a
 *      section only worked on one of the two screens that showed it.
 *   3. Media-level `isShowInVideoClips` is deliberately NOT applied. That flag
 *      only governs the reels feed; opting a video out of clips must not remove
 *      it from the album it belongs to.
 *
 * Sorting, counting and the field whitelist all happen inside the pipeline now.
 * They used to run in JS over the full documents, which meant Cloudinary public
 * ids and original filenames were pulled out of Mongo on every request just to
 * be deleted a moment later.
 */
exports.getBrandsAllShowcase = async (query) => {
  const brandObjectId = await assertPublicBrand(query.brandId);

  const page = query.page || 1;
  const limit = query.limit || DEFAULT_SECTION_LIMIT;
  const skip = (page - 1) * limit;

  // S-4: a section below the media floor does not reach a customer at all.
  const { minItems } = await getShowcaseConfig();

  const pipeline = [
    { $match: customerSectionMatch(brandObjectId, { minItems }) },
    /**
     * ⚠️ The **stored** order — which is what decides the sequence. The numbers
     * the customer is handed are assigned after paging, in
     * `applyDisplayPositions`, because a position only means anything once it is
     * known which sections survived the filter above.
     */
    { $sort: { sortOrder: 1, createdAt: 1 } },
    { $addFields: { visibleMedias: sortedVisibleMedias() } },
    {
      $project: {
        title: 1,
        description: 1,
        coverImage: 1,
        sectionType: 1,
        sortOrder: 1,
        ...mediaCounts("$visibleMedias"),
        medias: customerMediaMap("$visibleMedias"),
      },
    },
    {
      $facet: {
        sections: [{ $skip: skip }, { $limit: limit }],
        totalCount: [{ $count: "count" }],
      },
    },
  ];

  const [result] = await ShowcaseSection.aggregate(pipeline);
  const total = result?.totalCount?.[0]?.count || 0;

  // No 404 here, by design: a brand with no albums yet is a normal state for
  // the gallery screen, and the app renders an empty state for it. A brand that
  // does not exist or has been switched off is a 404 from `assertPublicBrand`.
  return {
    brandId: query.brandId,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
    /**
     * Positions continue across pages — page 2 starts at `skip + 1`, not at 1.
     * A section is the eleventh of this brand's gallery whether or not this
     * request happened to begin there.
     */
    sections: applyDisplayPositions(result?.sections || [], {
      startAt: skip + 1,
    }),
  };
};
