const { asyncWrapper, sendSuccess, throwError } = require("../../utils");
const { createCategory } = require("../../services/categories");
const { validateCreateCategory } = require("../../validator/categories");

exports.createCategory = asyncWrapper(async (req, res) => {
  const { error } = validateCreateCategory(req.body);
  if (error) throwError(422, error.details.map((d) => d.message).join(", "));
  const image = req.files?.image;
  // `actor` because the presigned road has to prove the upload is this caller's.
  const category = await createCategory(
    { userId: req.userId, role: req.role },
    req.body,
    image,
  );
  return sendSuccess(res, 201, "Category created", category);
});
