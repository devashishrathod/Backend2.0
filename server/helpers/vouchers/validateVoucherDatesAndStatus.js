const { VOUCHER_STATUS } = require("../../constants");

const normalizeDate = (date) => {
  if (!date) return null;
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

exports.validateVoucherDatesAndStatus = (
  status,
  publishedDate,
  validFrom,
  validTill
) => {
  if (!status) return "Voucher status is required.";

  const today = normalizeDate(new Date());

  const pubDate = normalizeDate(publishedDate);
  const start = normalizeDate(validFrom);
  const end = normalizeDate(validTill);

  if (
    (pubDate && isNaN(pubDate)) ||
    (start && isNaN(start)) ||
    (end && isNaN(end))
  ) {
    return "One or more provided dates are invalid.";
  }

  if (start && end && end < start) {
    return "Valid till date must be after valid from date.";
  }

  switch (status) {
    case VOUCHER_STATUS.DRAFT:
      return null;

    case VOUCHER_STATUS.ACTIVE:
      if (!pubDate || pubDate > today)
        return "Active voucher must have published date today or in past.";
      if (!start || start > today)
        return "Active voucher must have valid from today or in past.";
      if (!end || end < today) return "Active voucher must not be expired.";
      return null;

    case VOUCHER_STATUS.UPCOMING:
      if (!pubDate || pubDate <= today)
        return "Upcoming voucher must have future published date.";
      if (!start || start <= today)
        return "Upcoming voucher must have future valid from.";
      if (!end || end <= start)
        return "Upcoming voucher must have valid till after valid from.";
      return null;

    case VOUCHER_STATUS.EXPIRED:
      if (!end || end >= today)
        return "Expired voucher must have valid till in the past.";
      return null;

    case VOUCHER_STATUS.USED_UP:
      return null;

    case VOUCHER_STATUS.COMPLETED:
      if (!end || end >= today)
        return "Completed vouchers must have valid till in the past.";
      return null;

    case VOUCHER_STATUS.DELETED:
      return null;

    default:
      return "Invalid voucher status.";
  }
};
