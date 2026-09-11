const express = require("express");
const router = express.Router();

const {
  validateSchema,
  isVendorOrAdmin,
  requireShowcaseEnabled,
} = require("../middlewares");
const {
  create,
  get,
  getAll,
  update,
  getBrandShowcase,
  getVideoClips,
  deleteSection,
  reorderSections,
  addMedia,
  updateMedia,
  replaceMedia,
  deleteMedia,
  reorderMedia,
} = require("../controllers/showcases");
const {
  validateCreateSection,
  validateGetSection,
  validateGetAllSections,
  validateUpdateSection,
  validateGetBrandShowcase,
  validateDeleteSection,
  validateReorderSections,
  validateAddMedia,
  validateUpdateMedia,
  validateReplaceMedia,
  validateDeleteMedia,
  validateGetVideoClips,
  validateReorderMedias,
} = require("../validator/showcase");

// ---------------------------------------------------------------------------
// A brand's photo/video gallery.
//
// The whole file used to run on a bare `verifyJwtToken`, and the services took
// a `userId` they never checked — so any signed-in caller could edit, reorder
// or delete any brand's gallery from its id alone. Ownership is now resolved
// per request inside the services (`resolveSectionForActor` for anything
// addressed by `sectionId`, `resolveActorBrand` where a `brandId` is named),
// which pins a vendor to their own brand and lets an admin act on any.
//
// Two audiences, two different views of the same documents:
//
//   Managed (below, all behind `isVendorOrAdmin`) — everything that is not
//   soft-deleted, hidden and switched-off content included, because that is
//   what the vendor needs in order to switch it back on.
//
//   Customer (bottom of the file, public like `/brands/customer/*`) — only
//   what the vendor has published: `isVisible` sections, `isActive` media,
//   and for the clips feed the double opt-in on top of that. Storage
//   internals and the vendor's own toggles never leave the server.
// ---------------------------------------------------------------------------

// ── Sections ───────────────────────────────────────────────────────────────
router.post(
  "/section/add",
  isVendorOrAdmin,
  requireShowcaseEnabled,
  validateSchema(validateCreateSection),
  create,
);
router.get(
  "/section/get/:sectionId",
  isVendorOrAdmin,
  validateSchema(validateGetSection),
  get,
);
router.get(
  "/section/get-all",
  isVendorOrAdmin,
  validateSchema(validateGetAllSections),
  getAll,
);
router.put(
  "/section/update/:sectionId",
  isVendorOrAdmin,
  requireShowcaseEnabled,
  validateSchema(validateUpdateSection),
  update,
);
router.put(
  "/section/:brandId/reorder",
  isVendorOrAdmin,
  requireShowcaseEnabled,
  validateSchema(validateReorderSections),
  reorderSections,
);
router.delete(
  "/section/delete/:sectionId",
  isVendorOrAdmin,
  requireShowcaseEnabled,
  validateSchema(validateDeleteSection),
  deleteSection,
);

// ── Media ──────────────────────────────────────────────────────────────────
router.post(
  "/section/:sectionId/add-media",
  isVendorOrAdmin,
  requireShowcaseEnabled,
  validateSchema(validateAddMedia),
  addMedia,
);
router.patch(
  "/section/:sectionId/media/update/:mediaId",
  isVendorOrAdmin,
  requireShowcaseEnabled,
  validateSchema(validateUpdateMedia),
  updateMedia,
);
router.put(
  "/section/:sectionId/media/replace/:mediaId",
  isVendorOrAdmin,
  requireShowcaseEnabled,
  validateSchema(validateReplaceMedia),
  replaceMedia,
);
router.put(
  "/section/:sectionId/media/reorder",
  isVendorOrAdmin,
  requireShowcaseEnabled,
  validateSchema(validateReorderMedias),
  reorderMedia,
);
router.delete(
  "/section/:sectionId/media/delete/:mediaId",
  isVendorOrAdmin,
  requireShowcaseEnabled,
  validateSchema(validateDeleteMedia),
  deleteMedia,
);

// ── Customer-facing reads ──────────────────────────────────────────────────
// Public, matching `/brands/customer/*`: the gallery is part of a brand's
// public profile, and a customer browsing brands may not be signed in yet.
//
// The full gallery — visible sections only, media in display order. A media
// opted out of the clips feed still belongs to its album, so
// `isShowInVideoClips` is deliberately not a filter here.
router.get(
  "/get-brand-showcase/:brandId",
  validateSchema(validateGetBrandShowcase),
  getBrandShowcase,
);
// The reels feed. `/:brandId` is a wildcard first segment, so this route has to
// stay below every literal path in this file — `/section/...` and
// `/get-brand-showcase/...` would otherwise be read as brand ids.
router.get(
  "/:brandId/video-clips",
  validateSchema(validateGetVideoClips),
  getVideoClips,
);

module.exports = router;
