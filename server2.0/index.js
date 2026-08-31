require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const ngrok = require("ngrok");
const fileUpload = require("express-fileupload");

const { mongoDb } = require("./database/mongoDb");
const { errorHandler } = require("./middlewares");
const { logChannelStatus } = require("./helpers/notifications");
const { logPaymentAccounts, assertMoneyIndexes } = require("./helpers/transactions");
const { throwError } = require("./utils");
const allRoutes = require("./routes");
const { getIP } = require("./configs/render");
const { startJobs } = require("./jobs");

const app = express();
const port = process.env.PORT || 8080;

app.use(fileUpload({ useTempFiles: true, tempFileDir: "/tmp/" }));
// The raw bytes are kept alongside the parsed body because Razorpay signs the
// untouched payload — re-serialised JSON would not match the HMAC. Only the
// webhook route reads `req.rawBody`; everything else is unaffected.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      if (buf?.length) req.rawBody = buf;
    },
  }),
);
app.use(cors());
app.use(morgan("dev"));
app.use("/trydood/v1", allRoutes);
app.get("/", async (req, res) => {
  res.send("Welcome to Trydood 2.0🚀");
});
app.get("/my-ip", getIP);
app.get("/client-ip", (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  res.json({ ip });
});
app.use((req, res, next) => {
  throwError(404, "Invalid API");
});
app.use(errorHandler);

mongoDb();

app.listen(port, async () => {
  console.log(`✅ Trydood 2.0 Server running on http://localhost:${port}`);
  // Which notification channels can actually deliver. Answers "did my env
  // var take effect?" without an endpoint, and logs no credentials.
  logChannelStatus();
  // Same question for the two Razorpay accounts: keys present, test or live,
  // and whether each one can verify a webhook at all. A missing webhook secret
  // is otherwise invisible until a payment is captured and never settles.
  logPaymentAccounts();
  // Background sweeps (subscription + voucher expiry). Started after the
  // listener so a slow first run never delays the port binding, and never
  // allowed to take the process down. Disable with ENABLE_JOBS=false.
  // Are the money indexes the ones this build expects? A blanket unique index
  // where a partial one belongs rejects the second row that has no value yet,
  // and it is invisible until a real payment hits it. Reports only — nothing is
  // dropped automatically. See helpers/transactions/assertMoneyIndexes.js.
  assertMoneyIndexes().catch((error) =>
    console.error("[idx] index check failed:", error?.message),
  );
  startJobs().catch((error) =>
    console.error("❌ [jobs] failed to start:", error?.message),
  );
  if (process.env.ENABLE_NGROK === "true") {
    const url = await ngrok.connect({
      addr: port,
      authtoken: process.env.NGROK_AUTH_TOKEN,
      // subdomain: process.env.NGROK_SUBDOMAIN // must be set for custom subdomain
    });
    console.log(`Public URL: ${url}`);
  }
});
