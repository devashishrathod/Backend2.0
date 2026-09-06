const PDFDocument = require("pdfkit");

const {
  istDate,
  istDateTime,
  istDateShort,
  money,
  negativeMoney,
  groupIndian,
  row,
  table,
  heading,
  paragraph,
  BOTTOM,
  LEFT,
} = require("../../helpers/documents");

/**
 * The layout primitives and the formatters, tested without a database.
 *
 * These are the two things that made a real customer receipt unreadable: rows
 * that printed on top of each other, and dates formatted in whatever timezone the
 * process happened to run in. Both are the kind of bug that renders "fine" in
 * every code review and only shows up on the page.
 */

/** A throwaway document to draw into. Nothing is written to disk. */
const scratch = () => {
  const doc = new PDFDocument({ margin: 50, size: "A4", compress: false });
  // A sink, so the stream never fills and stalls the test.
  doc.on("data", () => {});
  return doc;
};

describe("document formatters", () => {
  /**
   * The claim in the screenshot that started this: paid at 01 Sep 00:30 IST, which
   * is 31 Aug 19:00 UTC. A UTC server printed "31/8/2026" — the wrong day, on a
   * document of record.
   */
  const justAfterIstMidnight = new Date("2026-08-31T19:00:00.000Z");

  it("formats a date in IST regardless of the process timezone", () => {
    expect(istDate(justAfterIstMidnight)).toBe("1 Sep 2026");
    expect(istDateShort(justAfterIstMidnight)).toBe("01/09/2026");
  });

  it("formats a time in IST and says so", () => {
    expect(istDateTime(justAfterIstMidnight)).toBe("1 Sep 2026, 12:30 AM IST");
  });

  it("keeps noon and midnight on the right side of AM/PM", () => {
    // 12:00 IST === 06:30 UTC, 00:00 IST === 18:30 UTC the day before.
    expect(istDateTime(new Date("2026-08-31T06:30:00.000Z"))).toBe(
      "31 Aug 2026, 12:00 PM IST",
    );
    expect(istDateTime(new Date("2026-08-30T18:30:00.000Z"))).toBe(
      "31 Aug 2026, 12:00 AM IST",
    );
  });

  it("prints a placeholder rather than 'Invalid Date'", () => {
    expect(istDate(null)).toBe("-");
    expect(istDate(undefined)).toBe("-");
    expect(istDate("not a date")).toBe("-");
    expect(istDateTime(null)).toBe("-");
  });

  it("groups digits the Indian way without relying on ICU", () => {
    expect(groupIndian(0)).toBe("0.00");
    expect(groupIndian(999)).toBe("999.00");
    expect(groupIndian(1000)).toBe("1,000.00");
    expect(groupIndian(100000)).toBe("1,00,000.00");
    expect(groupIndian(1234567.5)).toBe("12,34,567.50");
    expect(groupIndian(-2500)).toBe("-2,500.00");
  });

  it("rounds to paise instead of printing a float remainder", () => {
    // 0.1 + 0.2 === 0.30000000000000004
    expect(groupIndian(0.1 + 0.2)).toBe("0.30");
    expect(groupIndian(1079.9999999999999)).toBe("1,080.00");
  });

  /**
   * ⚠️ `Rs. ` and never `₹`. PDFKit's Helvetica is WinAnsi and encodes an
   * unmappable character by truncating its codepoint to the low byte, so U+20B9
   * reaches the page as 0xB9 — `¹`. The payout statement printed `¹1,000.00` on
   * every amount because it passed the screen symbol into the PDF.
   */
  it("prints amounts with a WinAnsi-safe currency prefix", () => {
    expect(money(1000)).toBe("Rs. 1,000.00");
    expect(money(200000)).toBe("Rs. 2,00,000.00");
    expect(negativeMoney(400)).toBe("- Rs. 400.00");
    expect(money(1000)).not.toContain("₹");
  });
});

describe("row()", () => {
  /**
   * The regression. These are the exact three lines from the receipt that came
   * back overlapping — the first label wraps at the old 120pt column width.
   */
  const CLAIM_ROWS = [
    ["Bill collected on behalf of trydood", "Rs. 2,000.00"],
    ["Voucher discount (Weekend 20% Discount)", "- Rs. 400.00"],
    ["Convenience fee (Trydood)", "Rs. 20.00"],
  ];

  it("never moves the cursor backwards", () => {
    const doc = scratch();
    let previous = doc.y;

    for (const [label, value] of CLAIM_ROWS) {
      row(doc, label, value);
      expect(doc.y).toBeGreaterThan(previous);
      previous = doc.y;
    }
    doc.end();
  });

  it("advances past a label that wraps, not past the value", () => {
    const doc = scratch();
    // Long enough to wrap even in the 330pt column.
    const wrapping =
      "Bill collected on behalf of a brand with an extremely long registered " +
      "trading name that will not fit on one line at all";

    const before = doc.y;
    row(doc, wrapping, "Rs. 1.00");
    const oneLine = doc.y - before;

    const doc2 = scratch();
    const before2 = doc2.y;
    row(doc2, "Short", "Rs. 1.00");
    const shortRow = doc2.y - before2;

    // The wrapped row must be taller than a single-line row. Before the fix it
    // was the same height, because the value cell decided the advance.
    expect(oneLine).toBeGreaterThan(shortRow);
    doc.end();
    doc2.end();
  });

  it("leaves the cursor at the left margin so the next block is not indented", () => {
    const doc = scratch();
    row(doc, "Taxable Value", "Rs. 800.00");
    expect(doc.x).toBe(LEFT);
    doc.end();
  });

  it("starts a new page rather than drawing past the bottom margin", () => {
    const doc = scratch();
    let pages = 1;
    doc.on("pageAdded", () => {
      pages += 1;
    });

    // Far more rows than one A4 page holds.
    for (let index = 0; index < 120; index += 1) {
      row(doc, `Line item number ${index}`, money(index * 11.5));
    }

    expect(pages).toBeGreaterThan(1);
    expect(doc.y).toBeLessThanOrEqual(BOTTOM);
    doc.end();
  });
});

describe("table()", () => {
  const COLUMNS = [
    { label: "Date", width: 70 },
    { label: "Claim", width: 120 },
    { label: "Bill", width: 80, align: "right" },
    { label: "Your share", width: 90, align: "right" },
  ];

  it("keeps rows in order and never overlaps them", () => {
    const doc = scratch();
    const rows = Array.from({ length: 8 }, (_, index) => [
      istDateShort(new Date("2026-08-31T19:00:00.000Z")),
      `TD-CLAIM${index}`,
      money(2000),
      money(1620),
    ]);

    const start = doc.y;
    table(doc, { columns: COLUMNS, rows });
    // Eight rows plus a header must have consumed real vertical space.
    expect(doc.y).toBeGreaterThan(start + 8 * 10);
    doc.end();
  });

  it("repeats the header when the body runs onto a new page", () => {
    const doc = scratch();
    let pages = 1;
    doc.on("pageAdded", () => {
      pages += 1;
    });

    const rows = Array.from({ length: 90 }, (_, index) => [
      "01/09/2026",
      `TD-LONGCLAIMCODE${index}`,
      money(2000),
      money(1620),
    ]);

    table(doc, { columns: COLUMNS, rows });
    expect(pages).toBeGreaterThan(1);
    expect(doc.y).toBeLessThanOrEqual(BOTTOM);
    doc.end();
  });

  it("says so plainly when there is nothing to list", () => {
    const doc = scratch();
    const start = doc.y;
    table(doc, {
      columns: COLUMNS,
      rows: [],
      emptyText: "No claims settled in this period.",
    });
    expect(doc.y).toBeGreaterThan(start);
    doc.end();
  });
});

describe("heading() and paragraph()", () => {
  it("advance the cursor and reset x to the margin", () => {
    const doc = scratch();
    const start = doc.y;

    heading(doc, "Summary");
    paragraph(doc, "Refunds and chargebacks from earlier periods are deducted here.");

    expect(doc.y).toBeGreaterThan(start);
    expect(doc.x).toBe(LEFT);
    doc.end();
  });
});
