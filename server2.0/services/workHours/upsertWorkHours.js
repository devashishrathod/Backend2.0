const mongoose = require("mongoose");
const WorkHours = require("../../models/WorkHours");
const SubBrand = require("../../models/SubBrand");
const Brand = require("../../models/Brand");
const { throwError } = require("../../utils");

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const parseDayValue = (value, day) => {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      throwError(400, `Invalid ${day} work hours format`);
    }
  }
  return value;
};

const buildWorkingHours = (payload) => {
  const workingHours = {};
  for (const day of DAYS) {
    const value = parseDayValue(payload[day], day);
    if (value !== undefined) {
      workingHours[day] = value;
    }
  }
  return workingHours;
};

exports.upsertWorkHours = async (userId, payload) => {
  const { brandId, subBrandId } = payload;

  if (!brandId && !subBrandId) {
    throwError(400, "Either brandId or subBrandId is required!");
  }

  if (brandId && subBrandId) {
    throwError(400, "Provide either brandId or subBrandId, not both!");
  }

  const workingHours = buildWorkingHours(payload);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      if (brandId) {
        const brand = await Brand.findOne({
          _id: brandId,
          isDeleted: { $ne: true },
        }).session(session);

        if (!brand) throwError(404, "Brand not found!");

        let workHours = null;

        if (brand.workHoursId) {
          workHours = await WorkHours.findOne({
            _id: brand.workHoursId,
            isDeleted: { $ne: true },
          }).session(session);

          if (!workHours) brand.workHoursId = null;
        }

        if (!workHours) {
          workHours = new WorkHours({
            ...workingHours,
            brandId: brand._id,
            subBrand: null,
          });
          await workHours.save({ session });
          brand.workHoursId = workHours._id;
          await brand.save({ session });
          result = {
            workHours,
            isNew: true,
            ownerType: "BRAND",
            ownerId: brand._id,
          };
          return;
        }
        Object.assign(workHours, workingHours);
        workHours.brandId = brand._id;
        workHours.subBrandId = null;
        await workHours.save({ session });
        if (
          !brand.workHoursId ||
          brand.workHoursId.toString() !== workHours._id.toString()
        ) {
          brand.workHoursId = workHours._id;
          await brand.save({ session });
        }
        result = {
          workHours,
          isNew: false,
          ownerType: "BRAND",
          ownerId: brand._id,
        };
        return;
      }

      const subBrand = await SubBrand.findOne({
        _id: subBrandId,
        isDeleted: { $ne: true },
      }).session(session);

      if (!subBrand) {
        throwError(404, "Outlet/Sub-Brand not found!");
      }

      let workHours = null;

      if (subBrand.workHoursId) {
        workHours = await WorkHours.findOne({
          _id: subBrand.workHoursId,
          isDeleted: { $ne: true },
        }).session(session);

        if (!workHours) {
          subBrand.workHoursId = null;
        }
      }

      if (!workHours) {
        workHours = new WorkHours({
          ...workingHours,
          brandId: null,
          subBrandId: subBrand._id,
        });
        await workHours.save({ session });
        subBrand.workHoursId = workHours._id;
        await subBrand.save({ session });
        result = {
          workHours,
          isNew: true,
          ownerType: "SUB_BRAND",
          ownerId: subBrand._id,
        };
        return;
      }
      Object.assign(workHours, workingHours);
      workHours.brandId = null;
      workHours.subBrandId = subBrand._id;
      await workHours.save({ session });
      if (
        !subBrand.workHoursId ||
        subBrand.workHoursId.toString() !== workHours._id.toString()
      ) {
        subBrand.workHoursId = workHours._id;
        await subBrand.save({ session });
      }
      result = {
        workHours,
        isNew: false,
        ownerType: "SUB_BRAND",
        ownerId: subBrand._id,
      };
    });
    return result;
  } catch (error) {
    console.error("Error in upserting working hours: ", error.message);
    throwError(500, error.message || "Failed to upsert work hours");
  } finally {
    await session.endSession();
  }
};
