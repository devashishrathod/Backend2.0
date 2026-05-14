exports.registrationValidation = async (req, res, next) => {
  const name = req.body?.name;
  const email = req.body?.email;
  const mobile = req.body?.mobile;
  const password = req.body?.password;
  // const role = req.body?.role
  const address = req.body?.address;
  // const image = req.files?.image
  try {
    if (!name) {
      return res.status(400).json({ success: false, msg: "Name is required!" });
    }
    if (name.toString().length < 3) {
      return res.status(400).json({
        success: false,
        msg: "Name should be at least 3 characters long!",
      });
    }
    if (!email) {
      return res
        .status(400)
        .json({ success: false, msg: "Email is required!" });
    }
    const emailRegex = /^[\w-]+(\.[\w-]+)*@([\w-]+\.)+[a-zA-Z]{2,7}$/;
    if (!emailRegex.test(email)) {
      return res
        .status(400)
        .json({ success: false, msg: "Invalid email format!" });
    }
    if (!mobile) {
      return res
        .status(400)
        .json({ success: false, msg: "Mobile number is required!" });
    }
    if (mobile.toString().length < 10 || mobile.toString().length > 15) {
      return res
        .status(400)
        .json({ success: false, msg: "Invalid mobile number format!" });
    }
    if (!password) {
      return res
        .status(400)
        .json({ success: false, msg: "Password is required!" });
    }
    if (password.toString().length < 5) {
      return res.status(400).json({
        success: false,
        msg: "Password should be at least 5 characters long!",
      });
    }
    if (!address) {
      return res
        .status(400)
        .json({ success: false, msg: "Address is required!" });
    }
    next();
    // return res.status(200).json({ success: false, msg: "Registration" })
  } catch (error) {
    console.log("error on registrationValidation: ", error);
    return res
      .status(500)
      .json({ error: error, success: false, msg: error.message });
  }
};

exports.loginValidation = async (req, res, next) => {
  const email = req.body?.email;
  const password = req.body?.password;
  try {
    if (!email) {
      return res
        .status(400)
        .json({ success: false, msg: "Email is required!" });
    }
    const emailRegex = /^[\w-]+(\.[\w-]+)*@([\w-]+\.)+[a-zA-Z]{2,7}$/;
    if (!emailRegex.test(email)) {
      return res
        .status(400)
        .json({ success: false, msg: "Invalid email format!" });
    }
    if (!password) {
      return res
        .status(400)
        .json({ success: false, msg: "Password is required!" });
    }

    next();
  } catch (error) {
    console.log("error on loginValidation: ", error);
    return res
      .status(500)
      .json({ error: error, success: false, msg: error.message });
  }
};
