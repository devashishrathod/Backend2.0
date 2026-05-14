const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { uploadPDF } = require("../../service/uploadServices");

exports.generateAndUploadBillInvoice = (invoiceData) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });

    const fileName = `bill_invoice_${Date.now()}_${Math.floor(
      Math.random() * 10000
    )}.pdf`;
    const tmpDir = path.join(__dirname, "..", "tmp");
    const filePath = path.join(tmpDir, fileName);

    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // Header
    doc.fontSize(16).text("🧾  My Invoice", { align: "left" }).moveDown(0.5);
    doc.fontSize(12).text(`You’ll Pay ₹ ${invoiceData?.payAmount?.toFixed(2)}`);
    doc.text(`Order # ${invoiceData?.orderId}`).moveDown(1);

    doc
      .rect(doc.x, doc.y, doc.page.width - 80, 1)
      .fill("#00A86B")
      .stroke(); // green bar

    doc.fillColor("#000").moveDown(1);
    doc.fontSize(14).text(invoiceData?.brandName || "", { align: "center" });
    doc
      .fontSize(10)
      .text(
        `${invoiceData?.location} | ${invoiceData?.dateTime} | ID - ${invoiceData?.billId}`,
        { align: "center" }
      );

    doc.moveDown(1).fontSize(12).text("Bill Summary", { underline: true });

    // Bill Summary Table
    doc.moveDown(0.5);
    doc
      .text(`Bill Amount`, 50)
      .text(`₹ ${invoiceData?.billAmount?.toFixed(2)}`, { align: "right" });
    doc
      .text(`${invoiceData?.discountText}`, 50)
      .text(`- ₹ ${invoiceData?.discountAmount?.toFixed(2)}`, {
        align: "right",
      });
    doc
      .text(`Convenience Fee`, 50)
      .text(`₹ ${invoiceData?.convenienceFee?.toFixed(2)}`, { align: "right" });
    doc
      .text(`Promo Code Used (${invoiceData?.promoCodeUsed})`, 50)
      .text(`- ₹ ${invoiceData?.promoDiscount?.toFixed(2)}`, {
        align: "right",
      });

    doc.moveDown(1);
    doc.text(`Payment Method: ${invoiceData?.paymentMethod}`, {
      align: "left",
    });

    doc.moveDown(0.5);
    doc.fontSize(10).text(`${invoiceData?.paymentApp}`, 50);
    doc.text(`Transaction ID : ${invoiceData?.transactionId}`, 50);

    doc.moveDown(1);
    doc
      .fontSize(14)
      .fillColor("green")
      .text(`₹ ${invoiceData?.payAmount?.toFixed(2)}`, { align: "right" });

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
