const { getSetting } = require("../../helpers/settings");

exports.updateSetting = async (userId, payload = {}) => {
  const setting = await getSetting();

  if (payload.vendor?.voucher) {
    Object.assign(setting.vendor.voucher, payload.vendor.voucher);
  }
  if (payload.vendor?.showcase) {
    Object.assign(setting.vendor.showcase, payload.vendor.showcase);
  }
  if (typeof payload.isActive === "boolean") {
    setting.isActive = payload.isActive;
  }
  setting.updatedBy = userId;

  await setting.save();
  return setting;
};
