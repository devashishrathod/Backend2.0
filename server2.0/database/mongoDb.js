const mongoose = require("mongoose");
const dns = require("dns");
const dotenv = require("dotenv");
dotenv.config();

exports.mongoDb = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log("✅ Trydood 2.0 MongoDb connection established");
  } catch (error) {
    if (error.code === "ECONNREFUSED" && error.syscall === "querySrv") {
      console.log("⚠️ SRV DNS failed; retrying with public DNS...");
      dns.setServers(["8.8.8.8", "1.1.1.1"]);
      try {
        await mongoose.connect(process.env.MONGO_URL);
        console.log("✅ Trydood 2.0 MongoDb connection established (fallback)");
      } catch (fallbackError) {
        console.log("❌ Fallback also failed:", fallbackError?.message);
      }
    } else {
      console.log("❌ Error connecting to mongoDB:", error?.message);
    }
  }
};
