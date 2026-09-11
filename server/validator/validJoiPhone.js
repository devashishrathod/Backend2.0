const Joi = require("joi");
const { normalisePhone, CANONICAL_PHONE_REGEX } = require("./common");

/**
 * ---------------- a phone number, at the edge ----------------
 *
 * Same shape and purpose as `validJoiObjectId.js`: one definition, imported by
 * every validator that takes a phone number, so none of them can quietly
 * disagree about what one is.
 *
 * ### ⚠️ It **rewrites** the value, it does not only check it
 *
 * `helpers` returning the normalised string is the point. `req.validatedData`
 * is what every service reads, so by the time the number reaches
 * `User.findOne({ whatsappNumber })` or a `target !== current` comparison it is
 * already ten digits — regardless of whether the app sent `+91 98765 43210` or
 * `9876543210`.
 *
 * The Mongoose setter in `models/contactFields.js` guards the **write**; this
 * guards the **read and the comparison**. Both are needed and neither replaces
 * the other:
 *
 * - Without the setter, a service that writes a number without going through Joi
 *   stores a second spelling.
 * - Without this, a verification flow comparing `+919876543210` to the stored
 *   `9876543210` decides the user is *changing* their number when they are
 *   confirming it — and sends a code to make a change that is not one.
 *
 * ### Why the old `.pattern(/^[6-9]\d{9}$/)` was not enough
 *
 * It is strict, which looks safe, and it was — for the five auth schemas that
 * used it. The looseness was everywhere else: `subBrands`' filter took
 * `Joi.string().trim()` with no pattern at all, and the Mongoose validators
 * accepted `+91…`. So the API's front door demanded ten digits while three side
 * doors accepted anything, on fields carrying a **partial unique index**.
 *
 * @param {string} label  what to call it in the error message
 */
const phone = (label = "phone number") =>
  Joi.string()
    .trim()
    .custom((value, helpers) => {
      const normalised = normalisePhone(value);
      if (!CANONICAL_PHONE_REGEX.test(normalised)) {
        return helpers.error("any.invalid");
      }
      return normalised;
    }, "Phone normalisation")
    .messages({
      "string.base": `Please enter a valid 10 digit ${label}`,
      "string.empty": `${label.charAt(0).toUpperCase()}${label.slice(1)} is required`,
      "any.invalid": `Please enter a valid 10 digit ${label}`,
      "any.required": `${label.charAt(0).toUpperCase()}${label.slice(1)} is required`,
    });

/**
 * A phone number **as a search term** — normalised, never rejected.
 *
 * ⚠️ A filter is not a field, and treating it like one breaks the feature.
 * `getAllSubBrands` matches these with `$regex`, so a vendor typing `98765` to
 * find an outlet is doing the normal thing. Running the strict schema above on
 * that input answers `422 Please enter a valid 10 digit mobile number` for a
 * search that used to work.
 *
 * So this only canonicalises: a complete `+91 98765 43210` becomes `9876543210`
 * and therefore matches the stored rows, while anything partial passes through
 * untouched — which is exactly what `normalisePhone` already does with a value it
 * does not recognise.
 */
const searchablePhone = () =>
  Joi.string()
    .trim()
    .custom((value) => normalisePhone(value), "Phone normalisation")
    .messages({ "string.base": "Please enter a phone number to search for" });

module.exports = phone;
module.exports.searchable = searchablePhone;
