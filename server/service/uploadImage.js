const { v2: cloudinary } = require("cloudinary");
require("dotenv").config();

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_SECRET,
});

exports.uploadToCloudinary = async (imagePath) => {
  try {
    const uploadResult = await cloudinary.uploader.upload(imagePath, {
      resource_type: "image",
    });
    const optimizedUrl = cloudinary.url(uploadResult.public_id, {
      fetch_format: "auto",
      quality: "auto",
    });
    return optimizedUrl;
  } catch (error) {
    console.error("Cloudinary Upload Error:", error);
    throw new Error("Failed to upload image to Cloudinary");
  }
};

exports.deleteFromCloudinary = async (image) => {
  const publicId = image.split("/").pop().split(".")[0];
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    console.log("Cloudinary Delete Result:", result);
    if (result.result === "ok") {
      return true;
    }
  } catch (error) {
    console.error("Cloudinary Deletion Error:", error);
    throw new Error("Failed to delete image from Cloudinary");
  }
};
