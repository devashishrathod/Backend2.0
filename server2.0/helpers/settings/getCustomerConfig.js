const { getSetting } = require("./getSetting");
const {
  CONVENIENCE_FEE_DEFAULTS,
  CUSTOMER_TAX_DEFAULTS,
  CUSTOMER_PROMO_DEFAULTS,
  CLAIM_DEFAULTS,
  CUSTOMER_NOTIFICATION_DEFAULTS,
  CUSTOMER_INVOICE_DEFAULTS,
  SETTLEMENT_DEFAULTS,
  REFUND_DEFAULTS,
  CHARGEBACK_DEFAULTS,
  CUSTOMER_CURRENCY_DEFAULTS,
} = require("../../constants/customer");

/**
 * Everything the customer-facing flows are allowed to vary by admin.
 *
 * DB config (`Setting.customer`) always wins; the constants only kick in as a
 * last-resort fallback if the singleton Setting doc lacks a value — which it
 * will for any block added after the doc was created, since a Mongoose default
 * applies on write only.
 *
 * `??` and not `||` throughout: `0` is legitimate for `commissionPercent`,
 * `vendorPlanExpiredGraceDays` and every buffer, and `false` is legitimate for
 * every flag.
 *
 * ⚠️ `maxFee` is read with an explicit `undefined` check rather than `??`. It is
 * the one value where `null` is a deliberate choice meaning "no ceiling", and
 * `??` would quietly replace that with the default and start capping a fee the
 * admin had decided not to cap.
 */
exports.getCustomerConfig = async () => {
  const setting = await getSetting();
  const c = setting?.customer || {};

  const fee = c.convenienceFee || {};
  const tax = c.tax || {};
  const promo = c.promoCode || {};
  const claim = c.claim || {};
  const notification = c.notification || {};
  const invoice = c.invoice || {};
  const settlement = c.settlement || {};
  const reserve = settlement.reserve || {};
  const refund = c.refund || {};
  const chargeback = c.chargeback || {};

  return {
    convenienceFee: {
      isEnabled: fee.isEnabled ?? CONVENIENCE_FEE_DEFAULTS.isEnabled,
      slabSize: fee.slabSize ?? CONVENIENCE_FEE_DEFAULTS.slabSize,
      feePerSlab: fee.feePerSlab ?? CONVENIENCE_FEE_DEFAULTS.feePerSlab,
      maxFee:
        fee.maxFee === undefined ? CONVENIENCE_FEE_DEFAULTS.maxFee : fee.maxFee,
      chargeWhenNoOffer:
        fee.chargeWhenNoOffer ?? CONVENIENCE_FEE_DEFAULTS.chargeWhenNoOffer,
    },

    tax: {
      isGstEnabled: tax.isGstEnabled ?? CUSTOMER_TAX_DEFAULTS.isGstEnabled,
      gstPercentage: tax.gstPercentage ?? CUSTOMER_TAX_DEFAULTS.gstPercentage,
      isGstInclusive:
        tax.isGstInclusive ?? CUSTOMER_TAX_DEFAULTS.isGstInclusive,
      sacCode: tax.sacCode || CUSTOMER_TAX_DEFAULTS.sacCode,
    },

    promoCode: {
      isEnabled: promo.isEnabled ?? CUSTOMER_PROMO_DEFAULTS.isEnabled,
      allowWhenNoOffer:
        promo.allowWhenNoOffer ?? CUSTOMER_PROMO_DEFAULTS.allowWhenNoOffer,
      allowForGuestPreview:
        promo.allowForGuestPreview ??
        CUSTOMER_PROMO_DEFAULTS.allowForGuestPreview,
    },

    claim: {
      isEnabled: claim.isEnabled ?? CLAIM_DEFAULTS.isEnabled,
      allowWhenNoOffer:
        claim.allowWhenNoOffer ?? CLAIM_DEFAULTS.allowWhenNoOffer,
      maxBillAmount: claim.maxBillAmount ?? CLAIM_DEFAULTS.maxBillAmount,
      pendingOrderReuseMinutes:
        claim.pendingOrderReuseMinutes ?? CLAIM_DEFAULTS.pendingOrderReuseMinutes,
      quoteTtlMinutes: claim.quoteTtlMinutes ?? CLAIM_DEFAULTS.quoteTtlMinutes,
      allowWhenVendorPlanExpired:
        claim.allowWhenVendorPlanExpired ??
        CLAIM_DEFAULTS.allowWhenVendorPlanExpired,
      vendorPlanExpiredGraceDays:
        claim.vendorPlanExpiredGraceDays ??
        CLAIM_DEFAULTS.vendorPlanExpiredGraceDays,
      redemptionWindowHours:
        claim.redemptionWindowHours ?? CLAIM_DEFAULTS.redemptionWindowHours,
    },

    notification: {
      isEmailNotificationEnabled:
        notification.isEmailNotificationEnabled ??
        CUSTOMER_NOTIFICATION_DEFAULTS.isEmailNotificationEnabled,
      isPushNotificationEnabled:
        notification.isPushNotificationEnabled ??
        CUSTOMER_NOTIFICATION_DEFAULTS.isPushNotificationEnabled,
      isWhatsAppNotificationEnabled:
        notification.isWhatsAppNotificationEnabled ??
        CUSTOMER_NOTIFICATION_DEFAULTS.isWhatsAppNotificationEnabled,
    },

    invoice: {
      seriesPrefix:
        invoice.seriesPrefix || CUSTOMER_INVOICE_DEFAULTS.seriesPrefix,
    },

    settlement: {
      isEnabled: settlement.isEnabled ?? SETTLEMENT_DEFAULTS.isEnabled,
      delayDays: settlement.delayDays ?? SETTLEMENT_DEFAULTS.delayDays,
      payoutBufferHours:
        settlement.payoutBufferHours ?? SETTLEMENT_DEFAULTS.payoutBufferHours,
      cycleType: settlement.cycleType || SETTLEMENT_DEFAULTS.cycleType,
      requiresAdminApproval:
        settlement.requiresAdminApproval ??
        SETTLEMENT_DEFAULTS.requiresAdminApproval,
      minPayoutAmount:
        settlement.minPayoutAmount ?? SETTLEMENT_DEFAULTS.minPayoutAmount,
      payoutProvider:
        settlement.payoutProvider || SETTLEMENT_DEFAULTS.payoutProvider,
      commissionPercent:
        settlement.commissionPercent ?? SETTLEMENT_DEFAULTS.commissionPercent,
      reserve: {
        isEnabled: reserve.isEnabled ?? SETTLEMENT_DEFAULTS.reserve.isEnabled,
        percent: reserve.percent ?? SETTLEMENT_DEFAULTS.reserve.percent,
        holdDays: reserve.holdDays ?? SETTLEMENT_DEFAULTS.reserve.holdDays,
        riskChargebackCount:
          reserve.riskChargebackCount ??
          SETTLEMENT_DEFAULTS.reserve.riskChargebackCount,
      },
      newVendorReserveDays:
        settlement.newVendorReserveDays ??
        SETTLEMENT_DEFAULTS.newVendorReserveDays,
      notReceivedAlertHours:
        settlement.notReceivedAlertHours ??
        SETTLEMENT_DEFAULTS.notReceivedAlertHours,
      gatewayFeeBearer:
        settlement.gatewayFeeBearer || SETTLEMENT_DEFAULTS.gatewayFeeBearer,
    },

    refund: {
      method: refund.method || REFUND_DEFAULTS.method,
      windowHours: refund.windowHours ?? REFUND_DEFAULTS.windowHours,
      vendorApprovalHours:
        refund.vendorApprovalHours ?? REFUND_DEFAULTS.vendorApprovalHours,
      adminBufferHours:
        refund.adminBufferHours ?? REFUND_DEFAULTS.adminBufferHours,
      onVendorTimeout:
        refund.onVendorTimeout || REFUND_DEFAULTS.onVendorTimeout,
      allowPartial: refund.allowPartial ?? REFUND_DEFAULTS.allowPartial,
      releasePromoOnRefund:
        refund.releasePromoOnRefund ?? REFUND_DEFAULTS.releasePromoOnRefund,
      authorizedAlertMinutes:
        refund.authorizedAlertMinutes ?? REFUND_DEFAULTS.authorizedAlertMinutes,
    },

    chargeback: {
      writeOffDays: chargeback.writeOffDays ?? CHARGEBACK_DEFAULTS.writeOffDays,
    },

    // Not admin-configurable. Here so a customer-facing string never has to
    // reach into the vendor config or hardcode the symbol.
    currency: CUSTOMER_CURRENCY_DEFAULTS.currency,
    currencySymbol: CUSTOMER_CURRENCY_DEFAULTS.currencySymbol,
  };
};
