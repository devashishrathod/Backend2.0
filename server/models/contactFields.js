const { isValidEmail, isValidPhoneNumber, normalisePhone } = require("../validator/common");

/**
 * ---------------- the contact fields, declared once ----------------
 *
 * `email`, `mobile` and `whatsappNumber` are declared on **four** schemas —
 * `User`, `Customer`, `Brand` and `SubBrand` — and until now each one spelled its
 * own `lowercase`/`trim`/`validate` block out by hand. Eleven near-identical
 * blocks, and `SubBrand.email` had already drifted into a slightly different
 * message from `Brand.email`.
 *
 * Same reasoning as `validObjectId.js`, which this deliberately mirrors: a field
 * that means the same thing in four places should be **one object** in four
 * places, or the day one of them is fixed the other three quietly stay wrong.
 *
 * ### ⚠️ The setter is the load-bearing part
 *
 * `normalisePhone` runs as a Mongoose **setter**, not as a step inside whichever
 * service happens to be writing. That matters because Mongoose applies setters to
 * `save()`, `create()`, `updateOne()`, `updateMany()` and `findOneAndUpdate()`
 * alike — so it is the one place a phone number cannot be written past.
 *
 * Normalising inside services instead would mean every future service has to
 * remember, and forgetting produces **no error at all**: just a second spelling
 * of a number that the partial unique index then happily accepts as a different
 * person. That is precisely the `sendOtp` rate-limit reasoning from `CLAUDE.md`,
 * applied to a field instead of a route — put the guard where it cannot be
 * skipped, not where it has to be invoked.
 *
 * ⚠️ A value that is not a recognisable Indian mobile passes through the setter
 * **unchanged**, so the validator below rejects what the caller actually sent.
 * A setter that mangled bad input would produce error messages about a string
 * nobody typed.
 */

/**
 * A phone number: stored as ten digits, accepted in the three spellings people
 * send (`9876543210`, `919876543210`, `+91 98765-43210`).
 *
 * @param {string} label  what to call it in the error message
 */
const phoneField = (label) =>
  Object.freeze({
    type: String,
    trim: true,
    set: normalisePhone,
    validate: {
      validator: (value) => isValidPhoneNumber(value),
      message: (props) => `${props.value} is not a valid ${label}`,
    },
  });

/**
 * An email address: stored lowercased and trimmed.
 *
 * No setter beyond `lowercase`/`trim` — Mongoose already provides both, and
 * unlike a phone number an address has no country code to strip.
 */
const emailField = Object.freeze({
  type: String,
  lowercase: true,
  trim: true,
  validate: {
    validator: (value) => isValidEmail(value),
    message: (props) => `${props.value} is not a valid email address`,
  },
});

module.exports = Object.freeze({
  emailField,
  mobileField: phoneField("mobile number"),
  whatsappField: phoneField("WhatsApp number"),
  phoneField,
});
