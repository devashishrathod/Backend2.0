const {
  resolveVendorName,
  resolveDocumentTitle,
  istDateShort,
  money,
} = require("../documents");
const {
  DOCUMENT_KIND,
  DOCUMENT_TITLE,
} = require("../../constants/document");
const { GST_TAX_TYPES } = require("../../constants/subscription");

/**
 * Split the commission's GST the way the place of supply requires.
 *
 * Intra-state prints CGST + SGST at half the rate each; inter-state a single
 * IGST line. The rate is worded into the label so a re-issue after the slab
 * changes still shows what was actually charged.
 */
const commissionTaxLines = ({ commissionTax, commissionAmount, taxType }) => {
  const tax = Number(commissionTax) || 0;
  if (tax <= 0) return [];

  const base = Number(commissionAmount) || 0;
  const rate = base > 0 ? (tax / base) * 100 : 0;

  if (taxType === GST_TAX_TYPES.IGST) {
    return [{ label: `IGST @ ${rate.toFixed(2)}%`, amount: tax }];
  }
  return [
    { label: `CGST @ ${(rate / 2).toFixed(2)}%`, amount: tax / 2 },
    { label: `SGST @ ${(rate / 2).toFixed(2)}%`, amount: tax / 2 },
  ];
};

/**
 * Everything a payout statement prints, frozen when the payout is confirmed.
 *
 * ### Two documents, one piece of paper
 *
 * The outer document is a **payout statement** — what the vendor's sales came to,
 * what came off, and what reached their bank. The `supplement` is a **tax
 * invoice** for the commission Trydood charged them, with its own number in its
 * own series, its own GSTINs, its own SAC and its own total.
 *
 * They are two documents under GST and are numbered as two, but a vendor should
 * not have to reconcile two files for one payout, so they print together.
 *
 * ### ⚠️ Why this is frozen rather than assembled at download time
 *
 * The statement used to be built from live queries the first time somebody opened
 * the link. Everything it read can still move: a rebuild releases tainted rows, a
 * bounced payout retries with a new leg, a later refund is claimed against the
 * brand. A vendor who downloaded the same link twice could get two different
 * documents with our name on them — and only the second would match the books.
 *
 * Frozen at `PAID`, which is the first moment nothing behind it can change.
 *
 * ### What is deliberately not on it
 *
 * `platformPromoCost`, `gatewayFee` and `netReceived` sit on the same
 * sub-document as the vendor's own figures and none of them are theirs — they are
 * our margin and our cost. `buildSettlementReadPipeline` makes that decision once
 * for the API; this makes the same one for the paper.
 *
 * ### Why every deduction is itemised
 *
 * A vendor whose ₹10,000 of sales pays out ₹8,820 will ask why, and the answer
 * has to be **on the document** — not in an email, not from support. Every line
 * that reduces the payout is named, and the zero ones are printed too, so the
 * arithmetic can be followed rather than trusted.
 *
 * @param {object} args
 * @param {object} args.settlement
 * @param {object} args.brand              brandName / legalBusinessName
 * @param {object} args.billing            buildBillingDetails() — the vendor's tax identity
 * @param {object} args.seller             getSubscriptionConfig() — Trydood
 * @param {Array}  args.rows               the claimed transactions, oldest first
 * @param {Array}  args.legs               the PAID payout legs
 * @param {string} [args.commissionInvoiceNumber] omitted when no commission was charged
 */
exports.buildSettlementDocumentSnapshot = ({
  settlement,
  brand = {},
  billing = {},
  seller = {},
  rows = [],
  legs = [],
  commissionInvoiceNumber,
}) => {
  const vendorName = resolveVendorName({
    brandName: brand.brandName,
    legalBusinessName: brand.legalBusinessName,
    whatsappNumber: billing.whatsappNumber,
  });

  const bank = settlement.bankSnapshot || {};
  const commissionAmount = Number(settlement.commissionAmount) || 0;
  const commissionTax = Number(settlement.commissionTax) || 0;
  const hasCommission = commissionAmount > 0 || commissionTax > 0;

  // ---------------- what came off ----------------
  //
  // The zero rows are printed on purpose: the day commission is switched on, a
  // vendor comparing two months sees a number move rather than a row appearing
  // from nowhere.
  const lineItems = [
    { label: "Sales collected", amount: settlement.grossCollected },
    {
      label: "Less: your share of promotions",
      amount: settlement.vendorPromoCost,
      isDeduction: true,
    },
    {
      label: "Less: Trydood commission",
      amount: settlement.commissionDeduction ?? commissionAmount,
      isDeduction: true,
    },
    {
      label: "Less: refunds from earlier periods",
      amount: settlement.refundAdjustment,
      isDeduction: true,
    },
    {
      label: "Less: chargebacks recovered",
      amount: settlement.chargebackAdjustment,
      isDeduction: true,
    },
  ];

  if (Number(settlement.reserveHeld) > 0) {
    lineItems.push({
      label: "Less: reserve held",
      amount: settlement.reserveHeld,
      isDeduction: true,
    });
  }
  if (Number(settlement.reserveReleased) > 0) {
    lineItems.push({
      label: "Add: reserve released",
      amount: settlement.reserveReleased,
    });
  }

  // ---------------- where it went ----------------
  const details = [
    {
      label: "Period",
      value: `${istDateShort(settlement.periodStart)} to ${istDateShort(settlement.periodEnd)}`,
    },
    { label: "Cycle", value: settlement.cycleType || "-" },
    { label: "Account holder", value: bank.accountHolderName || "-" },
    {
      /**
       * ⚠️ The masked number only. A statement is forwarded, screenshotted and
       * pasted into support chats — a full account number would end up in every
       * one of those places for ever.
       */
      label: "Account",
      value:
        bank.maskedAccountNumber || `****${bank.accountLast4Digits || "----"}`,
    },
    { label: "IFSC", value: bank.ifscCode || "-" },
    { label: "Bank", value: bank.bankName || "-" },
  ];

  /**
   * The UTR is the point of the transfers block. Three days after a vendor says
   * the money never arrived, it is the only thing that can be looked up on a bank
   * statement — so it goes on the paper they already have.
   */
  for (const leg of legs) {
    details.push({
      label: `Transfer ${leg.legNumber || ""}`.trim(),
      value: `${istDateShort(leg.paidAt)} · ${leg.mode || "NEFT"} · UTR ${leg.utr || "-"} · ${money(leg.amount)}`,
    });
  }

  const timeline = [
    { label: "Period ended", at: settlement.periodEnd },
    { label: "Paid", at: settlement.paidAt },
  ].filter((entry) => entry.at);

  // ---------------- the claims it paid for ----------------
  const table = {
    title: `Claims in this period (${settlement.transactionCount ?? rows.length})`,
    emptyText: "No claims settled in this period.",
    columns: [
      { label: "Date", width: 70 },
      { label: "Claim", width: 125 },
      { label: "Bill", width: 75, align: "right" },
      { label: "Net bill", width: 75, align: "right" },
      { label: "Deductions", width: 75, align: "right" },
      { label: "Your share", width: 75, align: "right" },
    ],
    rows: rows.map((row) => {
      const deductions =
        (Number(row.voucher?.vendorPromoCost) || 0) +
        // ⚠️ The deduction, not the bare commission — with GST on top of the
        // commission the two differ, and the statement has to show what actually
        // came off. Falls back for a claim frozen before the field existed.
        (Number(
          row.voucher?.commissionDeduction ?? row.voucher?.commissionAmount,
        ) || 0);

      return [
        istDateShort(row.verifiedAt),
        String(row.voucher?.claimCode || row.invoiceId || "-"),
        money(row.voucher?.billAmount),
        money(row.voucher?.netBill),
        deductions ? `- ${money(deductions)}` : money(0),
        money(row.voucher?.vendorPayable),
      ];
    }),
  };

  /**
   * The commission tax invoice, printed inside the statement.
   *
   * Built only when commission was actually charged. The rate is zero today, so
   * emitting an empty tax invoice would put a GST document in a vendor's hands
   * for a supply that did not happen.
   */
  const supplement = hasCommission
    ? {
        title: "TAX INVOICE — Trydood commission",
        subtitle:
          "For the platform commission on the claims listed above. This is a supply from Trydood to you.",
        documentNumber: commissionInvoiceNumber,
        isTaxInvoice: commissionTax > 0,
        seller: {
          name: seller.companyName,
          gstin: seller.companyGstin,
          address: seller.companyAddress,
          state: seller.companyState,
          stateCode: seller.companyStateCode,
        },
        billTo: {
          name: vendorName,
          legalName: brand.legalBusinessName,
          gstin: billing.gstin,
          address: billing.address,
          state: billing.state,
          stateCode: billing.stateCode,
        },
        placeOfSupply: billing.state
          ? `${billing.state}${billing.stateCode ? ` (${billing.stateCode})` : ""}`
          : undefined,
        hsnSacCode: seller.hsnSacCode,
        meta: [
          { label: "Period", value: `${istDateShort(settlement.periodStart)} to ${istDateShort(settlement.periodEnd)}` },
          { label: "Against Statement", value: settlement.settlementNumber || "-" },
        ],
        lineItems: [
          { label: "Platform commission", amount: commissionAmount },
        ],
        taxLines: commissionTaxLines({
          commissionTax,
          commissionAmount,
          // Same state as ours means an intra-state supply.
          taxType:
            billing.stateCode && seller.companyStateCode &&
            String(billing.stateCode) !== String(seller.companyStateCode)
              ? GST_TAX_TYPES.IGST
              : GST_TAX_TYPES.CGST_SGST,
        }),
        total: {
          label: "Commission total",
          amount: commissionAmount + commissionTax,
        },
        notes: [
          "This amount has already been deducted from the payout above. Nothing further is due.",
        ],
      }
    : undefined;

  return {
    version: 2,
    kind: DOCUMENT_KIND.PAYOUT_STATEMENT,
    title: resolveDocumentTitle({
      kind: DOCUMENT_KIND.PAYOUT_STATEMENT,
      isTaxInvoice: false,
    }),
    subtitle: "Issued by Trydood",
    // The statement itself carries no tax; the commission invoice inside it does.
    isTaxInvoice: false,
    issuedAt: new Date(),
    documentNumber: settlement.settlementNumber,

    seller: {
      name: seller.companyName,
      gstin: seller.companyGstin,
      address: seller.companyAddress,
      state: seller.companyState,
      stateCode: seller.companyStateCode,
    },
    billTo: {
      name: vendorName,
      legalName: brand.legalBusinessName,
      gstin: billing.gstin,
      address: billing.address,
      state: billing.state,
      stateCode: billing.stateCode,
    },

    meta: [
      { label: "Statement No", value: settlement.settlementNumber || "-" },
      ...(commissionInvoiceNumber
        ? [{ label: "Commission Invoice No", value: commissionInvoiceNumber }]
        : []),
    ],
    details,
    timeline,
    lineItems,
    taxLines: [],
    total: { label: "Net paid to you", amount: settlement.netPayable },
    table,
    supplement,
    notes: [
      "Refunds and chargebacks from earlier periods are deducted here rather than netted against the claim they came from, so each period's claims stay readable.",
      ...(hasCommission
        ? ["The commission tax invoice below covers the commission line above."]
        : []),
    ],

    paymentStatus: settlement.status,
    paymentMethod: settlement.payoutProvider,
    isManual: true,
  };
};

exports.SETTLEMENT_DOCUMENT_TITLE = DOCUMENT_TITLE.PAYOUT_STATEMENT;
exports.commissionTaxLines = commissionTaxLines;
