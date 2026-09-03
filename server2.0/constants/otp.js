/**
 * How often a one-time code may be sent to the same place.
 *
 * ### Why there has to be a limit at all
 *
 * `sendOtp` had none. Anybody could post someone else's number to a public login
 * route as fast as they liked, and every one of those turned into a WhatsApp
 * message or an SMS **we pay for** — landing on a phone belonging to a person
 * who never asked for any of it. Cost and harassment from the same hole.
 *
 * ### Why these numbers
 *
 * Keyed on the **target**, not the caller's IP. Indian mobile networks put
 * thousands of real customers behind one CGNAT address, so an IP limit here
 * would lock out a whole block of people while barely inconveniencing an
 * attacker with a phone. A number or an email address is a person.
 *
 * `60` seconds is longer than a WhatsApp or SMS normally takes to arrive (5–10s)
 * and short enough that a customer whose message genuinely got stuck does not
 * conclude the app is broken and ring support.
 *
 * `5` an hour covers a bad network — retry, retry, switch from WhatsApp to
 * email — and still caps what a flood can cost, in money and in nuisance.
 *
 * ⚠️ These are only the **fallback**. `Setting.security.otp` wins when it is
 * set, so the numbers can be tuned from the admin panel without a deploy.
 */
const OTP_DEFAULTS = Object.freeze({
  resendCooldownSeconds: 60,
  maxPerHour: 5,
});

/**
 * How long a throttle row outlives its window.
 *
 * ⚠️ Comfortably longer than an hour. The TTL monitor runs about once a minute
 * and deletes on `updatedAt`, so a row expiring exactly at the window edge could
 * vanish while its last sends still counted — handing the next caller a clean
 * slate and, with it, five more messages.
 */
const OTP_THROTTLE_TTL_SECONDS = 2 * 60 * 60;

module.exports = { OTP_DEFAULTS, OTP_THROTTLE_TTL_SECONDS };
