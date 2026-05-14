const { validationResult } = require("express-validator");
const { celebrate, Joi, Segments } = require("celebrate");
const { sendError } = require("./response");
const { deleteFilesFromDisk } = require("./deleteFilesFromDisk");

/**
 * Builds error for validation files
 * @param {Object} req - request object
 * @param {Object} res - response object
 * @param {Object} next - next object
 */
const validateResult = (req, res, next) => {
  try {
    validationResult(req).throw();
    if (req.body.email) {
      req.body.email = req.body.email.toLowerCase();
    }
    return next();
  } catch (err) {
    deleteFilesFromDisk(req);
    return sendError(res, 422, err.array());
  }
};

/**
 * Creates a validation middleware using a Joi schema
 * @param {Joi.ObjectSchema} schema - Joi schema to validate the request body
 * @param {string} segment - Segment of the request to validate (default: body)
 */
const validate = (schema, segment = Segments.BODY) => {
  return celebrate({ [segment]: schema });
};

module.exports = { validateResult, validate, Joi };
