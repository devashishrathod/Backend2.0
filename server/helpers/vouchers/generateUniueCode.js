const Counter = require("../../models/Counter");
const VOUCHER_COUNTER_KEY = "VOUCHER";
const { throwError } = require("../../utils");

exports.generateVoucherCode = async (session = null) => {
  const options = {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  };
  if (session) options.session = session;
  const counter = await Counter.findOneAndUpdate(
    { _id: VOUCHER_COUNTER_KEY },
    { $inc: { sequence: 1 } },
    options,
  );
  if (!counter) throwError(400, "Unable to generate voucher sequence.");
  const voucherCode = `VCH-${String(counter.sequence).padStart(8, "0")}`;
  return { voucherCode, sequence: counter.sequence };
};

exports.generateVoucherVersionCode = (voucherCode, versionNumber) => {
  return `${voucherCode}-V${versionNumber}`;
};
