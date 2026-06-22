require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const ngrok = require("ngrok");
const fileUpload = require("express-fileupload");

const { mongoDb } = require("./database/mongoDb");
const { errorHandler } = require("./middlewares");
const { throwError } = require("./utils");
const allRoutes = require("./routes");
const { getIP } = require("./configs/render");

const app = express();
const port = process.env.PORT || 8080;

app.use(fileUpload({ useTempFiles: true, tempFileDir: "/tmp/" }));
app.use(express.json());
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
  if (process.env.ENABLE_NGROK === "true") {
    const url = await ngrok.connect({
      addr: port,
      authtoken: process.env.NGROK_AUTH_TOKEN,
      // subdomain: process.env.NGROK_SUBDOMAIN // must be set for custom subdomain
    });
    console.log(`Public URL: ${url}`);
  }
});
