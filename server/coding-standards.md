# Coding Standards

Node.js + Express + Mongoose backend conventions for **Trydood 2.0** (`server/` — the folder was called `server2.0/` until the legacy backend was removed and this one took its name).
These rules are derived from the existing codebase — follow them so new code is indistinguishable from old.

---

## Stack

CommonJS (`"type": "commonjs"`) · Node.js · Express 5 · Mongoose 9 (MongoDB) · Joi 18 · JWT · bcrypt · Cloudinary · Razorpay · Nodemailer · PDFKit · Morgan

> **No TypeScript, no ESM.** Every file uses `require()` / `module.exports`.

---

## Layered Architecture

A request flows strictly in one direction. Never skip or reverse a layer.

```
routes/  →  middlewares/  →  controllers/  →  services/  →  models/
                                   ↓              ↓
                              utils/         helpers/ · database/
```

| Layer | Responsibility | Must NOT do |
|---|---|---|
| `routes/` | Path + middleware wiring only | Contain business logic |
| `middlewares/` | Auth, role gating, Joi validation, error handling | Query domain collections directly |
| `controllers/` | Read `req`, call one service, send response | Touch Mongoose models, build pipelines |
| `services/` | Business logic, aggregation pipelines, model access | Touch `req` / `res` |
| `helpers/` | Small reusable domain utilities (ID generation, validation) | Own HTTP concerns |
| `models/` | Mongoose schemas + field validators | Contain business rules |
| `utils/` | Framework-agnostic primitives (response, errors, pagination) | Import models or services |
| `validator/` | Joi schemas only | Perform DB lookups |

**Hard rule:** a controller never imports from `models/`. If you need data, add a service.

---

## File & Folder Conventions

### One function per file + barrel `index.js`

Both `controllers/` and `services/` use folder-per-domain, file-per-operation:

```
controllers/brands/
  addOrUpdateBasicDetails.js
  addPanDetails.js
  get.js
  update.js
  index.js            # barrel — re-exports every sibling

services/brands/
  addOrUpdateBasicDetails.js
  getBrand.js
  updateBrand.js
  index.js
```

Barrel file shape — named imports, named exports, no default export:

```js
const { getBrand } = require("./getBrand");
const { updateBrand } = require("./updateBrand");

module.exports = {
  getBrand,
  updateBrand,
};
```

**Always import from the barrel**, never from an internal path:

```js
// ✅
const { getBrand } = require("../../services/brands");
// ❌
const { getBrand } = require("../../services/brands/getBrand");
```

### Naming

| Thing | Convention | Example |
|---|---|---|
| Model file | PascalCase singular | `Brand.js`, `VoucherUsage.js` |
| Route file | camelCase plural | `brands.js`, `subCategories.js` |
| Controller / service file | camelCase verb | `getBrand.js`, `addPanDetails.js` |
| Validator file | camelCase plural | `brands.js`, `vouchers.js` |
| Validator export | `validate` + PascalCase | `validateAddBasicDetails` |
| Constants | `SCREAMING_SNAKE_CASE` | `ROLES`, `BUSINESS_ENTITY_TYPE` |
| Everything else | camelCase | `brandId`, `sendSuccess` |

Mongo `_id` reference fields end in `Id`: `userId`, `brandId`, `PANId`, `GSTId`, `workHoursId`.

---

## Routes

Routes are **auto-mounted** by `routes/index.js` — it reads every `.js` file in the folder and mounts it at `/<filename>`. So `routes/brands.js` becomes `/trydood/v1/brands`.

- **Do not** register a new route file anywhere — dropping it in `routes/` is enough.
- Override the prefix by exporting `routePrefix`; add sibling routers via `extraRoutes`.

Route files are pure wiring — import middleware, validator, controller, and compose:

```js
const express = require("express");
const router = express.Router();
const { validateSchema, isVendor, verifyJwtToken } = require("../middlewares");
const { validateUpdateBrand } = require("../validator/brands");
const { get, update } = require("../controllers/brands");

router.get("/get", verifyJwtToken, validateSchema(validateGetBrand), get);
router.put("/update", verifyJwtToken, validateSchema(validateUpdateBrand), update);

module.exports = router;
```

**Middleware order is fixed:** auth/role → `validateSchema` → controller.

Group related routes with a comment banner (`// Onboarding Steps`, `// General`).

---

## Controllers

Thin. Every controller is wrapped in `asyncWrapper` and ends with `sendSuccess`.

```js
const { asyncWrapper, sendSuccess } = require("../../utils");
const { getBrand } = require("../../services/brands");

exports.get = asyncWrapper(async (req, res) => {
  const brandId = req.query.brandId || req.brandId;
  const result = await getBrand(brandId);
  return sendSuccess(res, 200, "Brand details fetched successfully", result);
});
```

Rules:

- Always `exports.<name> = asyncWrapper(async (req, res) => { ... })`
- **Never** `try/catch` — `asyncWrapper` forwards rejections to `errorHandler`
- **Never** call `res.json()` / `res.status()` directly — use `sendSuccess`
- One service call per controller where practical; no pipelines, no model imports
- Success messages are sentence case and specific: `"Brand details fetched successfully"`

---

## Services

Where the real work lives. Services throw; they never respond.

```js
const mongoose = require("mongoose");
const Brand = require("../../models/Brand");
const { buildAggregateLookup } = require("../../database");
const { throwError } = require("../../utils");

exports.getBrand = async (brandId) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    throwError(400, "Invalid brand ID");
  }
  const pipeline = [ /* ... */ ];
  const [brand] = await Brand.aggregate(pipeline);
  if (!brand) throwError(404, "Brand not found");
  return brand;
};
```

Rules:

- Plain `async` functions — **not** wrapped in `asyncWrapper` (that is controller-only)
- No `req` / `res` / `next` parameters, ever
- Signal failure with `throwError(status, message)` — never `return null` for an error case
- Return plain data; the controller decides the message

---

## Error Handling

**One mechanism, everywhere:** throw a `CustomError` via `throwError`, let `errorHandler` format it.

```js
const { throwError } = require("../../utils");

throwError(404, "Brand not found");
throwError(422, "Invalid PAN number", { field: "panNumber" }); // optional data
```

`middlewares/errorHandler.js` already handles, in order:

1. Mongoose `ValidationError` → 422 with the first field message
2. Duplicate key (`code === 11000`) → 422 `"<value> is already registered for <field>"`
3. `CustomError` → its own `statusCode` / `message` / `data`
4. Fallback → `err.status || 500`

So **do not** add `try/catch` blocks just to reshape these — they are covered.

Only use `try/catch` when you must branch on the error, as `verifyJwtToken` does for `TokenExpiredError` vs `JsonWebTokenError` — and re-`throwError` from each branch.

### Status codes used in this codebase

| Code | Use |
|---|---|
| 200 | Success |
| 400 | Malformed input not caught by Joi |
| 401 | Missing / expired token |
| 403 | Invalid token, or role not permitted |
| 404 | Resource not found |
| 422 | Validation failure (Joi, Mongoose, duplicate key) |
| 500 | Unexpected |

---

## Responses

Every response goes through `utils/response.js`. The envelope is fixed — never hand-roll it.

```js
const { sendSuccess } = require("../../utils");

sendSuccess(res, 200, "Vouchers fetched successfully", result);
```

```jsonc
// success
{ "success": true,  "message": "...", "data": { } }
// error (sent by errorHandler only)
{ "success": false, "message": "...", "details": { } }
```

Controllers only ever call `sendSuccess`. `sendError` is reserved for `errorHandler`.

---

## Validation

### Joi schemas live in `validator/`

```js
const Joi = require("joi");
const objectId = require("./validJoiObjectId");
const { BUSINESS_ENTITY_TYPE, SCREENS } = require("../constants");

exports.validateUpdateBrand = Joi.object({
  brandId: objectId().required(),
  brandName: Joi.string().trim().min(2).max(120).optional().messages({
    "string.empty": "Brand Name cannot be empty",
    "string.min": "Brand Name must contain at least {#limit} characters",
  }),
});
```

Rules:

- **Every** rule carries a custom `.messages({...})` — no raw Joi text reaches the client
- Messages are human-readable with a capitalised field name: `"Legal Business Name is required"`
- Use `{#limit}` interpolation for min/max
- ObjectIds use the shared `objectId()` from `validator/validJoiObjectId.js`
- Enum values come from `constants/` via `.valid(...Object.values(X))` — never inline string lists
- Conditional fields use `Joi.when(...)` with `otherwise: Joi.forbidden()`
- Always `.trim()` strings

### Wiring

`validateSchema(schema)` accepts either a bare body schema or `{ body, query, params, headers }`. It strips unknown keys, collects all errors (`abortEarly: false`), converts types, and exposes the merged result as `req.validatedData`.

Validation failures become 422 with `cleanJoiError` output — never validate manually in a controller.

---

## Authentication & Roles

```js
const { verifyJwtToken, isAdmin, isVendor, isCustomer, validateRoles } = require("../middlewares");
```

| Middleware | Use |
|---|---|
| `verifyJwtToken` | Any authenticated user, role irrelevant |
| `isAdmin` / `isVendor` / `isCustomer` | Single-role gate |
| `validateRoles(A, B)` | Multi-role gate |

After either middleware, these are populated — read them instead of re-decoding the token:

```js
req.userId        // always
req.role          // always
req.user          // full user document
req.customerId    // when role === ROLES.CUSTOMER
req.brandId       // when role === ROLES.VENDOR
```

Roles come from `constants` → `ROLES` (`ADMIN`, `VENDOR`, `SUB_VENDOR`, `CUSTOMER`). Never compare against a string literal.

---

## Models

```js
const mongoose = require("mongoose");
const { userField, PANField } = require("./validObjectId");
const { BUSINESS_ENTITY_TYPE } = require("../constants");

const brandSchema = new mongoose.Schema(
  {
    userId: { ...userField, required: true },
    PANId: PANField,
    followersCount: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);
```

Rules:

- Reference fields reuse the shared descriptors in `models/validObjectId.js` — do not re-declare `{ type: ObjectId, ref: "..." }`
- Enum fields draw from `constants/`
- Field-level validators come from `validator/common.js` (`isValidEmail`, `isValidPhoneNumber`, …)
- **Soft delete only** — every query must filter `isDeleted: false`. Never `deleteOne`/`deleteMany` on domain data.
- Counters (`followersCount`, `avoidanceCount`) are denormalised — update them in the same service that changes the underlying relation.

---

## Aggregation & Data Access

### `buildAggregateLookup`

Use it for every `$lookup` + `$unwind` pair instead of writing both stages:

```js
const { buildAggregateLookup } = require("../../database");

...buildAggregateLookup({
  from: "users",
  localField: "userId",
  as: "user",
  project: { password: 0, otp: 0, refreshToken: 0 },
}),
```

**Always project away `password`, `otp`, and `refreshToken` when joining `users`.**

Separate logical blocks in long pipelines with the banner-comment style already in `getBrand.js`.

### `dbServices.js`

Generic CRUD wrappers (`createItem`, `findById`, `findOne`, `findMany`, `updateOne`, `findOneAndUpdate`, `findByIdAndUpdate`). Prefer these for simple operations; drop to raw Mongoose for aggregations.

`findOneAndUpdate` / `findByIdAndUpdate` already default to `returnDocument: "after"`.

### Pagination

Never hand-roll skip/limit. Use `pagination(model, pipeline, page, limit, entityName)` — it wraps the pipeline in a `$facet`, and **throws 404 `No any <entity> found` when empty**, so callers do not need an empty check.

```js
const { pagination } = require("../../utils");
return await pagination(Voucher, pipeline, page, limit, "voucher");
```

Returns `{ total, totalPages, page, limit, data }`.

---

## Constants

All shared enums live in `constants.js` (root) or `constants/<domain>.js`, always `Object.freeze`d:

```js
ROLES: Object.freeze({ ADMIN: "ADMIN", VENDOR: "VENDOR", ... })
```

Never inline a magic string that exists in `constants`. Import and reference it — in validators, models, services, and comparisons alike.

---

## Configuration & Secrets

- Every external credential comes from `process.env`, loaded once by `require("dotenv").config()` in `index.js`
- Third-party clients are constructed in `configs/` (`cloudinary.js`, `razorpay.js`, `cgpey.js`, `tendigitOtp.js`) — never instantiate an SDK inline
- **Never** commit `.env`, log a secret, or return one in a response
- `.env` is already gitignored — keep it that way

---

## Async Style

- `async/await` everywhere — no `.then()` chains, no callbacks
- `await` every promise; never fire-and-forget without an explicit comment
- Use `Promise.all` for independent I/O rather than sequential awaits

---

## Code Quality

**Always**

- `asyncWrapper` on every controller
- `throwError` for every failure path
- `sendSuccess` for every success path
- Barrel imports (`require("../../services/brands")`)
- `isDeleted: false` in every domain query
- Constants instead of string literals
- Prettier defaults: 2-space indent, double quotes, semicolons, trailing commas

**Never**

- `try/catch` in a controller
- `res.json()` / `res.status()` outside `utils/response.js`
- Model import inside a controller
- `req` / `res` inside a service
- Business logic in a route file
- Hard delete of domain data
- Manual validation that Joi should own
- Unused imports or commented-out code

---

## JSDoc

Exported helpers and non-obvious functions get a JSDoc block, as in `validateObjectId.js`:

```js
/**
 * Validates a MongoDB ObjectId.
 * @param {string} id - The ID to validate.
 * @param {string} [label="ID"] - Optional label for error message context.
 * @throws Will throw an error if the ID is invalid.
 */
```

Thin controllers and single-purpose services do not need one if the filename already says it.

---

## Feature Checklist

- [ ] Mongoose model in `models/` (soft-delete field, shared ObjectId descriptors)
- [ ] Enums added to `constants/`, frozen
- [ ] Joi schema in `validator/` with custom `.messages()` on every rule
- [ ] Service in `services/<domain>/<verb>.js` + barrel updated
- [ ] Controller in `controllers/<domain>/<verb>.js` + barrel updated
- [ ] Route added to `routes/<domain>.js` (auto-mounts — no registration needed)
- [ ] Correct auth middleware (`isVendor` / `isCustomer` / `isAdmin` / `verifyJwtToken`)
- [ ] `validateSchema(...)` before the controller
- [ ] All failures via `throwError` with an accurate status code
- [ ] Success via `sendSuccess` with a specific message
- [ ] List endpoints use `pagination`
- [ ] Joins use `buildAggregateLookup`, sensitive user fields projected out
- [ ] Queries filter `isDeleted: false`
- [ ] No secrets logged or returned
