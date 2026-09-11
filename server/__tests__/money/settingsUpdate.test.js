const Joi = require("joi");
const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Setting = require("../../models/Setting");
const { updateSetting } = require("../../services/settings/updateSetting");
const { getCustomerConfig } = require("../../helpers/settings");
const { validateUpdateSetting } = require("../../validator/settings");
const { SETTLEMENT_DEFAULTS } = require("../../constants/customer");

const ADMIN_ID = new mongoose.Types.ObjectId();

/**
 * `PUT /settings/update`, end to end, minus Express.
 *
 * ### ⚠️ The validator has to be in the loop, or the test proves nothing
 *
 * The bug this file exists for was **entirely** in the validator. Calling
 * `updateSetting` with a hand-built payload passes with or without the fix,
 * because the service never rejected anything — `stripUnknown` had already
 * removed the fields before the service saw them. So this runs the payload
 * through the same Joi wrapper `middlewares/validateSchema.js` builds, with the
 * same options, and hands the service only what survives.
 *
 * That is the whole shape of the failure: no error, a `200`, and the response
 * carrying the value the admin did not set.
 */
const throughValidator = (body) => {
  const wrapper = Joi.object({
    body: validateUpdateSetting.body,
    query: Joi.object({}),
    params: Joi.object({}),
    headers: Joi.object({}),
  });

  const { error, value } = wrapper.validate(
    { body, query: {}, params: {}, headers: {} },
    {
      abortEarly: false,
      stripUnknown: true,
      allowUnknown: true,
      convert: true,
    },
  );

  if (error) throw error;
  return value.body;
};

/** What the route does: validate, then merge and save. */
const putSettings = async (body) => updateSetting(ADMIN_ID, throughValidator(body));

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await clearCollections(Setting);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Setting);
});

describe("the reserve risk rules are settable", () => {
  /**
   * ⚠️ All nine, not the four that used to get through.
   *
   * `buildReserveRiskMap` reads every one of these to decide how much of a
   * vendor's payout is held back. Five of them were missing from the validator,
   * so an admin tuning the risk rules changed nothing and was told it worked.
   */
  const RULES = Object.freeze({
    isEnabled: true,
    percent: 8,
    holdDays: 45,
    riskChargebackCount: 3,
    riskLookbackDays: 90,
    riskMinPayments: 50,
    riskDisputeRatePercent: 2,
    riskPercent: 20,
    maxPercent: 35,
  });

  it("stores every reserve field the admin sends", async () => {
    await putSettings({ customer: { settlement: { reserve: RULES } } });

    const stored = await Setting.findOne().lean();

    expect(stored.customer.settlement.reserve).toMatchObject(RULES);
  });

  /**
   * Stored is not the same as used. `buildReserveRiskMap` never touches the
   * document — it is handed `getCustomerConfig().settlement`, so a value that
   * saved correctly but did not survive the read would hold back exactly the
   * same amount as one that never saved at all.
   */
  it("hands those values to the reserve calculation", async () => {
    await putSettings({ customer: { settlement: { reserve: RULES } } });

    const config = await getCustomerConfig();

    expect(config.settlement.reserve).toMatchObject(RULES);
  });

  /**
   * The proof that the numbers are the admin's and not the constants'.
   *
   * Every value above is deliberately different from `SETTLEMENT_DEFAULTS`, so a
   * fallback quietly winning would show up here rather than passing as a
   * coincidence.
   */
  it("does not fall back to the constants once set", async () => {
    await putSettings({ customer: { settlement: { reserve: RULES } } });

    const { reserve } = (await getCustomerConfig()).settlement;

    for (const [key, value] of Object.entries(RULES)) {
      expect(reserve[key]).toBe(value);
      expect(reserve[key]).not.toBe(SETTLEMENT_DEFAULTS.reserve[key]);
    }
  });
});

describe("a partial save leaves its siblings alone", () => {
  /**
   * ⚠️ The `Object.assign` wipe, which is why `NESTED_BLOCKS` exists.
   *
   * Assigning onto a mongoose sub-document replaces a nested path wholesale, so
   * a payload carrying only `percent` re-created `reserve` from its schema
   * defaults and silently reset everything beside it. An admin raising one
   * number would have undone every other one they had tuned.
   */
  it("changing one reserve field keeps the rest", async () => {
    await putSettings({
      customer: {
        settlement: {
          reserve: { holdDays: 45, riskPercent: 20, maxPercent: 35 },
        },
      },
    });

    await putSettings({
      customer: { settlement: { reserve: { percent: 9 } } },
    });

    const { reserve } = (await Setting.findOne().lean()).customer.settlement;

    expect(reserve.percent).toBe(9);
    expect(reserve.holdDays).toBe(45);
    expect(reserve.riskPercent).toBe(20);
    expect(reserve.maxPercent).toBe(35);
  });

  /** And the parent block's own fields, one level up. */
  it("changing a reserve field keeps the settlement block around it", async () => {
    await putSettings({
      customer: { settlement: { delayDays: 5, minPayoutAmount: 250 } },
    });

    await putSettings({
      customer: { settlement: { reserve: { riskPercent: 20 } } },
    });

    const { settlement } = (await Setting.findOne().lean()).customer;

    expect(settlement.delayDays).toBe(5);
    expect(settlement.minPayoutAmount).toBe(250);
    expect(settlement.reserve.riskPercent).toBe(20);
  });
});

describe("the guards around the reserve fields still hold", () => {
  /**
   * ⚠️ A floor of zero means every brand with one chargeback and one sale reads
   * as 100% risky on their first day — the reason the model carries `min: 1`.
   */
  it("refuses riskMinPayments below 1", async () => {
    await expect(
      putSettings({
        customer: { settlement: { reserve: { riskMinPayments: 0 } } },
      }),
    ).rejects.toThrow();
  });

  it.each(["riskPercent", "maxPercent", "riskDisputeRatePercent"])(
    "refuses %s above 100",
    async (field) => {
      await expect(
        putSettings({
          customer: { settlement: { reserve: { [field]: 101 } } },
        }),
      ).rejects.toThrow();
    },
  );

  /**
   * The cross-block rule is enforced on the **merged** document, not by Joi, so
   * widening the reserve block must not have given it a way past.
   */
  it("still refuses a refund path longer than the settlement delay", async () => {
    await expect(
      putSettings({
        customer: {
          settlement: { delayDays: 1 },
          refund: { windowHours: 24, vendorApprovalHours: 24, adminBufferHours: 12 },
        },
      }),
    ).rejects.toThrow(/refund could outlive the settlement/i);
  });
});
