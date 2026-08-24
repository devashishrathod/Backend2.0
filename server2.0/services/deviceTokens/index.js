const { registerDeviceToken } = require("./registerDeviceToken");
const { unregisterDeviceToken } = require("./unregisterDeviceToken");
const { getMyDevices } = require("./getMyDevices");
const { sendTestPush } = require("./sendTestPush");

module.exports = {
  registerDeviceToken,
  unregisterDeviceToken,
  getMyDevices,
  sendTestPush,
};
