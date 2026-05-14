const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { PAYMENT_STATUS } = require("../../constants");
const { uploadPDF } = require("../../service/uploadServices");

exports.generateAndUploadInvoice = async (invoiceData) => {
  return new Promise((resolve, reject) => {
    const status =
      invoiceData.status === PAYMENT_STATUS.CAPTURED
        ? "Successfully"
        : invoiceData.status;
    const doc = new PDFDocument({ margin: 50 });
    // Use a Unicode font
    // const fontPath = path.join(
    //   __dirname,
    //   "..",
    //   "assets",
    //   "fonts",
    //   "NotoSans-Regular.ttf"
    // );
    // doc.registerFont("NotoSans", fontPath);
    // doc.font("NotoSans"); // Set as active font
    const fileName = `invoice_${Date.now()}_${Math.floor(
      Math.random() * 10000,
    )}.pdf`;
    const tmpDir = path.join(__dirname, "..", "tmp");
    const filePath = path.join(tmpDir, fileName);
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);
    doc.fontSize(20).text("Invoice", { align: "center" }).moveDown(2);
    doc.fontSize(12).text(`Invoice No: ${invoiceData.invoiceId}`);
    doc.text(`Transaction: ${invoiceData.transaction}`);
    doc.text(`Date: ${invoiceData.date}`);
    doc.text(`Plan: ${invoiceData.planName}`);
    doc.text(`Price: ₹${invoiceData.price}`);
    doc.text(`Plan End: ${invoiceData.planEnd}`);
    doc.text(`Status: ${status}`);
    doc.text(`Payment Method: ${invoiceData.paymentMethod}`);
    doc.end();
    writeStream.on("finish", async () => {
      try {
        const pdfUrl = await uploadPDF(filePath, fileName);
        resolve(pdfUrl);
      } catch (err) {
        reject(err);
      }
    });
    writeStream.on("error", (err) => {
      reject(err);
    });
  });
};
