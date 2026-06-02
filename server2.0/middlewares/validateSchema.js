const Joi = require("joi");
const { throwError, cleanJoiError } = require("../utils");

exports.validateSchema = (schema) => {
  return (req, res, next) => {
    if (Joi.isSchema(schema)) {
      const { error, value } = schema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
      });
      if (error) {
        return next(throwError(422, cleanJoiError(error)));
      }
      req.body = value;
      req.validatedData = {
        ...value,
      };
      return next();
    }

    const validationSchema = Joi.object({
      body: schema.body || Joi.object({}),
      query: schema.query || Joi.object({}),
      params: schema.params || Joi.object({}),
      headers: schema.headers || Joi.object({}),
    });

    const { error, value } = validationSchema.validate(
      {
        body: req.body,
        query: req.query,
        params: req.params,
        headers: req.headers,
      },
      {
        abortEarly: false,
        stripUnknown: true,
        allowUnknown: true,
        convert: true,
      },
    );

    if (error) {
      return next(throwError(422, cleanJoiError(error)));
    }

    req.body = value.body;
    req.query = value.query;
    req.params = value.params;
    req.headers = value.headers;

    req.validatedData = {
      ...value.params,
      ...value.query,
      ...value.body,
    };
    next();
  };
};
