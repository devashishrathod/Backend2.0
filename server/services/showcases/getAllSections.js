const mongoose = require("mongoose");
const ShowcaseSection = require("../../models/ShowcaseSection");
const { ROLES } = require("../../constants");
const { SHOWCASE_MEDIA_TYPE } = require("../../constants/showcase");
const { pagination, throwError } = require("../../utils");
const { escapeRegex } = require("../../validator/common");
const { resolveActorBrand } = require("../../helpers/brands");
const {
  managedMediaCondition,
  visibleMediaCondition,
  countMediaOfType,
  attachCustomerVisibility,
} = require("../../helpers/showcases");

/** Media the vendor manages — everything that has not been soft-deleted. */
const managedMedias = {
  $filter: {
    input: "$medias",
    as: "m",
    cond: managedMediaCondition("m"),
  },
};

/**
 * Media a customer would see — the narrower set, and the one the floor counts.
 *
 * ⚠️ Not the same as `managedMedias` above: a switched-off media is still
 * managed and is not visible. Counting the wrong one here would report a section
 * as live while the customer pipeline refuses to serve it.
 */
const visibleMediaCount = {
  $size: {
    $filter: {
      input: "$medias",
      as: "m",
      cond: visibleMediaCondition("m"),
    },
  },
};

/**
 * List showcase sections, scoped to what the caller may see.
 *
 * The brand filter used to be commented out, so a vendor asking for "my
 * sections" was handed every brand's sections on the platform.
 *
 * - VENDOR is pinned to their own brand. A `brandId` in the query is resolved
 *   through `resolveActorBrand`, which rejects anything that is not theirs, so
 *   the filter cannot be widened from the request.
 * - ADMIN stays global by design: omitting `brandId` lists across every brand,
 *   passing one narrows to it.
 *
 * Visibility: this is the **managed** view, so the only hard filter is
 * `isDeleted`. It used to default to `isActive: true, isVisible: true`, which
 * meant a section the vendor had just hidden disappeared from their own list —
 * leaving no way to find it and switch it back on. `isActive` / `isVisible` are
 * honoured only when the caller names them, as filters rather than defaults.
 *
 * @param {{ userId: string, role: string, brandId?: string }} actor
 */
exports.getAllSections = async (actor, query) => {
  const { page, limit, search, sortBy, order, isActive, isVisible, brandId } =
    query;

  const match = { isDeleted: false };
  if (isActive !== undefined) match.isActive = isActive;
  if (isVisible !== undefined) match.isVisible = isVisible;

  if (actor?.role === ROLES.VENDOR) {
    const brand = await resolveActorBrand(actor, brandId);
    match.brandId = new mongoose.Types.ObjectId(brand._id);
  } else if (actor?.role === ROLES.ADMIN) {
    if (brandId) match.brandId = new mongoose.Types.ObjectId(brandId);
  } else {
    throwError(403, "Forbidden");
  }

  const pipeline = [{ $match: match }];

  if (search?.trim()) {
    pipeline.push({
      $match: {
        title: {
          $regex: escapeRegex(search.trim()),
          $options: "i",
        },
      },
    });
  }

  // Counted once, then reused by all four counts below.
  pipeline.push({ $addFields: { managedMedias } });

  pipeline.push({
    $project: {
      brandId: 1,
      title: 1,
      slug: 1,
      description: 1,
      coverImage: 1,
      coverImageMode: 1,
      sectionType: 1,
      sortOrder: 1,
      isActive: 1,
      // The two customer-facing switches. The vendor panel renders them as
      // toggles and documents them, but this projection never returned them —
      // so the panel had no way to show their current state.
      isVisible: 1,
      isShowVideosInClips: 1,
      createdAt: 1,
      updatedAt: 1,
      // Counts cover every media the vendor manages, inactive ones included,
      // which is what the managed list is for. `inactiveMediaCount` surfaces
      // how many of them are currently switched off.
      mediaCount: { $size: "$managedMedias" },
      photoCount: countMediaOfType(
        "$managedMedias",
        SHOWCASE_MEDIA_TYPE.PHOTO,
      ),
      videoCount: countMediaOfType(
        "$managedMedias",
        SHOWCASE_MEDIA_TYPE.VIDEO,
      ),
      inactiveMediaCount: {
        $size: {
          $filter: {
            input: "$managedMedias",
            as: "m",
            cond: { $eq: ["$$m.isActive", false] },
          },
        },
      },
      /**
       * Carried out of the pipeline so `customerVisibility` can be built in JS
       * without re-reading the media array — which this projection has already
       * dropped by the time the rows come back (S-5).
       */
      visibleMediaCount,
    },
  });

  pipeline.push({
    $sort: {
      [sortBy]: order === "asc" ? 1 : -1,
      _id: 1,
    },
  });

  const result = await pagination(ShowcaseSection, pipeline, page, limit);

  /**
   * S-5 — one line per section saying whether a customer can see it, and why
   * not.
   *
   * ⚠️ After paging, so the settings cache is read once for the page rather than
   * once per section — and only the rows actually being returned are described.
   */
  await attachCustomerVisibility(result.data);
  return result;
};
