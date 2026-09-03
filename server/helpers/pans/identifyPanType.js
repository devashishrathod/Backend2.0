const { PAN_TYPES } = require("../../constants");
const { isValidPAN } = require("../../validator/common");

exports.identifyPanType = (panNumber) => {
  const pan = panNumber?.trim()?.toUpperCase();
  if (!isValidPAN(panNumber)) return null;

  const typeMap = {
    P: PAN_TYPES.INDIVIDUAL,
    C: PAN_TYPES.COMPANY,
    F: PAN_TYPES.LLP,
    H: PAN_TYPES.HUF,
    A: PAN_TYPES.AOP,
    T: PAN_TYPES.TRUST,
    B: PAN_TYPES.BOI,
    L: PAN_TYPES.LOCAL_AUTHORITY,
    J: PAN_TYPES.ARTIFICIAL_JURIDICAL_PERSON,
    G: PAN_TYPES.GOVERNMENT,
  };
  return typeMap[pan[3]] ?? null;
};
