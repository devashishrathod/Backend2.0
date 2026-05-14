const SubCategory = require("../../model/SubCategory");
const { deleteImage } = require("../../service/uploadServices");

exports.deleteSubCategoriesByCategory = async (categoryId) => {
  const subCategories = await SubCategory.find({
    category: categoryId,
    isDeleted: false,
  });
  if (!subCategories.length) return;
  for (const sub of subCategories) {
    await deleteImage(sub?.image);
    sub.image = null;
    sub.isDeleted = true;
    sub.isActive = false;
    sub.updatedAt = new Date();
    await sub.save();
  }
};
