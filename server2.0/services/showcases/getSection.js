const { SHOWCASE_MEDIA_TYPE } = require("../../constants/showcase");
const {
  resolveSectionForActor,
  formatManagedMedia,
} = require("../../helpers/showcases");

/** Case-insensitive substring test that tolerates a missing field. */
const matchesKeyword = (value, keyword) =>
  (value || "").toLowerCase().includes(keyword);

/**
 * One section with its media, for the vendor or admin who owns it.
 *
 * Two things changed here.
 *
 * Ownership: reading another brand's section metadata is a leak too, so the
 * same `resolveSectionForActor` gate the write paths use runs first. It also
 * *returns* the document now — this service used to prove ownership with one
 * query and then run a second aggregation over the very same section.
 *
 * Visibility: the media list used to drop anything with `isActive: false`, so a
 * vendor who switched a photo off could no longer see it, let alone switch it
 * back on. The managed view now excludes only soft-deleted media, and `isActive`
 * becomes an optional filter instead of a silent default.
 *
 * The array is bounded by `Setting.vendor.showcase.maxItemsPerSection` (15 by
 * default), so filtering, sorting and paging it in JS is cheaper than a second
 * round trip to Mongo.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 */
exports.getSection = async (actor, query) => {
  const { sectionId, type, search, isActive } = query;
  const page = query.page || 1;
  const limit = query.limit || 10;
  const skip = (page - 1) * limit;

  const section = await resolveSectionForActor(actor, sectionId, {
    lean: true,
  });

  const managed = (section.medias || [])
    .filter((media) => !media.isDeleted)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  const keyword = search?.trim().toLowerCase();
  const filtered = managed.filter((media) => {
    if (type && media.type !== type) return false;
    if (isActive !== undefined && media.isActive !== isActive) return false;
    if (
      keyword &&
      !matchesKeyword(media.title, keyword) &&
      !matchesKeyword(media.altText, keyword)
    ) {
      return false;
    }
    return true;
  });

  const data = filtered.slice(skip, skip + limit).map(formatManagedMedia);

  return {
    _id: section._id,
    brandId: section.brandId,
    title: section.title,
    slug: section.slug,
    description: section.description,
    coverImage: section.coverImage,
    coverImageMode: section.coverImageMode,
    sectionType: section.sectionType,
    sortOrder: section.sortOrder,
    isActive: section.isActive,
    isVisible: section.isVisible,
    isShowVideosInClips: section.isShowVideosInClips,
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
    // Whole-album counts, as the vendor docs describe — unaffected by the
    // `type` / `search` / `isActive` filters, which only narrow the page below.
    mediaCount: managed.length,
    photoCount: managed.filter((m) => m.type === SHOWCASE_MEDIA_TYPE.PHOTO)
      .length,
    videoCount: managed.filter((m) => m.type === SHOWCASE_MEDIA_TYPE.VIDEO)
      .length,
    inactiveMediaCount: managed.filter((m) => !m.isActive).length,
    media: {
      page,
      limit,
      total: filtered.length,
      totalPages: Math.ceil(filtered.length / limit) || 1,
      data,
    },
  };
};
