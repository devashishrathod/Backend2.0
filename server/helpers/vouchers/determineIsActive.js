const { VOUCHER_STATUS } = require("../../constants");

exports.determineIsActive = (status) => {
  const inActiveStatuses = [
    VOUCHER_STATUS.DRAFT,
    VOUCHER_STATUS.COMPLETED,
    VOUCHER_STATUS.EXPIRED,
    VOUCHER_STATUS.USED_UP,
    VOUCHER_STATUS.UPCOMING,
    VOUCHER_STATUS.DELETED,
  ];
  return !inActiveStatuses.includes(status);
};
