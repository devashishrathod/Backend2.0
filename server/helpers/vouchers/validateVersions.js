const VoucherVersion = require("../../models/VoucherVersion");
const VoucherApprovalHistory = require("../../models/VoucherApprovalHistory");

exports.getNextVersionNumber = async (voucherId, session) => {
  const lastVersion = await VoucherVersion.findOne({
    voucherId,
    isDeleted: false,
  })
    .sort({ versionNumber: -1 })
    .session(session)
    .select("versionNumber")
    .lean();
  return Number(lastVersion?.versionNumber || 0) + 1;
};

exports.createVoucherHistory = async ({
  voucher,
  version,
  action,
  performedBy,
  reason = null,
  metadata = null,
  session,
}) => {
  return VoucherApprovalHistory.create(
    [
      {
        voucherId: voucher._id,
        voucherVersionId: version._id,
        brandId: voucher.brandId,
        action,
        performedBy,
        versionNumber: version.versionNumber,
        voucherCode: voucher.voucherCode,
        versionCode: version.versionCode,
        reason,
        metadata,
      },
    ],
    { session },
  );
};
