const jwt = require("jsonwebtoken");
require("dotenv").config();
const { throwError } = require("../utils");
const { getUserById } = require("../service/userServices");

exports.generateToken = async (checkUser) => {
  return jwt.sign(
    {
      _id: checkUser?._id,
      name: checkUser?.name,
      email: checkUser?.email,
      whatsappNumber: checkUser?.whatsappNumber,
      address: checkUser?.address,
      role: checkUser?.role,
    },
    process.env.SECRET_KEY,
    { expiresIn: "7d" }
  );
};

exports.verifyToken = async (req, res, next) => {
  try {
    const token = req.headers["authorization"];
    if (!token) {
      throwError(401, "Access Denied! No token provided.");
    }
    const splitToken = token.split(" ")[1];
    if (!splitToken) {
      throwError(401, "Access Denied! Invalid token format.");
    }
    const decodedToken = jwt.verify(splitToken, process.env.SECRET_KEY);
    if (!decodedToken) {
      throwError(401, "Access Denied! Invalid token.");
    }
    const checkUser = await getUserById(decodedToken?._id);
    if (!checkUser) {
      throwError(401, "Access Denied! User not found.");
    }
    req.payload = checkUser;
    next();
  } catch (error) {
    console.log("error on auth:", error);
    if (error.name === "TokenExpiredError") {
      return next(throwError(401, "Session expired. Please log in again."));
    }
    if (error.name === "JsonWebTokenError") {
      return next(throwError(401, "Invalid token. Please log in again."));
    }
    if (error.name === "NotBeforeError") {
      return next(
        throwError(401, "Token not active yet. Please try again later.")
      );
    }
    return next(throwError(500, error.message || "Internal Server Error"));
  }
};

exports.checkRole = (...allowedRoles) => {
  return (req, res, next) => {
    const user = req.payload;
    if (!user || !allowedRoles.includes(user.role)) {
      return next(
        throwError(
          403,
          "Forbidden: You do not have permission to perform this action."
        )
      );
    }
    next();
  };
};
