const axios = require("axios");

exports.getIP = async (req, res) => {
  try {
    const response = await axios.get("https://api.ipify.org?format=json");
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
