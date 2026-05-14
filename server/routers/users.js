const express = require("express");
const router = express.Router();
const profileRouter = express.Router();

const { verifyToken } = require("../middleware/authValidation");
const { isFirst } = require("../middleware");

const { userProfile } = require("../controller/user");
const { userProfileComplete } = require("../controller/users/updateUser");

const {
  changeLoginMobileNumber,
  verifyChangeMobile,
  getAllUsers,
} = require("../controller/users");

router.put("/changeMobile", verifyToken, changeLoginMobileNumber);
router.put("/verifyChangeMobile", verifyToken, verifyChangeMobile);

/* ================= Profile route with "/profile/" ================== */
router.get("/userProfile", verifyToken, userProfile);
//profileRouter.get("/userProfile", verifyToken, userProfile);
router.put("/userProfile/update", verifyToken, userProfileComplete);
//profileRouter.put("/userProfile/update", verifyToken, userProfileComplete);
router.put("/userProfileComplete", [verifyToken, isFirst], userProfileComplete);
/*profileRouter.put(
  "/userProfileComplete",
  [verifyToken, isFirst],
  userProfileComplete
);*/
router.get("/getAll", verifyToken, getAllUsers);

module.exports = {
  router,
  //routePrefix: "/user", // default
  extraRoutes: [{ path: "/profile", router: profileRouter }],
};
