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

/**
 * Send the browser somewhere else.
 *
 * The third shape a response can take, and it lives here for the same reason the
 * other two do: `res.*` belongs in exactly one file, so there is one place to
 * change how this service answers.
 *
 * Used by the public invoice link, which resolves a token and then hands the
 * browser the actual file. A redirect rather than streaming the PDF through this
 * service: the file already sits on a CDN, and proxying it would put every
 * invoice download through the API for no benefit.
 *
 * 302 and not 301 on purpose — the destination is a signed CDN URL that can be
 * regenerated, and a browser that cached a 301 would keep going to a URL that
 * has since expired.
 */
exports.sendRedirect = (res, url) => res.redirect(302, url);
