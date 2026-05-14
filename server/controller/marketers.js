// const User = require("../model/User");
// const { generateReferralCode } = require("../utils");

// exports.getAllMarketPerson = async (req, res) => {
//   const id = req.params?.id;
//   try {
//     if (id) {
//       const result = await User.findById(id);
//       if (result) {
//         return res
//           .status(200)
//           .json({ success: true, msg: "Market person details", result });
//       }
//       return res
//         .status(404)
//         .json({ msg: "Market person not found", success: false });
//     }
//     const result = await User.find({ role: "marketer" }).sort({
//       createdAt: -1,
//     });
//     if (result) {
//       return res
//         .status(200)
//         .json({ success: true, msg: "Market person details", result });
//     }
//     return res
//       .status(404)
//       .json({ msg: "Market person not found", success: false });
//   } catch (error) {
//     console.log("error on getAllMarketPerson: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };

// exports.pagination = async (req, res) => {
//   const page = parseInt(req?.query?.page);
//   const limit = parseInt(req?.query?.limit);
//   const skip = (page - 1) * limit;
//   try {
//     const result = await User.find({ role: "marketer" })
//       .limit(limit)
//       .skip(skip)
//       .sort({ createdAt: -1 });
//     const totalDocuments = await User.countDocuments({ role: "marketer" });
//     const totalPages = Math.ceil(totalDocuments / limit);
//     if (result) {
//       return res.status(200).json({
//         success: true,
//         msg: "Market person details",
//         result,
//         pagination: { totalDocuments, totalPages, currentPage: page, limit },
//       });
//     }
//     return res
//       .status(404)
//       .json({ msg: "Market person not found", success: false });
//   } catch (error) {
//     console.log("error on pagination: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };

// exports.addMarketPerson = async (req, res) => {
//   const name = req.body?.name;
//   const email = req.body?.email;
//   const mobile = req.body?.mobile;
//   const address = req.body?.address;
//   const dob = req.body?.dob;

//   try {
//     const checkUser = await User.findOne({ mobile });
//     if (checkUser) {
//       return res
//         .status(400)
//         .json({ msg: "Market person already register.", success: false });
//     }
//     const result = await User.create({
//       name,
//       email,
//       mobile,
//       address,
//       dob,
//       referCode: generateReferralCode(6),
//       role: "marketer",
//     });
//     if (result) {
//       return res
//         .status(200)
//         .json({ msg: "Market person added successfully.", success: true });
//     }
//     return res
//       .status(400)
//       .json({ msg: "Failed to add market person!", success: false });
//   } catch (error) {
//     console.log("error on addMarketPerson: ", error);
//     return res
//       .status(500)
//       .json({ error: error, success: false, msg: error.message });
//   }
// };
