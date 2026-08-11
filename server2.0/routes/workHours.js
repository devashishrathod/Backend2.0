const express = require("express");
const router = express.Router();

const { validateSchema, verifyJwtToken } = require("../middlewares");
const { upsert } = require("../controllers/workHours");
const { validateUpsertWorkHours } = require("../validator/workHours");

router.use(verifyJwtToken);

router.post("/upsert", validateSchema(validateUpsertWorkHours), upsert);

module.exports = router;
