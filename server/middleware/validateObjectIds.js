const mongoose = require("mongoose");
const { sendError } = require("../utils");

exports.validateObjectIds = (paramKeys = []) => {
  return (req, res, next) => {
    for (const key of paramKeys) {
      const value = req.params[key];
      if (!mongoose.Types.ObjectId.isValid(value)) {
        return sendError(res, 400, `Invalid ${key}`);
      }
    }
    next();
  };
};
