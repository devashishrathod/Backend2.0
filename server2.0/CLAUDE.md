# CLAUDE.md

AI instructions for **Trydood 2.0** — a Node.js + Express + MongoDB backend for a voucher / e-commerce / membership platform.

> **Detailed coding rules** → see [coding-standards.md](./coding-standards.md)

---

## Stack

Node.js · CommonJS · Express 5 · Mongoose 9 (MongoDB) · Joi 18 · JWT · bcrypt · Cloudinary · Razorpay · Nodemailer · PDFKit · Morgan · ngrok

> No TypeScript. No ESM. `require()` / `module.exports` everywhere.

---

## Commands

```bash
npm run dev     # nodemon index  — local development with reload
npm start       # node index     — production
```

> There is no test runner and no lint script configured. Do not invent `npm test` / `npm run lint` — they will fail.

Server boots from `index.js`, mounts everything under `/trydood/v1`, and connects to Mongo via `database/mongoDb.js`.

---

## Directory Map

| Path | Holds |
|---|---|
| `index.js` | App bootstrap, global middleware, error handler, listener |
| `constants.js` · `constants/` | Frozen enums (`ROLES`, `SCREENS`, …) |
| `routes/` | Express routers — **auto-mounted**, one file per domain |
| `middlewares/` | `verifyJwtToken`, `validateRoles`, `validateSchema`, `errorHandler` |
| `controllers/<domain>/` | Thin request handlers, one file per operation + barrel |
| `services/<domain>/` | Business logic, aggregation pipelines |
| `helpers/<domain>/` | Small reusable domain utilities |
| `models/` | Mongoose schemas (PascalCase, singular) |
| `validator/` | Joi schemas |
| `database/` | Mongo connection, `dbServices`, `buildAggregateLookup` |
| `utils/` | `asyncWrapper`, `CustomError`, `response`, `pagination` |
| `configs/` | Third-party SDK clients (Cloudinary, Razorpay, CGPey, OTP) |
| `docs/` | API documentation |

---

## Request Flow

```
routes/ → middlewares/ → controllers/ → services/ → models/
```

Strictly one direction. A controller never imports a model; a service never sees `req`/`res`.

---

## Core Rules (Quick Reference)

| Rule | Correct | Wrong |
|---|---|---|
| Controller wrapper | `asyncWrapper(async (req, res) => …)` | bare `async` + `try/catch` |
| Success response | `sendSuccess(res, 200, "…", data)` | `res.json(...)` |
| Failure | `throwError(404, "Brand not found")` | `res.status(404).json(...)` |
| Imports | `require("../../services/brands")` | `require(".../brands/getBrand")` |
| Enums | `ROLES.VENDOR` | `"VENDOR"` |
| ObjectId in Joi | `objectId().required()` | `Joi.string()` |
| Joins | `buildAggregateLookup({...})` | hand-written `$lookup` + `$unwind` |
| Lists | `pagination(Model, pipeline, …)` | manual `$skip` / `$limit` |
| Delete | `isDeleted: true` | `deleteOne()` |
| Queries | filter `isDeleted: false` | unfiltered `find()` |

---

## Adding an Endpoint

1. **Model** — `models/<Name>.js`, reuse ObjectId descriptors from `models/validObjectId.js`, include `isDeleted`
2. **Constants** — add enums to `constants/`, `Object.freeze`d
3. **Validator** — `validator/<domain>.js`, export `validate<Action>` with custom `.messages()` on every rule
4. **Service** — `services/<domain>/<verb>.js`, plain `async`, `throwError` on failure, update the barrel
5. **Controller** — `controllers/<domain>/<verb>.js`, `asyncWrapper` + `sendSuccess`, update the barrel
6. **Route** — add to `routes/<domain>.js`; the file auto-mounts at `/trydood/v1/<domain>`

Order in a route: auth middleware → `validateSchema(...)` → controller.

```js
router.put("/update", isVendor, validateSchema(validateUpdateBrand), update);
```

---

## Response Envelope

```jsonc
{ "success": true,  "message": "Brand details fetched successfully", "data": {} }
{ "success": false, "message": "Brand not found", "details": {} }
```

Produced only by `utils/response.js`. Never hand-roll it.

---

## Error Handling

Throw, don't catch. `errorHandler` already converts Mongoose `ValidationError` (422), duplicate keys (422), and `CustomError` into the envelope.

```js
const { throwError } = require("../../utils");
throwError(422, "Invalid PAN number");
```

Only use `try/catch` when branching on the error type (see `verifyJwtToken`), and re-`throwError` from each branch.

| Code | Use |
|---|---|
| 400 | Malformed input not caught by Joi |
| 401 | Missing / expired token |
| 403 | Invalid token, or role not permitted |
| 404 | Resource not found |
| 422 | Validation failure, duplicate key |
| 500 | Unexpected |

---

## Auth Context

After `verifyJwtToken` or a role middleware, read these off `req` — never re-decode the JWT:

```js
req.userId · req.role · req.user · req.customerId (CUSTOMER) · req.brandId (VENDOR)
```

Gates: `verifyJwtToken` (any) · `isAdmin` · `isVendor` · `isCustomer` · `validateRoles(A, B)`

---

## Security Musts

- Project away `password`, `otp`, `refreshToken` in every `users` lookup
- Secrets only from `process.env`; never log or return them
- Soft delete only — domain data is never physically removed
- Let Joi own all input validation; `stripUnknown` is already enabled

---

## Code Review Graph

This repo is indexed by `code-review-graph`. Its MCP server is configured in `.mcp.json` and scoped to `server2.0/` via `CRG_REPO_ROOT`.

Use the graph tools to trace callers, impact, and dependencies before editing shared code — `utils/`, `middlewares/`, `constants/`, and `models/` are imported very widely, so a small change there has a large blast radius.

```bash
code-review-graph update     # incremental re-index after changes
code-review-graph status     # node/edge counts
code-review-graph impact     # blast radius of a change
```

Generated skills live in `.claude/skills/` (`explore-codebase`, `review-changes`, `debug-issue`, `refactor-safely`).

---

## Never

- `try/catch` in a controller
- `res.json()` / `res.status()` outside `utils/response.js`
- Model import inside a controller
- `req` / `res` inside a service
- Business logic in a route file
- Hard delete of domain data
- Magic strings where a `constants` entry exists
- Manual pagination or hand-written `$lookup` + `$unwind`
- Committing `.env` or any credential
