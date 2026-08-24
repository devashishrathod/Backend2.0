const express = require("express");
const router = express.Router();

const { verifyJwtToken, validateSchema } = require("../middlewares");
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

router.use(verifyJwtToken);

router.post("/section/add", validateSchema(validateCreateSection), create);
router.get("/section/get/:sectionId", validateSchema(validateGetSection), get);
router.get("/section/get-all", validateSchema(validateGetAllSections), getAll);
router.put(
  "/section/update/:sectionId",
  validateSchema(validateUpdateSection),
  update,
);
router.get(
  "/get-brand-showcase/:brandId",
  validateSchema(validateGetBrandShowcase),
  getBrandShowcase,
);
router.get(
  "/:brandId/video-clips",
  validateSchema(validateGetVideoClips),
  getVideoClips,
);
router.put(
  "/section/:brandId/reorder",
  validateSchema(validateReorderSections),
  reorderSections,
);
router.delete(
  "/section/delete/:sectionId",
  validateSchema(validateDeleteSection),
  deleteSection,
);
// Media
router.post(
  "/section/:sectionId/add-media",
  validateSchema(validateAddMedia),
  addMedia,
);
router.patch(
  "/section/:sectionId/media/update/:mediaId",
  validateSchema(validateUpdateMedia),
  updateMedia,
);
router.put(
  "/section/:sectionId/media/replace/:mediaId",
  validateSchema(validateReplaceMedia),
  replaceMedia,
);
router.put(
  "/section/:sectionId/media/reorder",
  validateSchema(validateReorderMedias),
  reorderMedia,
);
router.delete(
  "/section/:sectionId/media/delete/:mediaId",
  validateSchema(validateDeleteMedia),
  deleteMedia,
);

module.exports = router;
