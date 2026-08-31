const {
  VOUCHER_USAGE_TYPE,
  OFFER_REJECTION,
  offerBelowMinimum,
} = require("../../constants/voucher");
const { computeOfferDiscount } = require("./calculateVoucherPricing");

const sameId = (a, b) => String(a) === String(b);

/**
 * Which offer applies to this bill.
 *
 * Pure: no database, no clock beyond `now`, no config. The caller fetches the
 * version's offers and — if the customer is signed in — the ids of the
 * once-per-user offers they have already redeemed, then passes both in. That
 * keeps this testable against a table of cases and keeps the one DB round trip
 * where the caller can batch it.
 *
 * ### The discount is computed by `computeOfferDiscount`, not here
 *
 * Ranking and charging must agree. Two functions computing "what is this offer
 * worth" is exactly how a customer is shown one discount and charged another,
 * so both go through the same one.
 *
 * ### Nobody choosing is the normal case
 *
 * Without an explicit `offerId` the best offer wins, and if none fits, that is a
 * priced outcome rather than an error: the customer pays their bill. An offer
 * that does not fit is simply not chosen — no reason is reported, because
 * explaining an offer they never asked for is noise.
 *
 * ### Naming one changes that
 *
 * A customer who taps a specific offer has made a choice, and silently giving
 * them a different one — or none — would be worse than telling them why. So an
 * explicitly named offer that cannot apply comes back with `offerApplied: false`
 * **and a reason**, and no substitute is chosen for them.
 *
 * ### Once-per-user offers they have already used are hidden
 *
 * Not filtered at claim time by the database index alone. The index is the
 * guarantee, but if preview still showed the offer, the customer would see a
 * price they cannot get and hit a 409 at payment. Excluding it here means the
 * quote they see is the quote they can pay.
 *
 * @param {object}   args
 * @param {Array}    args.offers          embedded `VoucherVersion.offers`
 * @param {number}   args.billAmount
 * @param {string}   [args.offerId]       the customer's explicit choice
 * @param {Array}    [args.usedOfferIds]  once-per-user offers already redeemed
 * @param {Date}     [args.now]
 * @param {string}   [args.currencySymbol]
 * @returns {{ offer, offerApplied, eligibleOffers, reason }}
 */
exports.resolveClaimOffer = ({
  offers = [],
  billAmount,
  offerId = null,
  usedOfferIds = [],
  now = new Date(),
  currencySymbol = "₹",
}) => {
  const amount = Number(billAmount) || 0;
  const used = new Set(usedOfferIds.map(String));

  const list = Array.isArray(offers) ? offers.filter(Boolean) : [];

  /**
   * Why one offer cannot apply, or null if it can.
   *
   * Order matters: "already used" is checked before "bill too small", because a
   * customer who has spent this offer should be told that rather than be sent to
   * raise their bill for an offer they can never use again.
   */
  const disqualify = (offer) => {
    if (offer.isDeleted === true || offer.isActive === false) {
      return OFFER_REJECTION.INACTIVE;
    }
    // Offers carry no window of their own — the version's `startAt`/`endAt`
    // governs, and the caller has already matched on it. Checked anyway because
    // the field is cheap to add later and a silent miss here would be a live
    // offer applied past its end date.
    if (offer.startAt && new Date(offer.startAt) > now) {
      return OFFER_REJECTION.INACTIVE;
    }
    if (offer.endAt && new Date(offer.endAt) <= now) {
      return OFFER_REJECTION.INACTIVE;
    }
    if (
      offer.usageType === VOUCHER_USAGE_TYPE.ONCE_PER_USER &&
      used.has(String(offer._id))
    ) {
      return OFFER_REJECTION.ALREADY_USED;
    }
    if (amount < (Number(offer.minBillAmount) || 0)) {
      return offerBelowMinimum(offer.minBillAmount, currencySymbol);
    }
    if (computeOfferDiscount(offer, amount) <= 0) {
      return OFFER_REJECTION.NO_DISCOUNT;
    }
    return null;
  };

  /** The shape a checkout renders in its "other offers" list. */
  const describe = (offer) => ({
    offerId: offer._id,
    title: offer.title || null,
    discountType: offer.discountType,
    discountValue: offer.discountValue,
    minBillAmount: Number(offer.minBillAmount) || 0,
    maxDiscountAmount: offer.maxDiscountAmount ?? null,
    usageType: offer.usageType ?? null,
    discountApplicableOn: offer.discountApplicableOn ?? null,
    discountAmount: computeOfferDiscount(offer, amount),
    finalAmount: Number((amount - computeOfferDiscount(offer, amount)).toFixed(2)),
  });

  const eligible = list.filter((offer) => disqualify(offer) === null);

  /**
   * Best discount wins; a tie goes to the higher minimum.
   *
   * The tie-break matters: two offers worth the same amount are not equally
   * good to the vendor, and the one with the higher spend requirement is the one
   * the customer has already earned.
   */
  const ranked = eligible
    .map(describe)
    .sort((a, b) =>
      b.discountAmount !== a.discountAmount
        ? b.discountAmount - a.discountAmount
        : b.minBillAmount - a.minBillAmount,
    );

  // ---------- the customer named one ----------
  if (offerId) {
    const chosen = list.find((offer) => sameId(offer._id, offerId));
    if (!chosen) {
      return {
        offer: null,
        offerApplied: false,
        eligibleOffers: ranked,
        reason: OFFER_REJECTION.NOT_FOUND,
      };
    }

    const reason = disqualify(chosen);
    if (reason) {
      // No substitute. They chose; quietly pricing a different offer would mean
      // the screen and the charge disagree about what they bought.
      return { offer: null, offerApplied: false, eligibleOffers: ranked, reason };
    }

    return {
      offer: chosen,
      offerApplied: true,
      eligibleOffers: ranked,
      reason: null,
    };
  }

  // ---------- nobody chose ----------
  if (!ranked.length) {
    return {
      offer: null,
      offerApplied: false,
      eligibleOffers: [],
      // Not a rejection: the bill is simply below every minimum, or the voucher
      // has no usable offers. The customer pays their bill.
      reason: null,
    };
  }

  const best = list.find((offer) => sameId(offer._id, ranked[0].offerId));
  return { offer: best, offerApplied: true, eligibleOffers: ranked, reason: null };
};
