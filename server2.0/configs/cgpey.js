const axios = require("axios");

const cgpeyClient = axios.create({
  baseURL: process.env.CGPEY_BASE_URL,
  timeout: Number(process.env.CGPEY_TIMEOUT) || 30000,
});

module.exports = cgpeyClient;
