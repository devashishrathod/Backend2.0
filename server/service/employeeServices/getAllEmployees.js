const Employee = require("../../model/Employee");
const { pagination } = require("../../utils");

exports.getAllEmployees = async (filters) => {
  let page = filters.page ? parseInt(filters.page) : 1;
  let limit = filters.limit ? parseInt(filters.limit) : 10;
  if (page < 1) page = 1;
  if (limit < 1) limit = 10;
  const pipeline = [];
  const matchStage = { isDeleted: false };
  const filterKeys = Object.keys(filters).filter(
    (key) => !["page", "limit", "search"].includes(key)
  );
  filterKeys.forEach((key) => {
    if (filters[key] !== undefined && filters[key] !== "") {
      matchStage[key] = filters[key];
    }
  });
  if (filters.search) {
    const regex = new RegExp(filters.search, "i");
    matchStage.$or = [
      { name: regex },
      { email: regex },
      { whatsappNumber: regex },
      { referCode: regex },
      { uniqueId: regex },
    ];
  }
  pipeline.push({ $match: matchStage });
  pipeline.push({
    $lookup: {
      from: "employeereferrals",
      let: { empId: "$_id" },
      pipeline: [
        {
          $match: {
            $expr: { $eq: ["$employee", "$$empId"] },
            isDeleted: false,
          },
        },
        {
          $group: {
            _id: null,
            noOfCoolingPeriod: { $sum: "$subscriptionCount.noOfCoolingPeriod" },
            noOfStarterPlan: { $sum: "$subscriptionCount.noOfStarterPlan" },
            noOfProfessionalPlan: {
              $sum: "$subscriptionCount.noOfProfessionalPlan",
            },
            noOfEntrepreneurPlan: {
              $sum: "$subscriptionCount.noOfEntrepreneurPlan",
            },
          },
        },
      ],
      as: "referralCounts",
    },
  });
  pipeline.push({
    $addFields: {
      subscriptionCount: {
        noOfCoolingPeriod: {
          $ifNull: [
            { $arrayElemAt: ["$referralCounts.noOfCoolingPeriod", 0] },
            0,
          ],
        },
        noOfStarterPlan: {
          $ifNull: [
            { $arrayElemAt: ["$referralCounts.noOfStarterPlan", 0] },
            0,
          ],
        },
        noOfProfessionalPlan: {
          $ifNull: [
            { $arrayElemAt: ["$referralCounts.noOfProfessionalPlan", 0] },
            0,
          ],
        },
        noOfEntrepreneurPlan: {
          $ifNull: [
            { $arrayElemAt: ["$referralCounts.noOfEntrepreneurPlan", 0] },
            0,
          ],
        },
      },
    },
  });
  pipeline.push({
    $lookup: {
      from: "bankaccounts",
      localField: "bankAccount",
      foreignField: "_id",
      as: "bankAccount",
    },
  });
  pipeline.push({
    $unwind: { path: "$bankAccount", preserveNullAndEmptyArrays: true },
  });
  pipeline.push({
    $lookup: {
      from: "locations",
      localField: "location",
      foreignField: "_id",
      as: "location",
    },
  });
  pipeline.push({
    $unwind: { path: "$location", preserveNullAndEmptyArrays: true },
  });
  pipeline.push({
    $project: {
      _id: 1,
      name: 1,
      dob: 1,
      email: 1,
      whatsappNumber: 1,
      image: 1,
      referCode: 1,
      uniqueId: 1,
      isActive: 1,
      createdAt: 1,
      subscriptionCount: 1,
      bankAccount: {
        bankName: 1,
        branchName: 1,
        accountNumber: 1,
        ifscCode: 1,
      },
      location: {
        state: 1,
        district: 1,
        city: 1,
      },
    },
  });
  return await pagination(Employee, pipeline, page, limit);
};
