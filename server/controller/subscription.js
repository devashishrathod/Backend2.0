const Subscription = require("../model/Subscription");

exports.getAllSubscription = async (req, res) => {
  const id = req?.params?.id;
  try {
    if (id) {
      const result = await Subscription.findById(id);
      if (result) {
        return res.status(200).json({ data: result, success: true });
      }
      return res
        .status(400)
        .json({ msg: "Failed to get subscription!", success: false });
    }
    const result = await Subscription.find({
      isActive: true,
      isDeleted: false,
      name: { $not: /^cooling period$/i },
    });
    if (result) {
      return res.status(200).json({ data: result, success: true });
    }
    return res
      .status(400)
      .json({ msg: "Failed to get subscription!", success: false });
  } catch (error) {
    console.log("error on getAllSubscription: ", error);
    return res
      .status(500)
      .json({ error: error, success: false, msg: error.message });
  }
};

exports.pagination = async (req, res) => {
  const page = parseInt(req?.query?.page);
  const limit = parseInt(req?.query?.limit);
  const skip = (page - 1) * limit;
  const isActive = req?.query?.isActive;
  try {
    let query = {};
    if (isActive) {
      query = { isActive: isActive };
    }
    const result = await Subscription.find(query)
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 });
    const totalDocuments = await Subscription.countDocuments();
    const totalPages = Math.ceil(totalDocuments / limit);
    if (result) {
      return res.status(200).json({
        success: true,
        msg: "Subscription details",
        result,
        pagination: { totalDocuments, totalPages, currentPage: page, limit },
      });
    }
    return res
      .status(404)
      .json({ msg: "Subscription not found", success: false });
  } catch (error) {
    console.log("error on getAllSubscription: ", error);
    return res
      .status(500)
      .json({ error: error, success: false, msg: error.message });
  }
};

exports.getActive = async (req, res) => {
  try {
    const result = await Subscription.find({ isActive: true });
    if (result) {
      return res.status(200).json({ data: result, success: true });
    }
    return res
      .status(400)
      .json({ msg: "Failed to get subscription!", success: false });
  } catch (error) {
    console.log("error on getActive: ", error);
    return res
      .status(500)
      .json({ error: error, success: false, msg: error.message });
  }
};

exports.addSubscription = async (req, res) => {
  const name = req.body?.name;
  const price = req.body?.price;
  const durationInYears = req.body?.durationInYears;
  const description = req.body?.description;
  let durationInDays = req.body?.durationInDays;
  const numberOfSubBrands = req.body?.numberOfSubBrands;
  const discount = req.body?.discount;
  const type = req.body?.type;
  const benefits = req.body?.benefits;
  const limitations = req.body?.limitations;
  try {
    if (!durationInDays && durationInYears) {
      durationInDays = durationInYears * 365;
    }
    const result = await Subscription.create({
      name,
      price,
      type,
      description,
      durationInYears,
      durationInDays,
      numberOfSubBrands,
      discount,
      benefits,
      limitations,
    });
    if (result) {
      return res
        .status(200)
        .json({ msg: "Subscription added successfully.", success: true });
    }
    return res
      .status(400)
      .json({ msg: "Failed to add subscription!", success: false });
  } catch (error) {
    console.log("error on addSubscription: ", error);
    return res
      .status(500)
      .json({ error: error, success: false, msg: error.message });
  }
};

exports.updateSubscription = async (req, res) => {
  const id = req.params?.id;
  const name = req.body?.name;
  const price = req.body?.price;
  const description = req.body?.description;
  const durationInYears = req.body?.durationInYears;
  let durationInDays = req.body?.durationInDays;
  const numberOfSubBrands = req.body?.numberOfSubBrands;
  const discount = req.body?.discount;
  const isActive = req.body?.isActive;
  const type = req.body?.type;
  const benefits = req.body?.benefits;
  const limitations = req.body?.limitations;
  try {
    if (!durationInDays && durationInYears) {
      durationInDays = durationInYears * 365;
    }
    const result = await Subscription.findByIdAndUpdate(id, {
      name,
      price,
      description,
      type,
      durationInYears,
      durationInDays,
      numberOfSubBrands,
      discount,
      isActive,
      benefits,
      limitations,
    });
    if (result) {
      return res
        .status(200)
        .json({ msg: "Subscription updated successfully.", success: true });
    }
    return res
      .status(400)
      .json({ msg: "Failed to update subscription!", success: false });
  } catch (error) {
    console.log("error on updateSubscription: ", error);
    return res
      .status(500)
      .json({ error: error, success: false, msg: error.message });
  }
};

exports.changeStatus = async (req, res) => {
  const id = req.params?.id;
  const isActive = req.body?.isActive;
  try {
    const result = await Subscription.findByIdAndUpdate(id, { isActive });
    if (result) {
      return res.status(200).json({
        msg: "Subscription status updated successfully.",
        success: true,
      });
    }
    return res
      .status(400)
      .json({ msg: "Failed to update subscription status!", success: false });
  } catch (error) {
    console.log("error on changeStatus: ", error);
    return res
      .status(500)
      .json({ error: error, success: false, msg: error.message });
  }
};

exports.deleteSubscription = async (req, res) => {
  const id = req.params?.id;
  try {
    const result = await Subscription.findByIdAndDelete(id);
    if (result) {
      return res
        .status(200)
        .json({ msg: "Subscription deleted successfully.", success: true });
    }
    return res
      .status(400)
      .json({ msg: "Failed to delete subscription!", success: false });
  } catch (error) {
    console.log("error on updateSubscription: ", error);
    return res
      .status(500)
      .json({ error: error, success: false, msg: error.message });
  }
};
