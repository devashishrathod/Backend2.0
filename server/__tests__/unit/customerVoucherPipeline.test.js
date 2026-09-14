/**
 * The two things the customer voucher **detail** pipeline kept getting wrong.
 *
 * Both are whitelist bugs, and both are invisible from the outside: the
 * response is well-formed, the status is 200, and the missing thing looks like
 * a thing that was never there. Structural assertions are the only kind that
 * can see them, which is exactly why they belong here rather than in a manual
 * pass over the app.
 *
 *   1. `banner` was dropped by the stage-4 projection while the final
 *      `$project` still asked for it — so every voucher detail answered
 *      `bannerType: null`, on vouchers whose feed row showed the banner fine.
 *
 *   2. The detail had **no brand gate at all**. The listing grew one after
 *      unverified brands' vouchers were found in the feed; the detail was
 *      missed, so the same voucher stayed openable by direct link.
 */
const mongoose = require("mongoose");
const {
  buildCustomerVoucherPipeline,
  buildCustomerVoucherDetailPipeline,
} = require("../../helpers/vouchers");

const detailPipeline = () =>
  buildCustomerVoucherDetailPipeline({
    voucherId: new mongoose.Types.ObjectId(),
    latitude: 22.7,
    longitude: 75.8,
    maxDistance: 5000,
    outletId: null,
  });

const listingPipeline = () =>
  buildCustomerVoucherPipeline({
    latitude: 22.7,
    longitude: 75.8,
    maxDistance: 5000,
    query: {},
  });

/**
 * An **inclusion** projection drops everything it does not name; an exclusion
 * one (`{ __scratch: 0 }`) drops only what it names. Only the first kind can
 * lose a field, so only the first kind is worth asserting against.
 */
const isInclusionProjection = (stage) => {
  const spec = stage.$project;
  if (!spec) return false;
  return Object.values(spec).some((v) => v === 1 || typeof v === "string" || (v && typeof v === "object"));
};

/** Every stage that silently drops unnamed fields. */
const whitelistStages = (pipeline) =>
  pipeline.filter((s) => isInclusionProjection(s) || s.$group);

const namesField = (stage, field) => {
  const spec = stage.$project || stage.$group;
  return Object.prototype.hasOwnProperty.call(spec, field);
};

describe("voucher detail — banner survives to the response", () => {
  it("is named in every whitelist stage, not just the last one", () => {
    /**
     * The bug was one missing name in one of two whitelists, and fixing only
     * one of them produces an identical symptom — so the assertion is over
     * *all* of them rather than the two that happen to exist today. A third
     * added next year is covered without anybody remembering.
     */
    const stages = whitelistStages(detailPipeline());
    expect(stages.length).toBeGreaterThanOrEqual(2);

    const missing = stages
      .map((s, i) => (namesField(s, "banner") ? null : i))
      .filter((i) => i !== null);

    expect(missing).toEqual([]);
  });

  it("still reaches the final projection", () => {
    const pipeline = detailPipeline();
    const final = pipeline[pipeline.length - 1];
    expect(final.$project).toHaveProperty("banner", 1);
  });
});

describe("voucher detail — only a verified brand's voucher opens", () => {
  const gateOf = (pipeline) =>
    pipeline.find(
      (s) =>
        s.$match?.$expr?.$and &&
        JSON.stringify(s.$match).includes("brand.isApproved"),
    );

  it("applies a brand gate at all", () => {
    // Its absence was the bug. A direct link opened a voucher the feed hid.
    expect(gateOf(detailPipeline())).toBeDefined();
  });

  it("applies the **same** gate the listing does, condition for condition", () => {
    /**
     * The real defect was two surfaces disagreeing about who may be seen, so
     * this compares them rather than restating one of them. Tighten or loosen
     * either and the two stop matching — which is the failure worth catching,
     * not any particular list of flags.
     */
    expect(gateOf(detailPipeline())).toEqual(gateOf(listingPipeline()));
  });

  it("treats an absent flag as not-verified, in both directions", () => {
    // `isRejected` / `isRevoked` are absent on older brands, and in an
    // aggregation expression absent is not false. CLAUDE.md records this exact
    // trap costing two shipped bugs.
    const conditions = gateOf(detailPipeline()).$match.$expr.$and;
    expect(conditions).toHaveLength(4);
    for (const condition of conditions) {
      const [operand] = Object.values(condition);
      expect(JSON.stringify(operand[0])).toContain("$ifNull");
    }
  });

  it("reads the flags it gates on, and returns neither", () => {
    const pipeline = detailPipeline();
    const brandLookup = pipeline.find((s) => s.$lookup?.from === "brands");
    const project = brandLookup.$lookup.pipeline.find((s) => s.$project).$project;

    // Needed by the gate…
    expect(project).toMatchObject({ isRejected: 1, isRevoked: 1, isApproved: 1 });
    // …and customer-facing identity that now matches the listing's brand block.
    expect(project).toMatchObject({ merchantId: 1, brandName: 1 });

    // `mapCustomerBrandBlock` is the whitelist that keeps the flags internal;
    // asserted in brandPlanLookup.test.js, which owns that mapper.
  });

  it("gates after the brand is joined, before the plan is looked up", () => {
    // A gate above the join reads an absent `brand` and drops everything; a
    // gate below the plan lookup pays for a join on rows it then discards.
    const pipeline = detailPipeline();
    const brandJoin = pipeline.findIndex((s) => s.$lookup?.from === "brands");
    const gate = pipeline.findIndex(
      (s) => s.$match?.$expr && JSON.stringify(s.$match).includes("brand.isApproved"),
    );
    const planJoin = pipeline.findIndex((s) => s.$lookup?.from === "subscribeds");

    expect(brandJoin).toBeGreaterThanOrEqual(0);
    expect(gate).toBeGreaterThan(brandJoin);
    expect(planJoin).toBeGreaterThan(gate);
  });
});

describe("voucher listing — unchanged by the detail fixes", () => {
  it("keeps its own brand gate", () => {
    const gate = listingPipeline().find(
      (s) => s.$match?.$expr && JSON.stringify(s.$match).includes("brand.isApproved"),
    );
    expect(gate).toBeDefined();
  });

  it("still resolves the plan after the $group, once per voucher", () => {
    // Moved there so a voucher live at 20 outlets stops paying for the same
    // two joins 20 times. Regressing it is silent — just slower.
    const pipeline = listingPipeline();
    const group = pipeline.findIndex((s) => s.$group);
    const planJoin = pipeline.findIndex((s) => s.$lookup?.from === "subscribeds");
    expect(group).toBeGreaterThanOrEqual(0);
    expect(planJoin).toBeGreaterThan(group);
  });
});
