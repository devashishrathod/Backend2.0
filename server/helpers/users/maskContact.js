/**
 * Masking for a contact we are about to say we sent something to.
 *
 * ### Why mask at all
 *
 * "We sent a code to a***a@gmail.com" tells the right person which address to go
 * and check, and tells anyone who has stolen the session nothing they did not
 * already have. Echoing the full address back turns a confirmation message into
 * a disclosure — and on the flows these are used for (attaching a bank account,
 * verifying an email) the caller is not always proven to be the owner yet.
 *
 * ### Why they live here rather than beside their first caller
 *
 * Both of these were local `const`s inside
 * `services/customerBankAccounts/sendBankOtp.js`. The email-verification flow
 * needs exactly the same two, and copying them is how two surfaces start
 * disagreeing about how much of an address is safe to show — silently, because
 * neither copy is wrong on its own.
 */

/**
 * Everything but the first two characters of the local part, and the domain.
 *
 * The domain is deliberately left intact: it is what actually helps somebody
 * work out *which* of their addresses this is, and it is rarely the secret.
 *
 * A local part of two characters or fewer masks to nothing extra rather than
 * going negative — `String.repeat` throws on a negative count, which would turn
 * a helpful message into a 500.
 */
const maskEmail = (email) => {
  const [local = "", domain = ""] = String(email || "").split("@");
  const shown = local.slice(0, 2);
  return `${shown}${"*".repeat(Math.max(0, local.length - 2))}@${domain}`;
};

/** Every digit but the last four. */
const maskPhone = (phone) => String(phone || "").replace(/\d(?=\d{4})/g, "*");

module.exports = { maskEmail, maskPhone };
