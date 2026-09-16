const { CustomError, sendError } = require("../utils");

exports.errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  // ⭐ Handle Mongoose Validation Error (clean message)
  if (err.name === "ValidationError") {
    console.error("Mongoose Validation Error:", err);
    const cleanMessage = Object.values(err.errors)[0].message;
    return sendError(res, 422, cleanMessage);
  }
  /**
   * ⭐ Two people edited the same document at once.
   *
   * 🔴 Without this branch a `VersionError` fell through to the 500 below, so a
   * vendor reordering media while a colleague deleted one was told
   * "Something went wrong" — an answer that reads as a broken server and invites
   * exactly the wrong response, which is to try something else. It is not broken
   * and the fix is simply to reload: the request was refused **because** the
   * document moved, which is the guarantee working.
   *
   * `409 Conflict` is what a client can act on, and the message says the one
   * thing that resolves it.
   */
  if (err.name === "VersionError") {
    return sendError(
      res,
      409,
      "Somebody else changed this while you were editing it. Reload and try again.",
    );
  }
  // ⭐ Handle Duplicate Key Error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const value = err.keyValue[field];
    return sendError(res, 422, `${value} is already registered for ${field}`);
  }
  // ⭐ Handle CustomError
  if (err instanceof CustomError) {
    return sendError(res, err.statusCode, err.message, err.data);
  }
  // ⭐ Default fallback
  const status = err.status || 500;
  const message = err.message || "Something went wrong";
  console.error("⛔ Error:", err);
  return sendError(res, status, message);
};
