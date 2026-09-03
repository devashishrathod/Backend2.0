const express = require("express");
const router = express.Router();

const { verifyJwtToken, validateSchema, isAdmin } = require("../middlewares");
const { get, update } = require("../controllers/settings");
const { validateUpdateSetting } = require("../validator/settings");

router.use(verifyJwtToken);

router.get("/get", isAdmin, get);
router.put("/update", isAdmin, validateSchema(validateUpdateSetting), update);

module.exports = router;
