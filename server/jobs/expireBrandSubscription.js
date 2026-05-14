const cron = require("node-cron");
const Subscribed = require("../model/Subscribed");
const User = require("../model/User");
const Brand = require("../model/Brand");

cron.schedule("0 0 * * *", async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiringSubscriptions = await Subscribed.find({
      endDate: { $lte: today },
      isExpire: false,
    });
    if (!expiringSubscriptions.length) {
      console.log(
        `[${new Date().toISOString()}] No subscriptions expired today.`
      );
      return;
    }
    const expiredIds = expiringSubscriptions.map((sub) => sub._id);
    await Subscribed.updateMany(
      { _id: { $in: expiredIds } },
      { $set: { isExpire: true, isActive: false } }
    );
    for (const sub of expiringSubscriptions) {
      if (sub.user) {
        await User.findByIdAndUpdate(sub.user, { isSubscribed: false });
      }
      if (sub.brand) {
        await Brand.findByIdAndUpdate(sub.brand, { isSubscribed: false });
      }
    }
    console.log(
      `[${new Date().toISOString()}] Subscriptions expired: ${
        expiredIds.length
      }`
    );
  } catch (error) {
    console.error("Error in cron job for expiring subscriptions:", error);
  }
});
