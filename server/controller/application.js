const ApplicationHome = require("../model/ApplicationHome");
const DealOfCategory = require("../model/DealOfCategory");
const Filter = require("../model/Filter");
const Privacy = require("../model/Privacy");
const RefundPolicy = require("../model/RefundPolicy");
const State = require("../model/State");
const Terms = require("../model/Terms");
const Legal = require("../model/Legal");
const { uploadImage, deleteImage } = require("../service/uploadServices");

// ===================================== home ====================================================

exports.getAllHome = async (req, res) => {
  const id = req.params?.id;

  try {
    if (id) {
      const result = await ApplicationHome.findById(id);
      if (result) {
        return res
          .status(200)
          .json({ success: true, msg: "Home Application details", result });
      }
      return res
        .status(404)
        .json({ msg: "Home Application not found", success: false });
    }
    const result = await ApplicationHome.find().sort({ createdAt: -1 });
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Home Application details", result });
    }
    return res
      .status(404)
      .json({ msg: "Home Application not found", success: false });
  } catch (error) {
    console.log("error on getAllHome: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.getOne = async (req, res) => {
  const type = req.query?.type;
  try {
    const filter = {};
    if (type) filter.type = type;
    const result = await ApplicationHome.findOne(filter).sort({
      createdAt: -1,
    });
    if (!result) {
      return res
        .status(404)
        .json({ msg: "Home Application not found", success: false });
    }
    return res
      .status(200)
      .json({ success: true, msg: "Home Application details", result });
  } catch (error) {
    console.log("error on getOne: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.addHomeApplication = async (req, res) => {
  const image = req.files?.image;
  const title = req.body?.title;
  const header = req.body?.header;
  const description = req.body?.description;
  const type = req.body?.type;
  const colourCode = req.body?.colourCode;
  try {
    const home = new ApplicationHome({
      title,
      header,
      description,
      type,
      colourCode,
    });
    if (image) {
      let imageUrl = await uploadImage(image.tempFilePath);
      home.image = imageUrl;
    }
    const result = await home.save();
    return res.status(200).json({
      success: true,
      msg: "Home Application added successfully.",
      result,
    });
  } catch (error) {
    console.log("error on addHomeApplication: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.updateHomeApplication = async (req, res) => {
  // console.log(" ======================== updateHomeApplication ======================== ");

  const id = req.params?.id;
  const image = req.files?.image;
  const title = req.body?.title;
  const header = req.body?.header;
  const description = req.body?.description;
  const type = req.body?.type;
  const colourCode = req.body?.colourCode;
  try {
    const checkHome = await ApplicationHome.findById(id);
    if (!checkHome) {
      return res
        .status(400)
        .json({ success: false, msg: "Home Application not found" });
    }
    if (title) checkHome.title = title;
    if (header) checkHome.header = header;
    if (description) checkHome.description = description;
    if (type) checkHome.type = type;
    if (colourCode) checkHome.colourCode = colourCode;
    if (image) {
      if (checkHome?.image) await deleteImage(checkHome?.image);
      let imageUrl = await uploadImage(image.tempFilePath);
      checkHome.image = imageUrl;
    }
    const result = await checkHome.save();
    return res.status(200).json({
      success: true,
      msg: "Home Application updated successfully.",
      result,
    });
  } catch (error) {
    console.log("error on updateHomeApplication: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.deleteHomeApplication = async (req, res) => {
  const id = req.params?.id;
  try {
    const checkHome = await ApplicationHome.findById(id);
    if (!checkHome) {
      return res
        .status(400)
        .json({ success: false, msg: "Home Application not found" });
    }
    if (checkHome?.image) await deleteImage(checkHome?.image);
    const result = await ApplicationHome.findByIdAndDelete(id);
    if (result) {
      return res.status(200).json({
        success: true,
        msg: "Home Application deleted successfully.",
        result,
      });
    } else {
      return res
        .status(404)
        .json({ success: false, msg: "Home Application not found" });
    }
  } catch (error) {
    console.log("error on deleteHomeApplication: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

// ===================================== deal of category ====================================================
exports.getDealOfCategories = async (req, res) => {
  const id = req.params?.id;
  try {
    if (id) {
      const result = await DealOfCategory.findById(id);
      if (result) {
        return res
          .status(200)
          .json({ success: true, msg: "Deal of category details", result });
      }
      return res
        .status(404)
        .json({ msg: "Deal of category not found", success: false });
    }
    const result = await DealOfCategory.find().sort({ createdAt: -1 });
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Deal of category details", result });
    }
    return res
      .status(404)
      .json({ msg: "Deal of category not found", success: false });
  } catch (error) {
    console.log("error on getDealOfCategories: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.getDealOfDayPagination = async (req, res) => {
  const page = parseInt(req?.query?.page);
  const limit = parseInt(req?.query?.limit);
  const skip = (page - 1) * limit;
  const type = req.query?.type;
  try {
    const filter = {};
    if (type) {
      filter.type = type;
    }

    const result = await DealOfCategory.find(filter)
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 });
    const totalDocuments = await DealOfCategory.countDocuments(filter);
    const totalPages = Math.ceil(totalDocuments / limit);
    if (result) {
      return res.status(200).json({
        success: true,
        msg: "Deal of category details",
        result,
        pagination: { totalDocuments, totalPages, currentPage: page, limit },
      });
    }
    return res
      .status(404)
      .json({ msg: "Deal of category not found", success: false });
  } catch (error) {
    console.log("error on getDealOfDayPagination: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.addDealOfCategory = async (req, res) => {
  const image = req.files?.image;
  const title = req.body?.title;
  const name = req.body?.name;
  const type = req.body?.type;

  try {
    const checkDealOfCategory = await DealOfCategory.findOne({ name });
    if (checkDealOfCategory) {
      return res
        .status(400)
        .json({ success: false, msg: "Deal of category already exists" });
    }
    const dealOfCategory = new DealOfCategory({ title, name, type });
    if (image) {
      let imageUrl = await uploadImage(image.tempFilePath);
      dealOfCategory.image = imageUrl;
    }
    const result = await dealOfCategory.save();
    return res.status(200).json({
      success: true,
      msg: "Deal of category added successfully.",
      result,
    });
  } catch (error) {
    console.log("error on addDealOfCategory: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.updateDealOfCategory = async (req, res) => {
  const id = req.params?.id;

  const type = req.body?.type;
  const image = req.files?.image;
  const title = req.body?.title;
  const name = req.body?.name;

  try {
    const checkDealOfCategory = await DealOfCategory.findById(id);
    if (!checkDealOfCategory) {
      return res
        .status(400)
        .json({ success: false, msg: "Deal of category not found" });
    }
    if (title) checkDealOfCategory.title = title;
    if (name) checkDealOfCategory.name = name;
    if (type) checkDealOfCategory.type = type;
    if (image) {
      let imageUrl = await uploadImage(image.tempFilePath);
      if (checkDealOfCategory?.image) {
        await deleteImage(checkDealOfCategory?.image);
      }
      checkDealOfCategory.image = imageUrl;
    }
    const result = await checkDealOfCategory.save();
    if (result) {
      return res.status(200).json({
        success: true,
        msg: "Deal of category updated successfully.",
        result,
      });
    } else {
      return res
        .status(404)
        .json({ success: false, msg: "Deal of category not found" });
    }
  } catch (error) {
    console.log("error on updateDealOfCategory: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.deleteDealOfCategory = async (req, res) => {
  const id = req.params?.id;
  try {
    const checkDealOfCategory = await DealOfCategory.findById(id);
    if (!checkDealOfCategory) {
      return res
        .status(400)
        .json({ success: false, msg: "Deal of category not found" });
    }
    if (checkDealOfCategory?.image) {
      await deleteImage(checkDealOfCategory?.image);
    }
    const result = await DealOfCategory.findByIdAndDelete(id);
    if (result) {
      return res.status(200).json({
        success: true,
        msg: "Deal of category deleted successfully.",
        result,
      });
    } else {
      return res
        .status(404)
        .json({ success: false, msg: "Deal of category not found" });
    }
  } catch (error) {
    console.log("error on deleteDealOfCategory: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

// ===================================== filter ====================================================
exports.getAllFilter = async (req, res) => {
  const id = req.params?.id;

  // const search = req.query?.search
  try {
    if (id) {
      const result = await Filter.findById(id);
      if (result) {
        return res
          .status(200)
          .json({ success: true, msg: "Filter details", result });
      }
      return res.status(404).json({ msg: "Filter not found", success: false });
    }
    const result = await Filter.find().sort({ createdAt: -1 });
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Filter details", result });
    }
    return res.status(404).json({ msg: "Filter not found", success: false });
  } catch (error) {
    console.log("error on getAllFilter: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.pagination = async (req, res) => {
  const page = paraseInt(req?.query?.page);
  const limit = paraseInt(req?.query?.limit);
  const skip = (page - 1) * limit;
  try {
    const result = await Filter.find()
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 });
    const totalDocuments = await Filter.countDocuments();
    const totalPages = Math.ceil(totalDocuments / limit);
    if (result) {
      return res.status(200).json({
        success: true,
        msg: "Filter details",
        result,
        pagination: { totalDocuments, totalPages, currentPage: page, limit },
      });
    }
    return res.status(404).json({ msg: "Filter not found", success: false });
  } catch (error) {
    console.log("error on pagination: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.addFilter = async (req, res) => {
  const name = req.body?.name;
  const type = req.body?.type;

  try {
    const checkFilter = await Filter.findOne({ name });
    if (checkFilter) {
      return res
        .status(400)
        .json({ success: false, msg: "Filter already exists" });
    }
    const filter = new Filter({ name, type });
    const result = await filter.save();
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Filter added successfully.", result });
    } else {
      return res.status(404).json({ success: false, msg: "Filter not found" });
    }
  } catch (error) {
    console.log("error on addFilter: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.updateFilter = async (req, res) => {
  const id = req.params?.id;

  const name = req.body?.name;
  const type = req.body?.type;
  try {
    const checkFilter = await Filter.findById(id);
    if (!checkFilter) {
      return res.status(400).json({ success: false, msg: "Filter not found" });
    }
    if (name) checkFilter.name = name;
    if (type) checkFilter.type = type;
    const result = await checkFilter.save();
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Filter updated successfully.", result });
    }
    return res.status(404).json({ success: false, msg: "Filter not found" });
  } catch (error) {
    console.log("error on updateFilter: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.deleteFilter = async (req, res) => {
  const id = req.params?.id;

  try {
    const result = await Filter.findByIdAndDelete(id);
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Filter deleted successfully.", result });
    }
    return res.status(404).json({ success: false, msg: "Filter not found" });
  } catch (error) {
    console.log("error on deleteFilter: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

// ===================================== state ====================================================
exports.getAllState = async (req, res) => {
  const id = req.params?.id;
  try {
    if (id) {
      const result = await State.findById(id);
      if (result) {
        return res
          .status(200)
          .json({ success: true, msg: "State details", result });
      }
      return res.status(404).json({ msg: "State not found", success: false });
    }
    const result = await State.find().sort({ createdAt: -1 });
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "State details", result });
    }
    return res.status(404).json({ msg: "State not found", success: false });
  } catch (error) {
    console.log("error on getAllState: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.addState = async (req, res) => {
  const name = req.body?.name;

  try {
    const checkState = await State.findOne({ name });
    if (checkState) {
      return res
        .status(400)
        .json({ success: false, msg: "State already exists" });
    }
    const state = new State({ name });
    const result = await state.save();
    return res
      .status(200)
      .json({ success: true, msg: "State added successfully.", result });
  } catch (error) {
    console.log("error on addState: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.updateState = async (req, res) => {
  const id = req.params?.id;
  const name = req.body?.name;
  try {
    const checkState = await State.findById(id);
    if (!checkState) {
      return res.status(400).json({ success: false, msg: "State not found" });
    }
    const checkAlread = await State.findOne({ name });
    if (checkAlread) {
      return res
        .status(400)
        .json({ success: false, msg: "State already exists" });
    }
    checkState.name = name;
    const result = await checkState.save();
    return res
      .status(200)
      .json({ success: true, msg: "State updated successfully.", result });
  } catch (error) {
    console.log("error on updateState: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.deleteState = async (req, res) => {
  const id = req.params?.id;
  try {
    const result = await State.findByIdAndDelete(id);
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "State deleted successfully." });
    }
    return res.status(400).json({ success: false, msg: "State not found" });
  } catch (error) {
    console.log("error on deleteState: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

// ===================================== privacy ====================================================

exports.getAllPrivacy = async (req, res) => {
  const id = req.params?.id;
  try {
    if (id) {
      const result = await Privacy.findById(id);
      if (result) {
        return res
          .status(200)
          .json({ success: true, msg: "Privacy details", result });
      }
      return res.status(404).json({ msg: "Privacy not found", success: false });
    }
    const result = await Privacy.find().sort({ createdAt: -1 });
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Privacy details", result });
    }
    return res.status(404).json({ msg: "Privacy not found", success: false });
  } catch (error) {
    console.log("error on getAllPrivacy: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.getSinglePrivacy = async (req, res) => {
  try {
    const result = await Privacy.findOne().sort({ createdAt: -1 });
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Privacy details", result });
    }
    return res.status(404).json({ msg: "Privacy not found", success: false });
  } catch (error) {
    console.log("error on getSinglePrivacy: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.addPrivacy = async (req, res) => {
  const privacy = req.body?.privacy;
  const type = req.body?.type;
  try {
    const result = await Privacy.create({ privacy, type });
    return res
      .status(200)
      .json({ success: true, msg: "Privacy added successfully.", result });
  } catch (error) {
    console.log("error on addPrivacy: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.updatePrivacy = async (req, res) => {
  const id = req.params?.id;
  const privacy = req.body?.privacy;
  const type = req.body?.type;
  try {
    const checkPrivacy = await Privacy.findById(id);
    if (!checkPrivacy) {
      return res.status(400).json({ success: false, msg: "Privacy not found" });
    }
    checkPrivacy.privacy = privacy;
    checkPrivacy.type = type;
    const result = await checkPrivacy.save();
    return res
      .status(200)
      .json({ success: true, msg: "Privacy updated successfully.", result });
  } catch (error) {
    console.log("error on updatePrivacy: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.deletePrivacy = async (req, res) => {
  const id = req.params?.id;
  try {
    const result = await Privacy.findByIdAndDelete(id);
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Privacy deleted successfully." });
    }
    return res.status(400).json({ success: false, msg: "Privacy not found" });
  } catch (error) {
    console.log("error on deletePrivacy: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

// ===================================== refund policy ====================================================

exports.getAllRefundPolicy = async (req, res) => {
  const id = req.params?.id;
  try {
    if (id) {
      const result = await RefundPolicy.findById(id);
      if (result) {
        return res
          .status(200)
          .json({ success: true, msg: "Refund policy details", result });
      }
      return res
        .status(404)
        .json({ msg: "Refund policy not found", success: false });
    }
    const result = await Privacy.find().sort({ createdAt: -1 });
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Refund policy details", result });
    }
    return res
      .status(404)
      .json({ msg: "Refund policy not found", success: false });
  } catch (error) {
    console.log("error on getAllRefundPolicy: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.getSingleRefundPolicy = async (req, res) => {
  try {
    const result = await RefundPolicy.findOne().sort({ createdAt: -1 });
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Refund policy details", result });
    }
    return res
      .status(404)
      .json({ msg: "Refund policy not found", success: false });
  } catch (error) {
    console.log("error on getSingleRefundPolicy: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.addRefundPolicy = async (req, res) => {
  const refundPolicy = req.body?.refundPolicy;
  const type = req.body?.type;
  try {
    const result = await RefundPolicy.create({ refundPolicy, type });
    return res.status(200).json({
      success: true,
      msg: "Refund policy added successfully.",
      result,
    });
  } catch (error) {
    console.log("error on addRefundPolicy: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.updateRefundPolicy = async (req, res) => {
  const id = req.params?.id;
  const refundPolicy = req.body?.refundPolicy;
  const type = req.body?.type;
  try {
    const checkPrivacy = await RefundPolicy.findById(id);
    if (!checkPrivacy) {
      return res
        .status(400)
        .json({ success: false, msg: "Refund policy not found" });
    }
    checkPrivacy.refundPolicy = refundPolicy;
    checkPrivacy.type = type;
    const result = await checkPrivacy.save();
    return res.status(200).json({
      success: true,
      msg: "Refund policy updated successfully.",
      result,
    });
  } catch (error) {
    console.log("error on updateRefundPolicy: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.deleteRefundPolicy = async (req, res) => {
  const id = req.params?.id;
  try {
    const result = await RefundPolicy.findByIdAndDelete(id);
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Refund policy deleted successfully." });
    }
    return res
      .status(400)
      .json({ success: false, msg: "Refund policy not found" });
  } catch (error) {
    console.log("error on deleteRefundPolicy: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

// ===================================== terms and condition ====================================================

exports.getAllTerms = async (req, res) => {
  const id = req.params?.id;
  try {
    if (id) {
      const result = await Terms.findById(id);
      if (result) {
        return res
          .status(200)
          .json({ success: true, msg: "Term details", result });
      }
      return res.status(404).json({ msg: "Term not found", success: false });
    }
    const result = await Terms.find().sort({ createdAt: -1 });
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Term details", result });
    }
    return res.status(404).json({ msg: "Term not found", success: false });
  } catch (error) {
    console.log("error on getAllTerms: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.getSingleTerms = async (req, res) => {
  try {
    const result = await Terms.findOne().sort({ createdAt: -1 });
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Term details", result });
    }
    return res.status(404).json({ msg: "Term not found", success: false });
  } catch (error) {
    console.log("error on getSingleTerms: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.addTerms = async (req, res) => {
  const terms = req.body?.terms;
  const type = req.body?.type;
  try {
    const result = await Terms.create({ terms, type });
    return res
      .status(200)
      .json({ success: true, msg: "Term added successfully.", result });
  } catch (error) {
    console.log("error on addTerms: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.updateTerms = async (req, res) => {
  const id = req.params?.id;
  const terms = req.body?.terms;
  const type = req.body?.type;
  try {
    const checkPrivacy = await Terms.findById(id);
    if (!checkPrivacy) {
      return res.status(400).json({ success: false, msg: "Term not found" });
    }
    checkPrivacy.terms = terms;
    checkPrivacy.type = type;
    const result = await checkPrivacy.save();
    return res
      .status(200)
      .json({ success: true, msg: "Term updated successfully.", result });
  } catch (error) {
    console.log("error on updateTerms: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.deleteTerms = async (req, res) => {
  const id = req.params?.id;
  try {
    const result = await Terms.findByIdAndDelete(id);
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Term deleted successfully." });
    }
    return res.status(400).json({ success: false, msg: "Term not found" });
  } catch (error) {
    console.log("error on deleteTerms: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

// ===================================== Legal Controller ====================================================

exports.getAllLegal = async (req, res) => {
  const id = req.params?.id;
  try {
    if (id) {
      const result = await Legal.findById(id);
      if (result) {
        return res
          .status(200)
          .json({ success: true, msg: "Legal detail", result });
      }
      return res.status(404).json({ msg: "Legal not found", success: false });
    }

    const result = await Legal.find().sort({ createdAt: -1 });
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "All Legal details", result });
    }
    return res.status(404).json({ msg: "Legal not found", success: false });
  } catch (error) {
    console.log("error on getAllLegal: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.getSingleLegal = async (req, res) => {
  try {
    const result = await Legal.findOne().sort({ createdAt: -1 });
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Latest Legal detail", result });
    }
    return res.status(404).json({ msg: "Legal not found", success: false });
  } catch (error) {
    console.log("error on getSingleLegal: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.addLegal = async (req, res) => {
  const legal = req.body?.legal;
  const type = req.body?.type;
  try {
    const result = await Legal.create({ legal, type });
    return res
      .status(200)
      .json({ success: true, msg: "Legal added successfully.", result });
  } catch (error) {
    console.log("error on addLegal: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.updateLegal = async (req, res) => {
  const id = req.params?.id;
  const legal = req.body?.legal;
  const type = req.body?.type;
  try {
    const checkLegal = await Legal.findById(id);
    if (!checkLegal) {
      return res.status(400).json({ success: false, msg: "Legal not found" });
    }

    checkLegal.legal = legal;
    checkLegal.type = type;

    const result = await checkLegal.save();
    return res
      .status(200)
      .json({ success: true, msg: "Legal updated successfully.", result });
  } catch (error) {
    console.log("error on updateLegal: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};

exports.deleteLegal = async (req, res) => {
  const id = req.params?.id;
  try {
    const result = await Legal.findOneAndUpdate(
      { _id: id },
      { isDeleted: true, isActive: false }
    );
    if (result) {
      return res
        .status(200)
        .json({ success: true, msg: "Legal deleted successfully." });
    }
    return res.status(400).json({ success: false, msg: "Legal not found" });
  } catch (error) {
    console.log("error on deleteLegal: ", error);
    return res.status(500).json({ success: false, msg: error.message });
  }
};
