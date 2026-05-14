const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const { verifyToken, checkRole } = require("../middleware");
const {
  createFeedback,
  getAllFeedbacks,
  likeOrDislikeFeedback,
  replyToFeedback,
  deleteFeedback,
  deleteFeedbackReply,
} = require("../controller/feedbacks");

router.post(
  "/create-review/:brandId",
  verifyToken,
  checkRole(ROLES.USER),
  createFeedback
);
router.get("/getAll/reviews", verifyToken, getAllFeedbacks);
router.put("/:feedbackId/toggle-like", verifyToken, likeOrDislikeFeedback);
router.post(
  "/:feedbackId/reply",
  verifyToken,
  checkRole(ROLES.VENDOR),
  replyToFeedback
);
router.delete(
  "/delete/:feedbackId",
  verifyToken,
  checkRole(ROLES.ADMIN, ROLES.VENDOR, ROLES.USER),
  deleteFeedback
);
router.delete(
  "/reply/:feedbackReplyId/delete",
  verifyToken,
  checkRole(ROLES.ADMIN, ROLES.VENDOR, ROLES.USER),
  deleteFeedbackReply
);

module.exports = router;
