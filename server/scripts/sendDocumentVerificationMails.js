/**
 * Mail every Trydood document to a review address — the real notification, its
 * real Download button, and the rendered PDF attached.
 *
 *     node scripts/sendDocumentVerificationMails.js --to=you@example.com
 *     node scripts/sendDocumentVerificationMails.js --to=you@example.com --apply
 *     node scripts/sendDocumentVerificationMails.js --cleanup
 *
 * ### Why this exists
 *
 * A document has three surfaces and they fail independently: the **email** (does
 * the button render, does the wording read right), the **link** (does the token
 * resolve, does the PDF come back), and the **document** (are the amounts, dates
 * and parties right). Reviewing them needed a deploy, a seeded database and a
 * live payment. This does all three from one command.
 *
 * ### How each part is made real rather than mocked
 *
 * - The snapshot comes from the **production builder** for that kind, so what is
 *   reviewed is what a real payment would produce — not a hand-typed fixture that
 *   agrees with nothing.
 * - A real row is written, carrying `documentToken` and the snapshot, so
 *   `GET /documents/:token` genuinely resolves it. That is what makes the button
 *   in the email work rather than merely appear.
 * - The email is sent by the **real notice function**, so the button, the lines
 *   and the wording are the ones a customer or vendor receives.
 *
 * ### ⚠️ `notify` is stubbed, deliberately
 *
 * `notify()` resolves the recipient from the brand, customer or user record — it
 * cannot be pointed at a review address without inventing brands and customers.
 * So it is replaced with a capture, and `sendMail` is then called directly with
 * the review address. Same trick as `sendTestNotificationMails.js`, and the same
 * reason.
 *
 * ### ⚠️ For the buttons to work
 *
 * A server must be running against this database, and `PUBLIC_API_URL` must point
 * at somewhere the mail client can reach:
 *
 *     ENABLE_JOBS=false npm start          # this database, port 8080
 *     ngrok http 8080                      # a reachable URL
 *     PUBLIC_API_URL=<ngrok url> node scripts/sendDocumentVerificationMails.js --to=… --apply
 *
 * Without that the PDF is still attached; only the button is dead.
 *
 * Every row is stamped `DOC-VERIFY:<run>` in a field the domain ignores, and
 * `--cleanup` removes exactly those and nothing else.
 */
require("dotenv").config({ quiet: true });

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const mongoose = require("mongoose");

// ---------------------------------------------------------------- arguments

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const has = (name) => process.argv.includes(`--${name}`);

const RECIPIENTS = (arg("to") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const APPLY = has("apply");
const CLEANUP = has("cleanup");

/** The marker every row this script writes carries, so cleanup is exact. */
const MARK = "DOC-VERIFY";
const RUN = `${MARK}:${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}`;

if (!CLEANUP && !RECIPIENTS.length) {
  console.error(
    "--to=<email>[,<email>…] is required. Nothing is sent without it.\n" +
      "  node scripts/sendDocumentVerificationMails.js --to=you@example.com\n" +
      "  node scripts/sendDocumentVerificationMails.js --cleanup",
  );
  process.exit(1);
}

// ---------------------------------------------------------------- the stub
//
// ⚠️ Installed BEFORE the notice modules load. They destructure `{ notify }` at
// require time, so a stub applied afterwards would be bound to nothing.

const captured = [];
const notifyModule = require("../helpers/notifications/notify");
const realNotify = notifyModule.notify;
notifyModule.notify = async (args) => {
  captured.push(args);
  return { captured: true };
};

const audienceModule = require("../helpers/notifications/notifyAudience");
if (audienceModule.notifyAudience) {
  audienceModule.notifyAudience = async (args) => {
    captured.push(args);
    return { recipients: 0, created: 0, duplicates: 0, push: null };
  };
}

// ---------------------------------------------------------------- the rest

const Transaction = require("../models/Transaction");
const RefundRequest = require("../models/RefundRequest");
const Dispute = require("../models/Dispute");
const Settlement = require("../models/Settlement");
const VoucherClaim = require("../models/VoucherClaim");

const { sendMail } = require("../helpers/nodeMailer");
const { renderDocumentPdf } = require("../helpers/documents");
const {
  buildVoucherInvoiceSnapshot,
} = require("../helpers/voucherClaims/buildVoucherInvoiceSnapshot");
const {
  buildInvoiceSnapshot,
} = require("../helpers/transactions/buildInvoiceSnapshot");
const {
  buildRefundDocumentSnapshot,
} = require("../helpers/refunds/buildRefundDocumentSnapshot");
const {
  buildChargebackDocumentSnapshot,
} = require("../helpers/disputes/buildChargebackDocumentSnapshot");
const {
  buildSettlementDocumentSnapshot,
} = require("../helpers/settlements/buildSettlementDocumentSnapshot");

const notices = require("../helpers/notifications");
const { normaliseActions } = require("../helpers/nodeMailer/sendMail");

const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../constants/transaction");
const { SUBSCRIPTION_ACTION, MANUAL_PAYMENT_MODES } = require("../constants/subscription");
const { REFUND_REQUEST_STATUS, REFUND_REASON } = require("../constants/refund");
const { REFUND_METHODS } = require("../constants/customer");
const { DISPUTE_STATUS } = require("../constants/webhook");
const { SETTLEMENT_STATUS } = require("../constants/settlement");
const { PAYMENT_STATUS } = require("../constants");
const crypto = require("node:crypto");

const oid = () => new mongoose.Types.ObjectId();
const token = () => crypto.randomBytes(32).toString("hex");

// ---------------------------------------------------------------- fixtures
//
// One brand, one customer, one outlet across every case, so the documents read
// as one business rather than nine unrelated ones.

const SELLER = {
  companyName: "TRYDOOD RETAIL PRIVATE LIMITED",
  companyGstin: "33AAKCT3750H1ZB",
  companyAddress:
    "2nd Floor, Phase-3, Suite No. 250, Door No. 769, Spencer Plaza, Anna Salai, Chennai, Tamil Nadu, 600002",
  companyState: "Tamil Nadu",
  companyStateCode: "33",
  hsnSacCode: "998599",
};

const BRAND = {
  _id: oid(),
  brandName: "Cafe Mocha",
  legalBusinessName: "Mocha Hospitality Private Limited",
  whatsappNumber: "+919812345678",
  email: "owner@cafemocha.example",
};

const BILLING = {
  brandName: BRAND.brandName,
  legalBusinessName: BRAND.legalBusinessName,
  gstin: "29ABCDE1234F1Z5",
  pan: "ABCDE1234F",
  address: "12 MG Road, Indiranagar, Bengaluru, Karnataka, 560038",
  state: "Karnataka",
  stateCode: "29",
  email: BRAND.email,
  whatsappNumber: BRAND.whatsappNumber,
};

const CUSTOMER_SNAPSHOT = {
  name: "Devashish Rathod",
  whatsappNumber: "+919876543210",
  mobile: "+919876543210",
  email: "devashish@example.com",
};

/** A claim, priced the way `calculateVoucherPricing` prices one. */
const claimPricing = ({ gst = false } = {}) => {
  const base = {
    currency: "INR",
    billAmount: 2000,
    offerTitle: "Weekend 20% Discount",
    offerDiscount: 400,
    netBill: 1600,
    promoCode: "WELCOME50",
    promoDiscount: 50,
    vendorPromoCost: 15,
    platformPromoCost: 35,
    convenienceFee: 20,
    isGstEnabled: false,
    gstPercentage: 0,
    gstAmount: 0,
    taxType: null,
    sacCode: null,
    placeOfSupplyState: "Tamil Nadu",
    placeOfSupplyStateCode: "33",
    totalPayable: 1570,
    amountInPaise: 157000,
    youSaved: 450,
    vendorPayable: 1585,
    commissionPercent: 0,
    commissionAmount: 0,
  };
  if (!gst) return base;
  return {
    ...base,
    isGstEnabled: true,
    gstPercentage: 18,
    taxType: "CGST_SGST",
    cgst: 1.8,
    sgst: 1.8,
    gstAmount: 3.6,
    taxOnTop: 3.6,
    sacCode: "998599",
    totalPayable: 1573.6,
    amountInPaise: 157360,
  };
};

const SUBSCRIPTION = {
  _id: oid(),
  name: "Pro Plus",
  type: "YEARLY",
  durationInYears: 1,
  price: 4999,
};

const subscriptionPricing = () => ({
  currency: "INR",
  listPrice: 4999,
  discountPercent: 10,
  discountAmount: 499.9,
  promoCode: "LAUNCH50",
  promoDiscount: 250,
  taxableValue: 4249.1,
  gstPercentage: 18,
  isGstInclusive: false,
  taxType: "IGST",
  igst: 764.84,
  gstAmount: 764.84,
  hsnSacCode: "998315",
  placeOfSupplyState: "Karnataka",
  placeOfSupplyStateCode: "29",
  totalPayable: 5013.94,
  amountInPaise: 501394,
  youSaved: 749.9,
});

const VALIDITY = {
  startDate: new Date("2026-09-01T05:30:00Z"),
  endDate: new Date("2027-08-31T18:29:00Z"),
};

// ---------------------------------------------------------------- the cases

/**
 * Each case builds its snapshot with the production builder, writes the row the
 * link resolves against, and returns the notice to send.
 */
const buildCases = async () => {
  const cases = [];

  // ---------- 1 & 2: the customer's claim, without and with GST ----------
  for (const gst of [false, true]) {
    const pricing = claimPricing({ gst });
    const claimId = oid();
    const claim = {
      _id: claimId,
      customerId: oid(),
      brandId: BRAND._id,
      voucherId: oid(),
      claimCode: gst ? "TD-GST001" : "TD-CHUJCD",
      versionNumber: 3,
      pricing,
      voucherSnapshot: { name: "Weekend Special — 30% Off" },
      brandSnapshot: { name: BRAND.brandName },
      outletSnapshot: { storeId: "MOCHA-ANNA-01", state: "Tamil Nadu" },
      customerSnapshot: CUSTOMER_SNAPSHOT,
      createdAt: new Date("2026-08-31T13:05:00Z"),
      paidAt: new Date("2026-08-31T13:11:00Z"),
      redeemedAt: new Date("2026-08-31T13:11:00Z"),
    };

    const number = `TD/VCH/26-27/${gst ? "000042" : "000041"}`;
    const documentToken = token();
    const transaction = {
      _id: oid(),
      purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
      gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
      customerId: claim.customerId,
      brandId: BRAND._id,
      amount: pricing.totalPayable,
      paidAmount: pricing.totalPayable,
      status: PAYMENT_STATUS.CAPTURED,
      paymentMethod: "netbanking",
      razorpayPaymentId: gst ? "pay_GSTvwVOB7iGNT" : "pay_TWUEvwVOB7iGNT",
      razorpayOrderId: `order_${RUN}_${gst ? "gst" : "nogst"}`,
      verified: true,
      verifiedAt: claim.paidAt,
      email: CUSTOMER_SNAPSHOT.email,
      contact: CUSTOMER_SNAPSHOT.whatsappNumber,
      invoiceId: number,
      documentToken,
      note: RUN,
    };

    const snapshot = buildVoucherInvoiceSnapshot({
      transaction,
      claim,
      seller: SELLER,
      documentNumber: number,
      billTo: { email: transaction.email, contact: transaction.contact },
    });

    cases.push({
      label: gst
        ? "2. Claim — TAX INVOICE (customer GST on)"
        : "1. Claim — PAYMENT RECEIPT (customer GST off)",
      snapshot,
      write: () =>
        Transaction.create({ ...transaction, invoiceSnapshot: snapshot }),
      notice: () =>
        notices.notifyClaimPaid({ claim, transaction: { ...transaction } }),
    });
  }

  // ---------- 3: the vendor's subscription ----------
  {
    const pricing = subscriptionPricing();
    const number = "TD/SUB/26-27/000018";
    const documentToken = token();
    const transaction = {
      _id: oid(),
      purpose: TRANSACTION_PURPOSE.SUBSCRIPTION,
      gatewayAccount: RAZORPAY_ACCOUNTS.VENDOR,
      brandId: BRAND._id,
      subscriptionId: SUBSCRIPTION._id,
      amount: pricing.totalPayable,
      paidAmount: pricing.totalPayable,
      pricing,
      status: PAYMENT_STATUS.CAPTURED,
      paymentMethod: "card",
      razorpayOrderId: `order_${RUN}_sub`,
      verified: true,
      verifiedAt: VALIDITY.startDate,
      createdAt: new Date("2026-09-01T05:28:00Z"),
      invoiceId: number,
      documentToken,
      note: RUN,
    };

    const snapshot = buildInvoiceSnapshot({
      transaction,
      subscription: SUBSCRIPTION,
      pricing,
      config: SELLER,
      billing: BILLING,
      validity: VALIDITY,
      documentNumber: number,
    });

    cases.push({
      label: "3. Subscription — TAX INVOICE (vendor)",
      snapshot,
      write: () =>
        Transaction.create({ ...transaction, invoiceSnapshot: snapshot }),
      notice: () =>
        notices.notifySubscriptionActivated({
          brand: BRAND,
          subscription: SUBSCRIPTION,
          subscribed: {
            _id: oid(),
            brandId: BRAND._id,
            endDate: VALIDITY.endDate,
            paidAmount: pricing.totalPayable,
          },
          action: SUBSCRIPTION_ACTION.NEW,
          transaction: { ...transaction },
          awaitDelivery: true,
        }),
    });
  }

  // ---------- 4 & 5: the admin grant, collected and free ----------
  for (const free of [false, true]) {
    const pricing = subscriptionPricing();
    const paidAmount = free ? 0 : pricing.totalPayable;
    const number = `TD/GRT/26-27/${free ? "000008" : "000007"}`;
    const documentToken = token();
    const transaction = {
      _id: oid(),
      purpose: TRANSACTION_PURPOSE.SUBSCRIPTION,
      gatewayAccount: RAZORPAY_ACCOUNTS.VENDOR,
      brandId: BRAND._id,
      subscriptionId: SUBSCRIPTION._id,
      gateway: "MANUAL",
      manualPaymentMode: free
        ? MANUAL_PAYMENT_MODES.FREE
        : MANUAL_PAYMENT_MODES.CASH,
      referenceNumber: free ? undefined : "CASH-RCPT-99213",
      note: free
        ? `${RUN} · Goodwill grant — onboarding partner`
        : `${RUN} · Collected at the Chennai office`,
      amount: pricing.totalPayable,
      paidAmount,
      dueAmount: pricing.totalPayable - paidAmount,
      pricing,
      status: PAYMENT_STATUS.CAPTURED,
      verified: true,
      verifiedAt: VALIDITY.startDate,
      createdAt: VALIDITY.startDate,
      razorpayOrderId: `MANUAL-${number}-${RUN}`,
      invoiceId: number,
      documentToken,
    };

    const snapshot = buildInvoiceSnapshot({
      transaction,
      subscription: SUBSCRIPTION,
      pricing,
      config: SELLER,
      billing: BILLING,
      validity: VALIDITY,
      isManual: true,
      paymentMethod: transaction.manualPaymentMode,
      documentNumber: number,
    });

    cases.push({
      label: free
        ? "5. Grant — FREE (nothing collected)"
        : "4. Grant — cash collected at the office",
      snapshot,
      write: () =>
        Transaction.create({ ...transaction, invoiceSnapshot: snapshot }),
      notice: () =>
        notices.notifySubscriptionActivated({
          brand: BRAND,
          subscription: SUBSCRIPTION,
          subscribed: {
            _id: oid(),
            brandId: BRAND._id,
            endDate: VALIDITY.endDate,
            paidAmount,
          },
          action: SUBSCRIPTION_ACTION.NEW,
          isAdminGrant: true,
          transaction: { ...transaction },
          awaitDelivery: true,
        }),
    });
  }

  // ---------- 6: the payout statement, with the commission invoice in it ----
  {
    const settlementNumber = "TD/STL/26-27/000123";
    const commissionInvoiceNumber = "TD/CMN/26-27/000045";
    const documentToken = token();

    const settlement = {
      _id: oid(),
      brandId: BRAND._id,
      settlementNumber,
      commissionInvoiceNumber,
      periodStart: new Date("2026-09-01T00:00:00Z"),
      periodEnd: new Date("2026-09-01T23:59:59Z"),
      paidAt: new Date("2026-09-04T11:00:00Z"),
      cycleType: "DAILY",
      status: SETTLEMENT_STATUS.PAID,
      payoutProvider: "MANUAL_BANK",
      idempotencyKey: `STL:${RUN}`,
      bankSnapshot: {
        accountHolderName: BRAND.legalBusinessName,
        maskedAccountNumber: "********9012",
        accountLast4Digits: "9012",
        ifscCode: "HDFC0001234",
        bankName: "HDFC Bank",
      },
      grossCollected: 10000,
      vendorPromoCost: 150,
      commissionAmount: 500,
      commissionTax: 90,
      commissionDeduction: 590,
      refundAdjustment: 320,
      chargebackAdjustment: 0,
      reserveHeld: 0,
      reserveReleased: 0,
      netPayable: 8940,
      transactionCount: 2,
      documentToken,
      note: RUN,
    };

    const rows = [
      {
        verifiedAt: new Date("2026-09-01T10:00:00Z"),
        invoiceId: "TD/VCH/26-27/000041",
        voucher: {
          claimCode: "TD-CHUJCD",
          billAmount: 2000,
          netBill: 1600,
          vendorPromoCost: 75,
          commissionDeduction: 295,
          vendorPayable: 1230,
        },
      },
      {
        verifiedAt: new Date("2026-09-01T18:40:00Z"),
        invoiceId: "TD/VCH/26-27/000042",
        voucher: {
          claimCode: "TD-GST001",
          billAmount: 8000,
          netBill: 6400,
          vendorPromoCost: 75,
          commissionDeduction: 295,
          vendorPayable: 6030,
        },
      },
    ];

    const legs = [
      {
        legNumber: 1,
        amount: 8940,
        utr: "N123456789012345",
        mode: "NEFT",
        paidAt: settlement.paidAt,
      },
    ];

    const snapshot = buildSettlementDocumentSnapshot({
      settlement,
      brand: BRAND,
      billing: BILLING,
      seller: SELLER,
      rows,
      legs,
      commissionInvoiceNumber,
    });

    cases.push({
      label: "6. Payout statement + commission TAX INVOICE (one PDF, two numbers)",
      snapshot,
      write: () =>
        Settlement.create({ ...settlement, documentSnapshot: snapshot }),
      notice: () =>
        notices.notifyVendorSettlementPaid({
          settlement: { ...settlement },
          utr: legs[0].utr,
        }),
    });
  }

  // ---------- 7 & 8: the refund, full and partial ----------
  for (const full of [true, false]) {
    const pricing = claimPricing();
    const claim = {
      _id: oid(),
      customerId: oid(),
      brandId: BRAND._id,
      claimCode: "TD-CHUJCD",
      pricing,
      voucherSnapshot: { name: "Weekend Special — 30% Off" },
      brandSnapshot: { name: BRAND.brandName },
      outletSnapshot: { storeId: "MOCHA-ANNA-01" },
      customerSnapshot: CUSTOMER_SNAPSHOT,
      paidAt: new Date("2026-08-31T13:11:00Z"),
    };

    const original = {
      _id: oid(),
      invoiceId: "TD/VCH/26-27/000041",
      email: CUSTOMER_SNAPSHOT.email,
      contact: CUSTOMER_SNAPSHOT.whatsappNumber,
      invoiceSnapshot: {
        documentNumber: "TD/VCH/26-27/000041",
        isTaxInvoice: false,
        placeOfSupply: "Tamil Nadu (33)",
      },
    };

    const split = full
      ? {
          totalRefund: 1570,
          netBillRefund: 1550,
          convenienceFeeRefund: 20,
          taxRefund: 0,
          isFullRefund: true,
        }
      : {
          totalRefund: 800,
          netBillRefund: 800,
          convenienceFeeRefund: 0,
          taxRefund: 0,
          isFullRefund: false,
        };

    const number = `TD/REF/26-27/${full ? "000011" : "000012"}`;
    const documentToken = token();
    const refundRequest = {
      _id: oid(),
      claimId: claim._id,
      transactionId: original._id,
      customerId: claim.customerId,
      brandId: BRAND._id,
      claimCode: claim.claimCode,
      requestedAmount: split.totalRefund,
      approvedAmount: split.totalRefund,
      reason: full ? REFUND_REASON.OUTLET_CLOSED : REFUND_REASON.SERVICE_ISSUE,
      reasonNote: full
        ? "Outlet was shut when I arrived at 8pm."
        : "Only part of the order was served.",
      method: full ? REFUND_METHODS.SOURCE : REFUND_METHODS.MANUAL_BANK,
      status: REFUND_REQUEST_STATUS.COMPLETED,
      split,
      utr: full ? undefined : "SBIN426900112233",
      razorpayRefundId: full ? `rfnd_${RUN}` : undefined,
      createdAt: new Date("2026-09-01T04:00:00Z"),
      adminDecisionAt: new Date("2026-09-02T06:00:00Z"),
      completedAt: new Date("2026-09-03T07:30:00Z"),
      documentNumber: number,
      documentToken,
      adminNote: RUN,
    };

    const snapshot = buildRefundDocumentSnapshot({
      refundRequest,
      claim,
      transaction: original,
      seller: SELLER,
      documentNumber: number,
      utr: refundRequest.utr,
    });

    cases.push({
      label: full
        ? "7. Refund — REFUND RECEIPT (full, fee returned)"
        : "8. Refund — REFUND RECEIPT (partial, fee kept)",
      snapshot,
      write: () =>
        RefundRequest.create({ ...refundRequest, documentSnapshot: snapshot }),
      notice: () =>
        notices.notifyClaimRefunded({
          claim,
          transaction: original,
          amount: split.totalRefund,
          reference: refundRequest.utr || refundRequest.razorpayRefundId,
          refundRequest: { ...refundRequest },
        }),
    });
  }

  // ---------- 9: the chargeback advice ----------
  {
    const number = "TD/DBN/26-27/000007";
    const documentToken = token();

    const transaction = {
      _id: oid(),
      invoiceId: "TD/VCH/26-27/000041",
      brandId: BRAND._id,
      verifiedAt: new Date("2026-08-31T13:11:00Z"),
      paymentMethod: "card",
      paidAmount: 1570,
      invoiceSnapshot: {
        documentNumber: "TD/VCH/26-27/000041",
        isTaxInvoice: false,
        placeOfSupply: "Tamil Nadu (33)",
      },
      voucher: {
        claimCode: "TD-CHUJCD",
        billAmount: 2000,
        netBill: 1600,
        vendorPayable: 1585,
      },
      settlementId: oid(),
    };

    const dispute = {
      _id: oid(),
      disputeId: `disp_${RUN}`,
      transactionId: transaction._id,
      brandId: BRAND._id,
      status: DISPUTE_STATUS.LOST,
      amount: 2000,
      reason: "Customer does not recognise this transaction",
      reasonCode: "FRAUD_CARD_ABSENT",
      phase: "chargeback",
      openedAt: new Date("2026-09-02T05:00:00Z"),
      respondBy: new Date("2026-09-05T18:30:00Z"),
      resolvedAt: new Date("2026-09-06T10:00:00Z"),
      documentNumber: number,
      documentToken,
      writtenOffReason: undefined,
      vendorEvidenceNote: RUN,
    };

    const snapshot = buildChargebackDocumentSnapshot({
      dispute,
      transaction,
      brand: BRAND,
      billing: BILLING,
      seller: SELLER,
      documentNumber: number,
    });

    cases.push({
      label: "9. Chargeback — CHARGEBACK ADVICE (vendor)",
      snapshot,
      write: () => Dispute.create({ ...dispute, documentSnapshot: snapshot }),
      notice: () =>
        notices.notifyVendorDisputeResolved({
          dispute: { ...dispute },
          transaction,
          claimCode: transaction.voucher.claimCode,
          won: false,
          recoverable: true,
        }),
    });
  }

  return cases;
};

// ---------------------------------------------------------------- cleanup

const cleanup = async () => {
  const plans = [
    [Transaction, { note: { $regex: `^${MARK}` } }],
    [Transaction, { razorpayOrderId: { $regex: MARK } }],
    [Settlement, { note: { $regex: `^${MARK}` } }],
    [RefundRequest, { adminNote: { $regex: `^${MARK}` } }],
    [Dispute, { vendorEvidenceNote: { $regex: `^${MARK}` } }],
    [Dispute, { disputeId: { $regex: `^disp_${MARK}` } }],
    [VoucherClaim, { cancelReason: { $regex: `^${MARK}` } }],
  ];

  let total = 0;
  for (const [model, filter] of plans) {
    const { deletedCount } = await model.deleteMany(filter);
    if (deletedCount) {
      console.log(`  ${model.modelName.padEnd(16)} ${deletedCount} removed`);
      total += deletedCount;
    }
  }
  console.log(total ? `\n${total} row(s) removed.` : "\nNothing to remove.");
};

// ---------------------------------------------------------------- run

const run = async () => {
  await mongoose.connect(process.env.MONGO_URL);
  console.log(`\n  database: ${mongoose.connection.name}\n`);

  if (CLEANUP) {
    await cleanup();
    await mongoose.disconnect();
    return;
  }

  const cases = await buildCases();
  const tmpDir = path.join(os.tmpdir(), "trydood-doc-verify");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  console.log(`  to:        ${RECIPIENTS.join(", ")}`);
  console.log(`  public:    ${process.env.PUBLIC_API_URL || "(unset — buttons omitted)"}`);
  console.log(`  marker:    ${RUN}`);
  console.log(`  mode:      ${APPLY ? "SENDING" : "dry run (add --apply to send)"}\n`);

  let sent = 0;
  for (const testCase of cases) {
    captured.length = 0;

    // The row the link resolves against, then the email that carries the link.
    if (APPLY) await testCase.write();
    await testCase.notice();

    const notice = captured[0];
    if (!notice) {
      console.log(`  ✗ ${testCase.label} — the notice sent nothing`);
      continue;
    }

    // The rendered document, attached beside the email.
    const { filePath } = await renderDocumentPdf(testCase.snapshot);
    const fileName = `${testCase.snapshot.documentNumber.replace(/\//g, "-")}.pdf`;

    const actions = normaliseActions(notice.mail || {});
    const buttons = actions.map((a) => a.label).join(" · ") || "(none)";

    console.log(`  ${APPLY ? "→" : "·"} ${testCase.label}`);
    console.log(`      title    ${notice.title}`);
    console.log(`      document ${testCase.snapshot.title} — ${testCase.snapshot.documentNumber}`);
    console.log(`      buttons  ${buttons}`);
    console.log(`      pdf      ${fileName}`);

    if (APPLY) {
      const result = await sendMail({
        to: RECIPIENTS.join(", "),
        subject: `[${testCase.label.split(".")[0]}] ${notice.title}`,
        title: notice.title,
        ...(notice.mail || {}),
        body: notice.body,
        attachments: [{ filename: fileName, path: filePath }],
      });
      console.log(`      mail     ${result.sent ? "sent" : `NOT sent — ${result.error}`}`);
      if (result.sent) sent += 1;
    }

    fs.promises.unlink(filePath).catch(() => {});
    console.log("");
  }

  console.log(
    APPLY
      ? `${sent}/${cases.length} sent.\n\n  Rows are marked "${RUN}".\n  Remove them with:  node scripts/sendDocumentVerificationMails.js --cleanup\n`
      : `${cases.length} case(s) ready. Add --apply to write the rows and send.\n`,
  );

  notifyModule.notify = realNotify;
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("\nfailed:", error?.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
