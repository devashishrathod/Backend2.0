exports.sendSuccess = (
  res,
  statusCode = 200,
  message = "Success",
  data = {},
) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

exports.sendError = (
  res,
  statusCode = 500,
  message = "Something went wrong",
  errorData = null,
) => {
  return res.status(statusCode).json({
    success: false,
    message,
    ...(errorData && { details: errorData }),
  });
};
