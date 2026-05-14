function toStringArray(input) {
  if (!input) return [];
  if (Array.isArray(input))
    return input
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean);
  // support CSV "a,b,c"
  return String(input)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toRegexArray(names) {
  return names.map((n) => new RegExp(`^${escapeRegExp(n)}$`, "i"));
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRegionMatch({ countryCode, stateNames, stateCodes, cityNames }) {
  const and = [];
  if (countryCode) {
    and.push({ "states.countryCode": countryCode });
    and.push({ "cities.countryCode": countryCode });
  }
  if (stateNames?.length) {
    and.push({ "states.name": { $in: toRegexArray(stateNames) } });
  }
  if (stateCodes?.length) {
    and.push({ "states.code": { $in: stateCodes } });
  }
  if (cityNames?.length) {
    and.push({ "cities.name": { $in: toRegexArray(cityNames) } });
  }
  if (!and.length) return {};
  return { $and: and };
}

function userProximityStages({ userCityName, userStateName }) {
  const cityRegex = userCityName
    ? new RegExp(`^${escapeRegExp(userCityName)}$`, "i")
    : null;
  const stateRegex = userStateName
    ? new RegExp(`^${escapeRegExp(userStateName)}$`, "i")
    : null;
  return [
    {
      $addFields: {
        _cityHit: cityRegex
          ? {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: "$cities",
                      as: "c",
                      cond: {
                        $regexMatch: { input: "$$c.name", regex: cityRegex },
                      },
                    },
                  },
                },
                0,
              ],
            }
          : false,
        _stateHit: stateRegex
          ? {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: "$states",
                      as: "s",
                      cond: {
                        $regexMatch: { input: "$$s.name", regex: stateRegex },
                      },
                    },
                  },
                },
                0,
              ],
            }
          : false,
      },
    },
    {
      $addFields: {
        proximityScore: {
          $add: [
            { $cond: ["$_cityHit", 2, 0] },
            { $cond: ["$_stateHit", 1, 0] },
          ],
        },
      },
    },
    { $project: { _cityHit: 0, _stateHit: 0 } },
  ];
}

function projectStage() {
  return {
    $project: {
      title: 1,
      discountTitle: 1,
      scope: 1,
      image: 1,
      states: 1,
      cities: 1,
      originalPrice: 1,
      discountPrice: 1,
      publishedDate: 1,
      endDate: 1,
      voucher: 1,
      createdAt: 1,
      proximityScore: 1,
      brandName: "$brandData.name",
      brandLogo: "$brandData.logo",
      city: "$brandLocation.city",
      shopOrBuildingNumber: "$brandLocation.shopOrBuildingNumber",
      address: "$brandLocation.address",
      street: "$brandLocation.street",
      isActive: 1,
    },
  };
}

module.exports = {
  toStringArray,
  toRegexArray,
  buildRegionMatch,
  userProximityStages,
  projectStage,
};
