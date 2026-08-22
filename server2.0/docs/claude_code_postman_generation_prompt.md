# Prompt for Claude Code — Generate Postman Collection from Backend Scan

Copy everything in the code block below and paste it into Claude Code as your instruction. It's written so Claude Code scans first, asks you questions if the code leaves anything ambiguous, presents a plan, waits for your approval, and only then builds the files.

```
ROLE & OBJECTIVE
You are building a production-quality Postman v2.1 collection, pre-request/test scripts,
and Local/Staging/Production environments — generated directly from this codebase, not
from assumptions. Every route, field, auth rule, and error shape in the final output must
be traceable to actual code. Do not invent endpoints or fields that don't exist.

Do not write any Postman file until you've finished Phase 1 and Phase 2, and I have
explicitly approved your Phase 3 plan. This is a hard stop — wait for my "approved" /
"go ahead" before Phase 4.

=== PHASE 1 — SCAN (read-only, no output files yet) ===

1. Detect the stack first (package.json / requirements.txt / composer.json / pom.xml /
   Gemfile / go.mod, etc.) and the framework (Express, NestJS, Django, FastAPI, Laravel,
   Rails, Spring, etc.) so you search for routes the right way for this codebase.

2. Find every route/endpoint: HTTP method, full path, and the module/folder it lives in
   (this becomes your Postman folder structure — mirror the code's grouping, don't invent
   your own).

3. For each route, trace:
   - The middleware chain, especially auth middleware. Note exactly which routes are
     public, which require a logged-in user, and which are role-gated (e.g. buyer,
     seller, admin). Note whether different roles get genuinely different tokens/sessions
     or share one auth mechanism.
   - The request validation schema/DTO (Joi, Zod, class-validator, Pydantic, FormRequest,
     serializers, etc.) — use it to build accurate example request bodies with correct
     types, required vs optional fields, and enums. Don't guess field names.
   - The response shape (serializer/DTO/response model) — use it for accurate example
     response bodies. Never include a field like a plaintext password in an example
     response just because a model has it as a column — check what's actually serialized
     back to the client.
   - The error-handling code (global exception handler / error middleware) — extract the
     REAL error response shape (field names, types — e.g. is "error" a boolean, a string,
     or a code?) and the REAL status codes and messages actually used (400, 401, 403, 404,
     409, 422, etc.). Do not default to one generic "Validation failed" message on every
     endpoint — pull the specific message/code each validator or business rule actually
     returns (e.g. "bid must exceed current highest bid", "email already registered",
     "auction already ended").
   - Whether the route accepts file uploads (multer/formidable/multipart config, or a
     pre-signed-URL flow) vs. plain JSON with a URL string.
   - Whether payment/write-sensitive routes implement or expect an idempotency key.
   - Whether list routes implement pagination, and whether it's consistent across
     endpoints or only on some.
   - Rate limiting, if any middleware implements it.

4. Find the actual base URLs / ports for local, staging, and production from config files
   (.env, .env.example, config/*.js, application.yml, settings.py, docker-compose.yml,
   etc.) and the API version prefix if one exists.

5. Note any WebSocket/Socket.io/SSE endpoints (e.g. for live bidding, chat) separately —
   these aren't REST requests, but flag them so they're not silently missing from the
   final picture.

=== PHASE 2 — CLARIFYING QUESTIONS ===

After the scan, STOP and give me a numbered list of anything the code does not answer —
for example (only ask what's actually unresolved for this repo):
- Staging/local URLs or ports you couldn't find in config.
- If different roles share one token field in the code: whether you should still model
  it as two Postman variables (token / admin_token) for testing convenience, or keep it
  as one variable to match the real auth design.
- Any route where the validation/response schema was ambiguous or missing.
- Whether to pull example values from seed/fixture data if it exists, or use synthetic
  examples.
- How to handle the WebSocket/SSE endpoints you found (separate documentation folder,
  or skip them).
- Any naming convention preference beyond "singular for single-resource actions"
  (see quality bar below).

Wait for my answers before moving to Phase 3.

=== PHASE 3 — PLAN (wait for approval) ===

Present, in plain text:
- The folder tree you'll create in the collection (mirroring the real route groups).
- The full list of environment variables per environment (local/staging/production),
  with the real values you found or that I gave you in Phase 2.
- Which requests get pre-request scripts and what each script does.
- Which requests get test (post-response) scripts and what each asserts/captures.
- The naming convention you'll apply collection-wide.

Do not create any file yet. Wait for me to say "approved" or "go ahead."

=== PHASE 4 — BUILD (only after I approve) ===

Create a `/postman` folder at the project root containing:
- `<project-name>.postman_collection.json` (schema v2.1)
- `environments/local.postman_environment.json`
- `environments/staging.postman_environment.json`
- `environments/production.postman_environment.json`
- `README.md` — how to import the collection + environments in Postman, and how the
  token-capture scripts work.

Collection requirements:
- Folder structure mirrors the real route grouping found in Phase 1.
- Every path variable (`:id`, `:slug`, etc.) has a default example value set on the
  request, not left blank.
- Auth type set correctly per route based on the real middleware (noauth / bearer),
  referencing the right variable for the right role per what we agreed in Phase 2.
- Every request has a one-line description: what it does, who can call it (role), and
  any business rule worth knowing (e.g. "requires OTP verification first").
- Success AND realistic error examples per request, pulled from the actual
  validation/error-handling code — not one generic message reused everywhere. Include
  401/403 examples on protected routes and 409 examples on concurrency-sensitive routes
  (bidding, checkout) if the code has that logic.
- Idempotency-Key header modeled on payment/write-sensitive routes if the code supports
  or should support it.
- Consistent pagination params only where the backend actually implements pagination —
  don't add it decoratively where it's not real.

Scripts:
- A test (post-response) script on the login endpoint(s) that reads the response and
  automatically sets the correct environment variable(s) — no manual copy-pasting of
  tokens.
- Pre-request scripts anywhere they're actually needed (e.g. generating a fresh
  Idempotency-Key per request on payment endpoints).
- Basic test assertions (status code, response time, key fields present) on each request.

Before you finish: validate that the generated collection.json is syntactically valid
JSON and conforms to the Postman v2.1 schema.

=== NON-NEGOTIABLE QUALITY BAR ===
- No field in an example response that the real API wouldn't actually return (e.g. never
  echo a plaintext password back, even in a mock example).
- Error fields use real types from the code (boolean/string/enum) — never a string like
  "true" standing in for a boolean.
- Singular resource names for single-item actions: "Create Listing" not "Create
  Listings", "Update User" not "Update Users" — apply this collection-wide, matching
  whatever a plural list endpoint keeps as "List Listings" / "List Users".
- Every claim in a description or example must trace back to something you actually
  found in the code. If you're inferring rather than reading it directly, say so in the
  Phase 2 questions instead of guessing silently.
```
