exports.generateReferralCode = (roud) => {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let referralCode = "";
  for (let i = 0; i < roud; i++) {
    referralCode += characters.charAt(
      Math.floor(Math.random() * characters.length)
    );
  }
  return referralCode;
};

exports.getEndDate = (startDate, durationInMonths) => {
  const start = new Date(startDate);
  const end = new Date(start);
  end.setMonth(end.getMonth() + durationInMonths);
  return end;
};
