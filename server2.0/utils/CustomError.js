class CustomError extends Error {
  constructor(statusCode, message, data = null) {
    super(message);
    this.statusCode = statusCode;
    this.data = data;
    Error.captureStackTrace(this, this.constructor);
  }
}

const throwError = (statusCode, message, data = null) => {
  throw new CustomError(statusCode, message, data);
};

module.exports = { CustomError, throwError };
