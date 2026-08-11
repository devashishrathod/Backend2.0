const crypto = require("crypto");
const SubBrand = require("../../models/SubBrand");
const CHARSET = process.env.STORE_ID_SECRET;

const generateRandomBlock = (length = 4) => {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += CHARSET[bytes[i] % CHARSET.length];
  }
  return result;
};

exports.generateSubBrandStoreId = async () => {
  while (true) {
    const storeId = `TS-${generateRandomBlock()}-${generateRandomBlock()}-${generateRandomBlock()}`;
    const exists = await SubBrand.exists({ storeId });
    if (!exists) return storeId;
  }
};
