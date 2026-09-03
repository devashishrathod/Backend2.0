const Joi = require("joi");
const { throwError, cleanJoiError } = require("../utils");

/**
 * Put a validated value back on the request.
 *
 * ⚠️ **`req.query = value` does nothing on Express 5**, and says nothing when it
 * fails. Express 5 defines `query` as a getter on the request prototype with no
 * setter, so a plain assignment in non-strict code is silently discarded and the
 * raw, unparsed query survives.
 *
 * Validation still *ran*, so a bad value is still a 422 and nothing looks
 * broken. What is lost is everything Joi produced on the way through: `convert`
 * (`"25"` stays a string, `"false"` stays a truthy string), `.default()` (never
 * applied at all) and normalisations like `.uppercase()`. A service that
 * switches on `sortBy` then falls through to its default branch and returns a
 * confidently wrong answer, with no error anywhere.
 *
 * `defineProperty` writes an own data property that shadows the prototype
 * getter, which is the only way to make the assignment stick. `body` and
 * `params` are ordinary own properties and would assign fine; they go through
 * here too so there is one rule rather than a per-field convention to remember.
 */
const writeBack = (req, key, value) => {
  Object.defineProperty(req, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
};

exports.validateSchema = (schema) => {
  return (req, res, next) => {
    if (Joi.isSchema(schema)) {
      const { error, value } = schema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
      });
      if (error) {
        return next(throwError(422, cleanJoiError(error)));
      }
      writeBack(req, "body", value);
      req.validatedData = {
        ...value,
      };
      return next();
    }

    const validationSchema = Joi.object({
      body: schema.body || Joi.object({}),
      query: schema.query || Joi.object({}),
      params: schema.params || Joi.object({}),
      headers: schema.headers || Joi.object({}),
    });

    const { error, value } = validationSchema.validate(
      {
        body: req.body,
        query: req.query,
        params: req.params,
        headers: req.headers,
      },
      {
        abortEarly: false,
        stripUnknown: true,
        allowUnknown: true,
        convert: true,
      },
    );

    if (error) {
      return next(throwError(422, cleanJoiError(error)));
    }

    writeBack(req, "body", value.body);
    writeBack(req, "query", value.query);
    writeBack(req, "params", value.params);

    /**
     * ⚠️ `req.headers` is **never replaced**, only added to.
     *
     * A route that declares no `headers` schema gets `Joi.object({})` above, and
     * `stripUnknown` then removes every header there is — so the old
     * `req.headers = value.headers` handed the rest of the request an empty
     * object. No validator in this repo declares one, which made that the only
     * thing it ever did.
     *
     * It is not cosmetic. `POST /voucherClaims/create-order` reads
     * `req.get("Idempotency-Key")` **after** this middleware, and that key is
     * what makes the second of two concurrent taps lose — inserted before the
     * gateway is called, so a duplicate cannot create a second Razorpay order.
     * With the headers gone it read `undefined` every time, and the protection
     * was off with nothing to show for it. `req.get()` reads `req.headers`, so
     * it went the same way.
     *
     * Merging keeps a declared header schema useful — its `convert` and
     * `default` still land — without the empty-schema case destroying the
     * request.
     */
    if (schema.headers) {
      Object.assign(req.headers, value.headers);
    }

    req.validatedData = {
      ...value.params,
      ...value.query,
      ...value.body,
    };
    next();
  };
};
