const JobLock = require("../../models/JobLock");
const {
  JOB_HEALTH_THRESHOLDS,
  JOB_HEALTH_STATUS,
} = require("../../constants/job");

const MINUTE_MS = 60 * 1000;

/**
 * Judge one job from its last successful run.
 *
 * Staleness is measured in multiples of that job's **own** interval, not in
 * absolute minutes — a 15-minute sweep and a 3-hour reminder are both healthy at
 * their own pace, and a fixed threshold would either nag about one or never
 * notice the other.
 *
 * `lastSuccessfulRunAt` and not `lastRunAt` on purpose: a job throwing on every
 * tick is running constantly and working never, and only the success timestamp
 * tells them apart.
 */
const judge = (row, intervalMinutes, jobsEnabled) => {
  if (!jobsEnabled) {
    return { status: JOB_HEALTH_STATUS.DISABLED, ageMinutes: null };
  }
  const lastSuccess = row?.lastSuccessfulRunAt;
  if (!lastSuccess) {
    return { status: JOB_HEALTH_STATUS.NEVER_RUN, ageMinutes: null };
  }

  const ageMinutes = Math.round((Date.now() - lastSuccess.getTime()) / MINUTE_MS);
  const multiple = ageMinutes / intervalMinutes;

  if (multiple >= JOB_HEALTH_THRESHOLDS.CRITICAL_INTERVAL_MULTIPLE) {
    return { status: JOB_HEALTH_STATUS.CRITICAL, ageMinutes };
  }
  if (multiple >= JOB_HEALTH_THRESHOLDS.WARN_INTERVAL_MULTIPLE) {
    return { status: JOB_HEALTH_STATUS.STALE, ageMinutes };
  }
  return { status: JOB_HEALTH_STATUS.OK, ageMinutes };
};

/**
 * The state of every registered job, for the admin health endpoint and the
 * runner's own self-check.
 *
 * The registry is passed in rather than imported, because `jobs/index.js`
 * already imports these helpers and requiring it back would be a cycle.
 *
 * @param {Array<{name: string, intervalMinutes: number}>} registry
 * @param {boolean} jobsEnabled `ENABLE_JOBS` is not false on this instance
 */
exports.getJobHealth = async (registry = [], jobsEnabled = true) => {
  const names = registry.map((job) => job.name);
  const rows = await JobLock.find({ _id: { $in: names } }).lean();
  const byName = new Map(rows.map((row) => [row._id, row]));

  const jobs = registry.map((job) => {
    const row = byName.get(job.name);
    // The interval recorded at the last run wins over the registry's current
    // value: an admin who just raised an interval should not turn a job that was
    // already stale into a healthy one, and the recorded value is the pace the
    // job was actually keeping.
    const intervalMinutes =
      row?.intervalMinutes || job.intervalMinutes || 60;
    const { status, ageMinutes } = judge(row, intervalMinutes, jobsEnabled);

    return {
      name: job.name,
      status,
      intervalMinutes,
      lastSuccessfulRunAt: row?.lastSuccessfulRunAt || null,
      minutesSinceLastSuccess: ageMinutes,
      lastRunAt: row?.lastRunAt || null,
      lastDurationMs: row?.lastDurationMs ?? null,
      lastResult: row?.lastResult ?? null,
      lastError: row?.lastError || null,
      lastFailedAt: row?.lastFailedAt || null,
      consecutiveFailures: row?.consecutiveFailures ?? 0,
      lockedBy: row?.lockedBy || null,
      lockedOutCount: row?.lockedOutCount ?? 0,
      // True while a run is in flight anywhere — a live lease with an owner.
      isRunning: Boolean(
        row?.lockedBy && row?.expiresAt && row.expiresAt.getTime() > Date.now(),
      ),
    };
  });

  const counts = jobs.reduce((acc, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, {});

  // One job in trouble makes the whole runner untrustworthy — these are safety
  // nets, and a partially working safety net is the thing that gets missed.
  const status = jobs.some((j) => j.status === JOB_HEALTH_STATUS.CRITICAL)
    ? JOB_HEALTH_STATUS.CRITICAL
    : jobs.some((j) => j.status === JOB_HEALTH_STATUS.STALE)
      ? JOB_HEALTH_STATUS.STALE
      : jobs.some((j) => j.status === JOB_HEALTH_STATUS.NEVER_RUN)
        ? JOB_HEALTH_STATUS.NEVER_RUN
        : jobsEnabled
          ? JOB_HEALTH_STATUS.OK
          : JOB_HEALTH_STATUS.DISABLED;

  return {
    status,
    jobsEnabled,
    registered: jobs.length,
    counts,
    jobs,
  };
};
