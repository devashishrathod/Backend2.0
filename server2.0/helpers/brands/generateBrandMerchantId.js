const crypto = require("crypto");
const Brand = require("../../models/Brand");

const CHARSET = process.env.MERCHANT_ID_SECRET;

const generateRandomBlock = (length = 4) => {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += CHARSET[bytes[i] % CHARSET.length];
  }
  return result;
};

exports.generateBrandMerchantId = async () => {
  while (true) {
    const merchantId = `TM-${generateRandomBlock()}-${generateRandomBlock()}-${generateRandomBlock()}`;
    const exists = await Brand.exists({ merchantId });
    if (!exists) return merchantId;
  }
};
