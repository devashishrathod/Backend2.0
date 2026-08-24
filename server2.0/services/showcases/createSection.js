const ShowcaseSection = require("../../models/ShowcaseSection");
const { escapeRegex } = require("../../validator/common");
const { throwError } = require("../../utils");
const { SHOWCASE_SECTION_TYPE } = require("../../constants/showcase");
const { generateUniqueSlug } = require("../../helpers/showcases");
const {
  validateBrandVendor,
  reserveSlot,
  releaseSlot,
} = require("../../helpers/brands");
const { assertActiveSubscription } = require("../../helpers/subscribeds");
const { ENTITLEMENT_BUCKETS } = require("../../constants/subscription");

exports.createSection = async (userId, payload) => {
  const brand = await validateBrandVendor(userId);

  // A showcase section is a metered plan feature, same as an outlet. The
  // subscription gate runs first so a vendor with no live plan is told to
  // subscribe rather than getting a validation error about the section.
  await assertActiveSubscription(brand._id);

  payload.title = payload.title.toLowerCase().trim();
  const exists = await ShowcaseSection.exists({
    brandId: brand._id,
    isDeleted: false,
    title: {
      $regex: new RegExp(`^${escapeRegex(payload.title)}$`, "i"),
    },
  });
  if (exists) throwError(409, "Section title already exists.");

  const slug = await generateUniqueSlug(brand._id, payload.title);
  let sortOrder = payload.sortOrder;

  if (!sortOrder) {
    const last = await ShowcaseSection.findOne({
      brandId: brand._id,
      isDeleted: false,
    })
      .sort({ sortOrder: -1 })
      .select("sortOrder");
    sortOrder = last ? last.sortOrder + 1 : 1;
  }

  // Claimed as late as possible — after the duplicate-title and slug checks —
  // so a rejected request never consumes a slot. The claim itself is an atomic
  // conditional increment, so two concurrent creates cannot both take the last.
  await reserveSlot(brand._id, ENTITLEMENT_BUCKETS.SHOWCASE);

  try {
    return await ShowcaseSection.create({
      brandId: brand._id,
      title: payload.title,
      slug,
      description: payload.description?.trim(),
      sortOrder,
      sectionType: payload.sectionType || SHOWCASE_SECTION_TYPE.CUSTOM,
    });
  } catch (error) {
    // Give the slot back rather than letting a failed insert eat it.
    await releaseSlot(brand._id, ENTITLEMENT_BUCKETS.SHOWCASE);
    throw error;
  }
};
