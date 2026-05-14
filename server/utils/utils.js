const isPopulated = (ref) => {
  return ref && typeof ref === "object" && "_id" in ref;
};

exports.calculateProfileCompletion = (user) => {
  const fieldsToCheck = [
    user?.name,
    user?.email,
    user?.mobile,
    user?.dob,
    user?.address,
    user?.fcmToken,
    user?.referCode,
    user?.instagram?.isLinked,
    user?.facebook?.isLinked,
    user?.twitter?.isLinked,
    user?.linkedIn?.isLinked,
    user?.location,
    // user?.gst,
    // user?.bankAccount,
    // user?.workHour,
    user?.isMobileVerify === true,
    // isPopulated(user?.location),
  ];

  const filledFields = fieldsToCheck.filter((field) => {
    // Check if the field has a value
    if (typeof field === "boolean") return field === true;
    return field !== null && field !== undefined && field !== "";
  });

  const percentage = Math.round(
    (filledFields.length / fieldsToCheck.length) * 100
  );
  return percentage;
};
