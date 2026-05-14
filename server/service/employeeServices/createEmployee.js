const Employee = require("../../model/Employee");
const { throwError } = require("../../utils");
const { BANK_ACCOUNT_TYPES, DEFAULT_IMAGES } = require("../../constants");
const { isValidAccountNumber } = require("../../validator/common");
const { generateEmployeeUniqueId } = require("./generateEmployeeUniqueId");
const {
  addBankAccount,
  getBankByAccountNumber,
} = require("../bankAccountServices");
const { createLacation } = require("../locationServices");
const { uploadImage } = require("../uploadServices");

exports.createEmployee = async (image, body) => {
  const imageUrl = image
    ? await uploadImage(image.tempFilePath)
    : DEFAULT_IMAGES.USER;
  const {
    name,
    dob,
    email,
    whatsappNumber,
    referCode,
    bankName,
    branchName,
    accountNumber,
    ifscCode,
    state,
    district,
    city,
  } = body;
  const existingEmployee = await Employee.findOne({
    email: email,
    isDeleted: false,
  });
  if (existingEmployee) {
    throwError(409, "Employee with this email already exists");
  }
  const existingByWhatsApp = await Employee.findOne({
    whatsappNumber: whatsappNumber,
    isDeleted: false,
  });
  if (existingByWhatsApp) {
    throwError(409, "Employee with this mobile number already exists");
  }
  const existingReferCode = await Employee.findOne({ referCode: referCode });
  if (referCode && existingReferCode) {
    throwError(404, "Invalid refer code");
  }
  const employee = await Employee.create({
    name,
    dob,
    email,
    whatsappNumber,
    referCode,
    uniqueId: await generateEmployeeUniqueId(),
    image: imageUrl,
  });
  const coordinates = { type: "Point", coordinates: [0, 0] };
  let location = await createLacation({
    state,
    district,
    city,
    location: coordinates,
  });
  let bankAccount;
  if (accountNumber) {
    const isValidAccount = isValidAccountNumber(accountNumber);
    if (!isValidAccount) throwError(422, "Invalid account number");
    const existingByAccount = await getBankByAccountNumber(accountNumber);
    if (existingByAccount) {
      if (existingByAccount.user.toString() !== employee?._id?.toString()) {
        throwError(409, "Account number already exists with another user.");
      }
      bankAccount = existingByAccount;
    } else {
      bankAccount = await addBankAccount({
        user: employee._id,
        bankName,
        branchName,
        accountNumber,
        ifscCode,
        accountType: BANK_ACCOUNT_TYPES.SAVINGS,
      });
    }
  }
  employee.location = location?._id;
  employee.bankAccount = bankAccount?._id;
  await employee.save();
  return employee;
};
