/**
 * The brand's live plan, resolved the same way everywhere.
 *
 * These belong in the unit suite rather than the money suite because the whole
 * thing is a pipeline **builder** plus a small pick-the-latest reduction — no
 * session, no transaction, and the two model calls are mocked. What is being
 * protected is not arithmetic but a claim the response makes about a brand.
 *
 * ### What went wrong, and why a test can see it
 *
 * The customer voucher listing resolved the plan by joining
 * `brand.subscribedId → subscribeds → subscriptions`, projecting only
 * `{ subscriptionId: 1 }`. `subscribedId` is never cleared when a plan lapses
 * — `syncBrandSubscriptionState` says so in as many words — so a brand whose
 * plan expired months ago kept rendering its old plan name to customers, for
 * ever, with nothing in the response to contradict it.
 *
 * That is invisible to every other kind of check: the join succeeded, the name
 * was a real plan's name, and the response was well-formed. Only an assertion
 * about *which fields the query filters on* catches it, which is exactly what
 * the first block below does. Revert the helper to the `subscribedId` join and
 * those tests fail.
 */
const {
  buildBrandPlanLookup,
  resolveBrandPlanNames,
  resolveBrandPlanName,
} = require("../../helpers/subscribeds/brandPlanLookup");
const { mapCustomerBrandBlock } = require("../../helpers/vouchers/customerListing");
const { SUBSCRIBED_STATUS } = require("../../constants/subscription");

jest.mock("../../models/Subscribed", () => ({ find: jest.fn() }));
jest.mock("../../models/Subscription", () => ({ find: jest.fn() }));

const Subscribed = require("../../models/Subscribed");
const Subscription = require("../../models/Subscription");

/** Mongoose query chains are fluent; the mock has to be too. */
const chain = (rows) => ({
  select: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
});

const findStage = (stages, collection) =>
  stages.find((stage) => stage.$lookup?.from === collection);

describe("buildBrandPlanLookup — what it joins on", () => {
  const stages = buildBrandPlanLookup({
    localField: "brandId",
    as: "subscriptionPlan",
  });

  const subscribedMatch = findStage(stages, "subscribeds").$lookup.pipeline[0]
    .$match;

  it("keys on brandId, never the stale Brand.subscribedId pointer", () => {
    // The regression that started this. `subscribedId` survives expiry, so any
    // pipeline that mentions it is resolving a plan the brand may not hold.
    expect(JSON.stringify(stages)).not.toContain("subscribedId");
    expect(subscribedMatch.$expr).toEqual({
      $eq: ["$brandId", "$$brandId"],
    });
  });

  it("requires ACTIVE **and** an endDate in the future", () => {
    // Either alone is not enough: a row stuck in ACTIVE with a past endDate is
    // exactly what `getActiveSubscription` self-heals, and status-only would
    // report it as live.
    expect(subscribedMatch.status).toBe(SUBSCRIBED_STATUS.ACTIVE);
    expect(subscribedMatch.endDate.$gt).toBeInstanceOf(Date);
    expect(subscribedMatch.isDeleted).toBe(false);
  });

  it("takes the furthest-dated plan when a brand holds two live ones", () => {
    // An upgrade mid-term leaves both ACTIVE until the sweep runs. Matches
    // getActiveSubscription's `.sort({ endDate: -1 })`.
    const sub = findStage(stages, "subscribeds").$lookup.pipeline;
    expect(sub).toEqual(
      expect.arrayContaining([{ $sort: { endDate: -1 } }, { $limit: 1 }]),
    );
  });

  it("reads only the plan's name, never its price or entitlements", () => {
    const plan = findStage(stages, "subscriptions").$lookup.pipeline;
    expect(plan).toContainEqual({ $project: { name: 1 } });
  });

  it("leaves no scratch fields behind for a response to leak", () => {
    expect(stages[stages.length - 1]).toEqual({
      $project: { __brandPlan: 0, __brandPlanDetail: 0 },
    });
  });
});

describe("buildBrandPlanLookup — where it writes the name", () => {
  it("sets a plain field directly", () => {
    const [, , write] = buildBrandPlanLookup({
      localField: "_id",
      as: "subscriptionPlan",
    });
    expect(write.$addFields.subscriptionPlan).toEqual({
      $ifNull: [{ $arrayElemAt: ["$__brandPlanDetail.name", 0] }, null],
    });
  });

  it("merges a nested field onto its parent only when the parent exists", () => {
    /**
     * The trap this guards. `$addFields: { "brand.subscriptionPlan": … }` on a
     * document whose brand join matched nothing **fabricates**
     * `brand: { subscriptionPlan: null }` — a truthy object with no id and no
     * name, which is worse for a client testing `if (payment.brand)` than the
     * honest absence it replaced.
     */
    const [, , write] = buildBrandPlanLookup({
      localField: "brandId",
      as: "brand.subscriptionPlan",
    });

    expect(write.$addFields).toBeUndefined();
    const [condition, whenPresent, whenAbsent] = write.$set.brand.$cond;
    expect(condition).toEqual({ $eq: [{ $type: "$brand" }, "object"] });
    expect(whenPresent.$mergeObjects[0]).toBe("$brand");
    expect(whenPresent.$mergeObjects[1]).toHaveProperty("subscriptionPlan");
    // Untouched, rather than replaced by a stub object.
    expect(whenAbsent).toBe("$brand");
  });

  it("refuses a target it cannot write correctly", () => {
    // `$mergeObjects` rebuilds exactly one parent, so `a.b.c` would silently
    // write a field nothing reads.
    expect(() =>
      buildBrandPlanLookup({ localField: "_id", as: "a.b.c" }),
    ).toThrow(/at most one level of nesting/);
  });
});

describe("resolveBrandPlanNames", () => {
  beforeEach(() => jest.clearAllMocks());

  it("answers null for a brand with no live plan, never omits it", () => {
    // Every id asked for must be present in the map, so a caller never has to
    // tell "no plan" apart from "not looked up".
    Subscribed.find.mockReturnValue(chain([]));

    return resolveBrandPlanNames(["brand-a", "brand-b"]).then((names) => {
      expect(names.get("brand-a")).toBeNull();
      expect(names.get("brand-b")).toBeNull();
      expect(names.size).toBe(2);
      expect(Subscription.find).not.toHaveBeenCalled();
    });
  });

  it("filters on the same live rule the aggregation uses", async () => {
    Subscribed.find.mockReturnValue(chain([]));
    await resolveBrandPlanNames(["brand-a"]);

    const filter = Subscribed.find.mock.calls[0][0];
    expect(filter.status).toBe(SUBSCRIBED_STATUS.ACTIVE);
    expect(filter.endDate.$gt).toBeInstanceOf(Date);
    expect(filter.isDeleted).toBe(false);
    expect(filter).not.toHaveProperty("subscribedId");
  });

  it("picks the furthest-dated plan, matching the aggregation's $limit 1", async () => {
    // Rows arrive sorted endDate desc, so the first one seen for a brand wins.
    // If the two helpers disagreed here, the same brand would show one plan in
    // a listing and another on its detail page.
    Subscribed.find.mockReturnValue(
      chain([
        { brandId: "brand-a", subscriptionId: "plan-pro" },
        { brandId: "brand-a", subscriptionId: "plan-basic" },
      ]),
    );
    Subscription.find.mockReturnValue(
      chain([{ _id: "plan-pro", name: "Pro" }]),
    );

    const names = await resolveBrandPlanNames(["brand-a"]);
    expect(names.get("brand-a")).toBe("Pro");
    expect(Subscription.find.mock.calls[0][0]._id.$in).toEqual(["plan-pro"]);
  });

  it("resolves a page of brands in two queries, not two per brand", async () => {
    Subscribed.find.mockReturnValue(
      chain([
        { brandId: "brand-a", subscriptionId: "plan-pro" },
        { brandId: "brand-b", subscriptionId: "plan-basic" },
      ]),
    );
    Subscription.find.mockReturnValue(
      chain([
        { _id: "plan-pro", name: "Pro" },
        { _id: "plan-basic", name: "Basic" },
      ]),
    );

    const names = await resolveBrandPlanNames(["brand-a", "brand-b", "brand-c"]);
    expect(names.get("brand-a")).toBe("Pro");
    expect(names.get("brand-b")).toBe("Basic");
    expect(names.get("brand-c")).toBeNull();
    expect(Subscribed.find).toHaveBeenCalledTimes(1);
    expect(Subscription.find).toHaveBeenCalledTimes(1);
  });

  it("does not query at all for an empty or all-null id list", async () => {
    expect((await resolveBrandPlanNames([])).size).toBe(0);
    expect((await resolveBrandPlanNames([null, undefined])).size).toBe(0);
    expect(Subscribed.find).not.toHaveBeenCalled();
  });

  it("resolveBrandPlanName short-circuits a missing id", async () => {
    expect(await resolveBrandPlanName(null)).toBeNull();
    expect(Subscribed.find).not.toHaveBeenCalled();
  });
});

describe("mapCustomerBrandBlock", () => {
  it("carries merchantId and subscriptionPlan on the same object", () => {
    const block = mapCustomerBrandBlock({
      _id: "b1",
      brandName: "Chai Point",
      merchantId: "TD-M-001",
      subscriptionPlan: "Pro",
      isApproved: true,
    });

    expect(block).toMatchObject({
      id: "b1",
      merchantId: "TD-M-001",
      subscriptionPlan: "Pro",
      isVerified: true,
    });
  });

  it("reports an absent plan as null rather than dropping the key", () => {
    // A missing key reads to a client as "the server forgot"; null says "this
    // brand has no live plan", which is the actual answer.
    const block = mapCustomerBrandBlock({ _id: "b1", brandName: "Chai Point" });
    expect(block).toHaveProperty("subscriptionPlan", null);
    expect(block).toHaveProperty("merchantId", null);
    // Absent is not verified — `isApproved` is missing on older brands.
    expect(block.isVerified).toBe(false);
  });

  it("maps a missing brand to null, not an empty shell", () => {
    expect(mapCustomerBrandBlock(null)).toBeNull();
  });
});
