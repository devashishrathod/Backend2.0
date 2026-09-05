const { randomInt } = require("crypto");
const { throwError } = require("../../utils");

/**
 * The short human-readable id people read out loud — `#TC64840`, `#TB10293`.
 *
 * ### Why one helper instead of four copies
 *
 * `generateUniqueUserId`, `generateUniqueCustomerId`, `generateUniqueBrandId`
 * and `generateUniqueSubBrandId` were the same fourteen lines four times, and
 * carried the same three problems four times. Fixing them separately means
 * fixing them three more times, and missing one.
 *
 * ### The three problems
 *
 * **1. `Math.random()`.** `CLAUDE.md` bans it for anything a stranger benefits
 * from guessing, because V8's generator is not seeded from entropy an attacker
 * cannot reach and its state is recoverable from a run of outputs. These ids are
 * not credentials, but they are *addresses* — `#TC64840` opens a customer in the
 * admin panel — and there is no reason to keep a predictable one when
 * `crypto.randomInt` costs the same.
 *
 * **2. A 90,000-value space (5 digits).** Fine at 59 users. At 45,000 the
 * collision chance is 50% **per attempt**, so every signup pays two round trips;
 * at 85,000 it is eighteen. Six digits moves that cliff out by a factor of ten,
 * and the `\d+` in the validators already accepts any length — nothing pins five.
 *
 * **3. `while (true)` with no cap.** This is the sharp one. Once the space is
 * full the loop **never terminates**: the request hangs, holding a connection
 * from a pool of twenty, until something upstream gives up. No error, no log —
 * the symptom is a server that stops answering. A cap turns a silent hang into a
 * loud, findable failure.
 *
 * ### ⚠️ This is not the uniqueness guarantee
 *
 * The check here is a *courtesy* — it keeps the common case tidy. Two callers
 * can still pick the same value in the window between the read and the write,
 * which is exactly how four accounts ended up on one phone number. The unique
 * index on the column is what actually decides; this only makes it rare enough
 * that the index never has to.
 *
 * @param {import("mongoose").Model} model      collection to check against
 * @param {object}   options
 * @param {string}   options.prefix             `"#TC"`
 * @param {number}   [options.digits=6]
 * @param {string}   [options.field="uniqueId"]
 * @param {number}   [options.maxAttempts=10]
 * @returns {Promise<string>}
 */
exports.generateUniqueDisplayId = async (
  model,
  { prefix, digits = 6, field = "uniqueId", maxAttempts = 10 } = {},
) => {
  const min = 10 ** (digits - 1);
  const max = 10 ** digits;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // `randomInt(min, max)` is [min, max) — uniform, and rejection-sampled by
    // Node so the low values are not favoured the way `% range` would.
    const candidate = `${prefix}${randomInt(min, max)}`;
    const existing = await model.findOne({ [field]: candidate }).select("_id").lean();
    if (!existing) return candidate;
  }

  /**
   * Ten collisions in a row means the space is effectively full — at six digits
   * that is around 900,000 rows carrying this prefix. Saying so is far more
   * useful than looping: it names the collection, and the fix (more digits) is
   * one number in the caller.
   */
  throwError(
    500,
    `Could not allocate a unique ${prefix} id after ${maxAttempts} attempts — the ${digits}-digit space for ${model.modelName} is exhausted.`,
  );
  // Unreachable; `throwError` always throws. Kept so the function has one exit
  // type for anyone reading it.
  return null;
};
