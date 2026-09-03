const Customer = require("../../models/Customer");
const { sendOtp } = require("../otps");
const { throwError } = require("../../utils");
const { LOGIN_TYPES } = require("../../constants");
const { BANK_ATTACH_OTP_PURPOSE } = require("../../constants/customer");
const { resolveCustomerId } = require("../../helpers/customers");

/**
 * Where a bank-attach code is sent, and how.
 *
 * WhatsApp first because that is how most of these customers signed up, then
 * email. ⚠️ Never the plain `mobile` field: `sendOtp` only speaks WhatsApp and
 * email, and asking it for `MOBILE` throws a `401 Invalid login type` — which
 * would read to the customer as "you are not logged in" at the exact moment
 * they are trying to get their own money back.
 */
const channelFor = (customer) => {
  if (customer?.whatsappNumber) {
    return { type: LOGIN_TYPES.WHATSAPP, target: customer.whatsappNumber };
  }
  if (customer?.email) {
    return { type: LOGIN_TYPES.EMAIL, target: customer.email };
  }
  return null;
};

/** Everything but the last two characters of the local part, and the domain. */
const maskEmail = (email) => {
  const [local = "", domain = ""] = String(email).split("@");
  const shown = local.slice(0, 2);
  return `${shown}${"*".repeat(Math.max(0, local.length - 2))}@${domain}`;
};

const maskPhone = (phone) => String(phone).replace(/\d(?=\d{4})/g, "*");

/**
 * Send the one-time code that gates attaching a bank account.
 *
 * ### Why a bank account is worth an OTP at all
 *
 * Adding one decides **where money goes**. Anyone holding a live session could
 * otherwise point a pending refund at their own account, and the customer would
 * find out when it did not arrive — by which time a NEFT has settled and cannot
 * be recalled. Login is the wrong strength of gate for that.
 *
 * It gates the **attach**, not each refund: asking again for every payout would
 * put a code in front of someone whose refund has already failed once, which is
 * friction spent on a risk that was already taken at attach time.
 */
exports.sendBankOtp = async (actor) => {
  const customerId = resolveCustomerId(actor);

  const customer = await Customer.findOne({
    _id: customerId,
    isDeleted: false,
  })
    .select("whatsappNumber email fullName")
    .lean();

  if (!customer) throwError(404, "Customer not found.");

  const channel = channelFor(customer);
  if (!channel) {
    /**
     * Deliberately a dead end with a route out rather than a silent failure:
     * without a reachable channel there is no safe way to confirm it is really
     * them, and the alternative — skipping the check — is how a refund ends up
     * in a stranger's account.
     */
    throwError(
      422,
      "We have no WhatsApp number or email on file to send a code to. " +
        "Please contact support to add your bank details.",
    );
  }

  await sendOtp(channel.type, channel.target, BANK_ATTACH_OTP_PURPOSE);

  return {
    sentTo:
      channel.type === LOGIN_TYPES.EMAIL
        ? maskEmail(channel.target)
        : maskPhone(channel.target),
    channel: channel.type,
  };
};
