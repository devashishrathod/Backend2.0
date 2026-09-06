const express = require("express");
const router = express.Router();

const { validateSchema } = require("../middlewares");
const { getConfig } = require("../controllers/appConfig");
const { validateGetAppConfig } = require("../validator/appConfig");

/**
 * ---------------------------------------------------------------------------
 * The one settings surface that needs no token.
 *
 * The app calls this on launch, before a login screen exists — so it cannot be
 * gated. `GET /settings/get` holds the same document behind `isAdmin`, which is
 * why force-update and the support number were previously impossible to change
 * without a new build.
 *
 * ⚠️ **Public, and it stays a whitelist.** `helpers/settings/getAppConfig.js`
 * names every field it returns. `Setting` also carries commission percentages,
 * reserve rates and settlement timing; a spread anywhere in that helper would
 * publish the platform's economics and would look entirely ordinary on the line
 * that did it.
 *
 * ⚠️ Deliberately **not** under `/settings`. That router is
 * `router.use(verifyJwtToken)` at the top, so a public route added there would
 * either be silently gated or force the blanket gate off for everything else.
 * ---------------------------------------------------------------------------
 */
router.get("/", validateSchema(validateGetAppConfig), getConfig);

/**
 * ⚠️ `{ router, routePrefix }`, not `exports.routePrefix` beside
 * `module.exports = router` — the second assignment replaces the exports object
 * and the prefix is lost silently, mounting this at `/appConfig`. That has
 * happened twice in this codebase already; see `routes/voucherClaims.js`.
 */
module.exports = { router, routePrefix: "/app-config" };
