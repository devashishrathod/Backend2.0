exports.calculateEndDate = (startDate, durationInYears, durationInDays) => {
  const endDate = new Date(startDate);
  if (durationInDays) {
    endDate.setDate(endDate.getDate() + (durationInDays - 1));
  } else if (durationInYears) {
    endDate.setFullYear(endDate.getFullYear() + durationInYears);
  } else {
    throw new Error("No valid duration found");
  }
  return endDate;
};
