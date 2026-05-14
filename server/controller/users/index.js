const { userProfileComplete } = require("../../controller/users/updateUser");
// const { logout } = require("./logout");
const { changeLoginMobileNumber } = require("./changeLoginMobileNumber");
const { verifyChangeMobile } = require("./verifyChangeMobile");
const { getAllUsers } = require("./getAllUsers");

module.exports = {
  userProfileComplete,
  // logout,
  changeLoginMobileNumber,
  verifyChangeMobile,
  getAllUsers,
};
