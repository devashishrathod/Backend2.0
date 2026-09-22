const { randomUUID } = require("node:crypto");
const OtpThrottle = require("../../models/OtpThrottle");
const { getSecurityConfig } = require("../settings");

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;

/**
 * The window's send times, read only from entries that carry a nonce.
 *
 * ⚠️ Entries written before O-1 are bare `Date`s with no `nonce`, and the
 * pipeline drops them (see the note on the prune stage). This mirrors that, so
 * the refusal arithmetic can never be computed from entries the write itself
 * has already stopped counting — the two would otherwise disagree about how
 * full the window is.
 */
const sendTimes = (row) =>
  (row?.sends || [])
    .filter((entry) => entry?.at && entry?.nonce)
    .map((entry) => new Date(entry.at).getTime());

/**
 * May a code go to this target right now? Claims the slot if so.
 *
 * ### One atomic write, not read-then-write
 *
 * ⚠️ The obvious version — count the recent sends, decide, then record one — has
 * a window two requests both pass. Two taps on "resend" would land two messages,
 * and the day this runs on a second instance the limit is simply doubled.
 *
 * So Mongo decides. A pipeline update prunes the window and appends **only if**
 * the conditions hold, in a single operation, and the caller finds out by asking
 * whether **its own claim** survived. That is the same discipline the money
 * paths use for a conditional claim: the condition lives in the write, so timing
 * cannot change the answer.
 *
 * ### 🔴 The claim is identified by a nonce, never by its timestamp (O-1)
 *
 * This used to read `sends.includes(now.getTime())`. A timestamp is not an
 * identity: N callers in the same millisecond compute the same one, so the
 * single write that appended was read by **all** of them as their own. Eight
 * concurrent claims all returned `allowed: true`, seven of them having written
 * nothing, and eight messages went out — the throttle opening exactly under the
 * burst it exists to stop.
 *
 * The atomic write was never the problem and is unchanged. What changed is the
 * question asked afterwards.
 *
 * ### Refused is not an error here
 *
 * Returns a verdict rather than throwing, because the caller has to decide what
 * the person is told — and telling them *"a code was already sent, check your
 * messages"* is better than an error, since in almost every case one really was.
 *
 * @param {string} target   phone number or email
 * @param {string} purpose  scoped, so login and bank-attach do not share an allowance
 * @returns {Promise<{allowed: boolean, at?: Date, nonce?: string, retryAfterSeconds: number, reason?: string}>}
 *   `nonce` identifies this call's entry — the caller gives the slot back with
 *   `$pull: { sends: { nonce } }` if the message then fails to send. ⚠️ Not by
 *   `at`, and not by a time range: both would pull an entry another caller
 *   claimed in the same millisecond, which is the O-1 bug wearing its other
 *   face. `at` is returned for logging and for the retry arithmetic only.
 */
exports.claimOtpSend = async (target, purpose) => {
  const { otp: limits } = await getSecurityConfig();

  const now = new Date();
  /**
   * This call's identity. Unguessable is not the requirement — it never leaves
   * the process — but `crypto` is free and this repo does not reach for
   * `Math.random()` for anything that decides an outcome.
   */
  const nonce = randomUUID();
  const windowStart = new Date(now.getTime() - HOUR_MS);
  const cooldownCutoff = new Date(
    now.getTime() - limits.resendCooldownSeconds * SECOND_MS,
  );

  const row = await OtpThrottle.findOneAndUpdate(
    { target, purpose },
    [
      {
        /**
         * Roll the window forward first, so the count below is "the last hour"
         * rather than "since this row was made".
         *
         * ⚠️ `$$this.at`, and that also drops any entry left over from before
         * O-1 — those were bare `Date`s, so `$$this.at` is missing and the
         * comparison is false. Dropping them is deliberate rather than
         * tolerated: a mixed array would still be counted by `$size` while
         * `$max` over the mapped `at`s ignored the legacy ones, so the hourly
         * cap and the cooldown would disagree about the same row. A clean slate
         * for one row is the smaller and more predictable wrong, the TTL is two
         * hours, and this is pre-launch — no migration, per M-5.
         */
        $set: {
          sends: {
            $filter: {
              input: { $ifNull: ["$sends", []] },
              cond: { $gte: ["$$this.at", windowStart] },
            },
          },
        },
      },
      {
        $set: {
          sends: {
            $cond: [
              {
                $and: [
                  { $lt: [{ $size: "$sends" }, limits.maxPerHour] },
                  {
                    $or: [
                      // Nothing in the window: the cooldown cannot have been
                      // broken by a send that is not there.
                      { $eq: [{ $size: "$sends" }, 0] },
                      // ⚠️ `$max` over the mapped times, not over the entries —
                      // `$max` of a list of documents compares documents, which
                      // would order them by `at` only by accident of field
                      // order and silently stop being true if a field moved.
                      {
                        $lte: [
                          {
                            $max: {
                              $map: { input: "$sends", in: "$$this.at" },
                            },
                          },
                          cooldownCutoff,
                        ],
                      },
                    ],
                  },
                ],
              },
              { $concatArrays: ["$sends", [{ at: now, nonce }]] },
              "$sends",
            ],
          },
          // Touched either way — see the note on the field. A row that only
          // moved on success would expire mid-flood and hand out a clean slate.
          updatedAt: now,
        },
      },
    ],
    {
      upsert: true,
      returnDocument: "after",
      setDefaultsOnInsert: true,
      /**
       * ⚠️ Required in Mongoose 9 for an aggregation-pipeline update. Without it
       * the driver refuses the array outright — see `CLAUDE.md`.
       */
      updatePipeline: true,
    },
  ).lean();

  const sends = sendTimes(row);

  /**
   * ✅ **O-1 fixed here.** The question is "did **my** claim survive", and only
   * this call knows its nonce.
   *
   * It read `sends.includes(now.getTime())` before. That is the same question
   * asked of a value every concurrent caller shares, so the single entry the
   * winning write appended answered `true` for all of them — see the note at
   * the top of this file and on the model.
   *
   * ⚠️ Keep this a nonce comparison. Anything derived from the clock brings the
   * bug straight back, and it comes back **silently**: the only symptom is
   * messages going out under load, which nothing here can observe.
   *
   * Pinned by `__tests__/money/otpThrottle.test.js` — "two requests at the same
   * moment › lets exactly one through", plus the mutation note there.
   */
  const allowed = (row?.sends || []).some((entry) => entry?.nonce === nonce);

  if (allowed) return { allowed: true, at: now, nonce, retryAfterSeconds: 0 };

  const last = sends.length ? Math.max(...sends) : 0;
  const oldest = sends.length ? Math.min(...sends) : 0;

  /**
   * Which limit stopped it, and how long until it will not.
   *
   * The two answers are very different — a minute against most of an hour — and
   * a caller told "try again later" with no number simply tries again
   * immediately, which is another refused request and another confused person.
   */
  const hitHourlyCap = sends.length >= limits.maxPerHour;

  const retryAfterSeconds = hitHourlyCap
    ? Math.max(1, Math.ceil((oldest + HOUR_MS - now.getTime()) / SECOND_MS))
    : Math.max(
        1,
        Math.ceil(
          (last + limits.resendCooldownSeconds * SECOND_MS - now.getTime()) /
            SECOND_MS,
        ),
      );

  return {
    allowed: false,
    retryAfterSeconds,
    reason: hitHourlyCap ? "HOURLY_CAP" : "COOLDOWN",
  };
};
