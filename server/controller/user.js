const User = require("../model/User");
const Location = require("../model/Location");
const { calculateProfileCompletion } = require("../utils/utils");

exports.userProfile = async (req, res) => {
  const id = req.payload?._id;
  const { userId } = req.query;
  try {
    let userIdToFetch = userId || id;
    let user = await User.findById(userIdToFetch)
      .select("+email +dob +whatsappNumber +transaction +address")
      .populate("location bankAccount");
    if (!user) {
      return res.status(404).json({ success: false, msg: "User not found" });
    }
    const completion = calculateProfileCompletion(user);
    return res.status(200).json({
      success: true,
      msg: "User details",
      user,
      completion,
    });
  } catch (error) {
    console.log("error on userProfile: ", error);
    return res.status(500).json({
      success: false,
      msg: error.message,
      error,
    });
  }
};

exports.userProfileComplete = async (req, res) => {
  const id = req.payload?._id;
  const name = req.body?.name;
  const email = req.body?.email;
  const address = req.body?.address;
  const dob = req.body?.dob;
  const appliedReferalCode = req.body?.referCode;
  const lat = req.body?.lat;
  const lng = req.body?.lng;
  const city = req.body?.city;
  const state = req.body?.state;
  const country = req.body?.country;
  const postalCode = req.body?.postalCode;
  const formattedAddress = req.body?.formattedAddress;
  const street = req.body?.street;
  const landMark = req.body?.landMark;

  try {
    const checkUser = await User.findById(id);
    if (!checkUser) {
      return res.status(400).json({ success: false, msg: "User not found!" });
    }
    let checkLocation = await Location.findOne({ user: id });
    if (!checkLocation) {
      const location = new Location({
        user: id,
        name,
        address,
        location: {
          type: "Point",
          coordinates: [lng, lat], // Order: [longitude, latitude]
        },
        city,
        state,
        country,
        postalCode,
        formattedAddress,
        street,
        landMark,
      });
      checkUser.location = location._id;
      await location.save();
    } else {
      checkLocation = new Location({
        user: id,
        name,
        address,
        location: {
          type: "Point",
          coordinates: [lng, lat], // Order: [longitude, latitude]
        },
        city,
        state,
        country,
        postalCode,
        formattedAddress,
        street,
        landMark,
      });
      checkUser.location = checkLocation._id;
      await checkLocation.save();
    }
    if (name) checkUser.name = name;
    if (email) checkUser.email = email;
    if (address) checkUser.address = address;
    if (dob) checkUser.dob = dob;
    if (req.body?.isFirst) {
      if (appliedReferalCode) checkUser.appliedReferalCode = appliedReferalCode;
    }
    await checkUser.save();
    return res.status(200).json({
      success: true,
      msg: "Profile updated successfully",
      result: checkUser,
    });
  } catch (error) {
    console.log("error on userProfileComplete: ", error);
    return res
      .status(500)
      .json({ error: error, success: false, msg: error.message });
  }
};
