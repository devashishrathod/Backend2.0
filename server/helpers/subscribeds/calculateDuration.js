// exports.calculateDuration = (endDate) => {
//   const today = new Date();
//   const currentEndDate = new Date(endDate);
//   let remainingYears = 0;
//   let remainingDays = 0;
//   if (currentEndDate > today) {
//     const diffMs = currentEndDate.getTime() - today.getTime();
//     const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
//     remainingYears = Math.floor(diffDays / 365);
//     remainingDays = diffDays % 365;
//   }
//   return { remainingYears, remainingDays };
// };

exports.calculateDuration = (endDate) => {
  const today = new Date();
  const currentEndDate = new Date(endDate);
  let remainingYears = 0;
  let remainingDays = 0;
  if (currentEndDate > today) {
    let start = new Date(today);
    let end = new Date(currentEndDate);
    // Calculate full years
    while (
      new Date(start.getFullYear() + 1, start.getMonth(), start.getDate()) <=
      end
    ) {
      start.setFullYear(start.getFullYear() + 1);
      remainingYears++;
    }
    // Calculate remaining days
    const diffMs = end.getTime() - start.getTime();
    remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }
  return { remainingYears, remainingDays };
};
