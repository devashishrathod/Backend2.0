const OtpThrottle = require("../../models/OtpThrottle");
const { getSecurityConfig } = require("../settings");

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;

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
 * whether its own timestamp survived. That is the same discipline the money
 * paths use for a conditional claim: the condition lives in the write, so timing
 * cannot change the answer.
 *
 * ### Refused is not an error here
 *
 * Returns a verdict rather than throwing, because the caller has to decide what
 * the person is told — and telling them *"a code was already sent, check your
 * messages"* is better than an error, since in almost every case one really was.
 *
 * @param {string} target   phone number or email
 * @param {string} purpose  scoped, so login and bank-attach do not share an allowance
 * @returns {Promise<{allowed: boolean, at?: Date, retryAfterSeconds: number, reason?: string}>}
 *   `at` is the exact timestamp this call claimed — the caller needs it to give
 *   the slot back by value if the message then fails to send. Releasing by a
 *   time *range* would pull entries claimed by other callers in the same second.
 */
exports.claimOtpSend = async (target, purpose) => {
  const { otp: limits } = await getSecurityConfig();

  const now = new Date();
  const windowStart = new Date(now.getTime() - HOUR_MS);
  const cooldownCutoff = new Date(
    now.getTime() - limits.resendCooldownSeconds * SECOND_MS,
  );

  const row = await OtpThrottle.findOneAndUpdate(
    { target, purpose },
    [
      {
        // Roll the window forward first, so the count below is "the last hour"
        // rather than "since this row was made".
        $set: {
          sends: {
            $filter: {
              input: { $ifNull: ["$sends", []] },
              cond: { $gte: ["$$this", windowStart] },
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
                      { $lte: [{ $max: "$sends" }, cooldownCutoff] },
                    ],
                  },
                ],
              },
              { $concatArrays: ["$sends", [now]] },
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

  const sends = (row?.sends || []).map((d) => new Date(d).getTime());
  const allowed = sends.includes(now.getTime());

  if (allowed) return { allowed: true, at: now, retryAfterSeconds: 0 };

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
