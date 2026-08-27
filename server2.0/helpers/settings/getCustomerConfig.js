const { getSetting } = require("./getSetting");
const { CONVENIENCE_FEE_DEFAULTS } = require("../../constants/customer");

// DB config (Setting.customer) always wins; the constants only kick in as a
// last-resort fallback if the singleton Setting doc somehow lacks a value.
exports.getCustomerConfig = async () => {
  const setting = await getSetting();
  const fee = setting?.customer?.convenienceFee || {};

  return {
    convenienceFee: {
      isEnabled: fee.isEnabled ?? CONVENIENCE_FEE_DEFAULTS.isEnabled,
      slabSize: fee.slabSize ?? CONVENIENCE_FEE_DEFAULTS.slabSize,
      feePerSlab: fee.feePerSlab ?? CONVENIENCE_FEE_DEFAULTS.feePerSlab,
      // `?? null` rather than `|| null` so an explicit 0 ceiling survives.
      maxFee: fee.maxFee ?? CONVENIENCE_FEE_DEFAULTS.maxFee,
    },
  };
};
