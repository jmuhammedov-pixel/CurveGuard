import fs from "node:fs";
import path from "node:path";
import { parse, printParseErrorCode } from "jsonc-parser";

const input = process.argv[2] || "config/dbc_config.jsonc";
const fullPath = path.resolve(input);

if (!fs.existsSync(fullPath)) {
  console.error(`ERROR: config not found: ${fullPath}`);
  process.exit(2);
}

const raw = fs.readFileSync(fullPath, "utf8").replace(/^\uFEFF/, "");
const parseErrors = [];

const root = parse(raw, parseErrors, {
  allowTrailingComma: true,
  disallowComments: false
});

if (parseErrors.length) {
  console.error("\nJSONC parse errors:");
  for (const e of parseErrors) {
    console.error(
      `- ${printParseErrorCode(e.error)} at offset ${e.offset}`
    );
  }
  process.exit(2);
}

const c = root?.dbcConfig || root || {};

const findings = [];

function add(level, code, message) {
  findings.push({ level, code, message });
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function between(v, min, max) {
  return num(v) && v >= min && v <= max;
}

function placeholder(v) {
  return !v ||
    String(v).includes("YOUR_") ||
    String(v).includes("PLACEHOLDER");
}

/* ---------- execution safety ---------- */

const rpc = String(root.rpcUrl || "");

if (rpc.includes("mainnet") && root.dryRun !== true) {
  add(
    "CRITICAL",
    "MAINNET_LIVE",
    "Mainnet RPC with dryRun=false. CurveGuard blocks this configuration for development."
  );
} else if (root.dryRun !== true) {
  add(
    "WARN",
    "DRY_RUN_OFF",
    "dryRun is not true. Development configs should remain dry-run first."
  );
} else {
  add("INFO", "DRY_RUN_OK", "dryRun=true.");
}

if (!root.quoteMint) {
  add("ERROR", "QUOTE_MINT_MISSING", "quoteMint is required.");
}

/* ---------- curve mode ---------- */

const mode = c.buildCurveMode;

if (!Number.isInteger(mode) || mode < 0 || mode > 5) {
  add(
    "ERROR",
    "CURVE_MODE_INVALID",
    "buildCurveMode must be an integer from 0 to 5."
  );
}

if (mode === 0) {
  if (!between(c.percentageSupplyOnMigration, 0, 100)) {
    add(
      "ERROR",
      "MIGRATION_SUPPLY_INVALID",
      "Mode 0 requires percentageSupplyOnMigration between 0 and 100."
    );
  }

  if (!num(c.migrationQuoteThreshold) || c.migrationQuoteThreshold <= 0) {
    add(
      "ERROR",
      "MIGRATION_THRESHOLD_INVALID",
      "Mode 0 requires migrationQuoteThreshold > 0."
    );
  }
}

if ([1, 2, 3, 4].includes(mode)) {
  if (!num(c.initialMarketCap) || c.initialMarketCap <= 0) {
    add(
      "ERROR",
      "INITIAL_MC_MISSING",
      `Curve mode ${mode} requires initialMarketCap > 0.`
    );
  }

  if (
    !num(c.migrationMarketCap) ||
    c.migrationMarketCap <= Number(c.initialMarketCap || 0)
  ) {
    add(
      "ERROR",
      "MIGRATION_MC_INVALID",
      "migrationMarketCap must be greater than initialMarketCap."
    );
  }
}

if ([2, 4].includes(mode)) {
  if (!between(c.percentageSupplyOnMigration, 0, 100)) {
    add(
      "ERROR",
      "MIGRATION_SUPPLY_INVALID",
      `Curve mode ${mode} requires percentageSupplyOnMigration.`
    );
  }
}

if (mode === 3) {
  if (!Array.isArray(c.liquidityWeights) || c.liquidityWeights.length !== 16) {
    add(
      "ERROR",
      "LIQUIDITY_WEIGHTS_INVALID",
      "buildCurveWithLiquidityWeights requires exactly 16 liquidity weights."
    );
  }
}

if (mode === 4) {
  if (!num(c.midPrice) || c.midPrice <= 0) {
    add(
      "ERROR",
      "MID_PRICE_INVALID",
      "buildCurveWithMidPrice requires midPrice > 0."
    );
  }
}

if (mode === 5) {
  const prices = c.prices;

  if (!Array.isArray(prices) || prices.length < 2) {
    add(
      "ERROR",
      "CUSTOM_PRICES_INVALID",
      "Custom sqrt-price mode requires at least two prices."
    );
  } else {
    for (let i = 1; i < prices.length; i++) {
      if (!(prices[i] > prices[i - 1])) {
        add(
          "ERROR",
          "CUSTOM_PRICES_NOT_ASCENDING",
          "Custom prices must be strictly ascending."
        );
        break;
      }
    }

    if (
      Array.isArray(c.liquidityWeights) &&
      c.liquidityWeights.length !== prices.length - 1
    ) {
      add(
        "ERROR",
        "CUSTOM_WEIGHT_COUNT",
        "For custom prices, liquidityWeights length must equal prices.length - 1."
      );
    }
  }
}

/* ---------- token ---------- */

const token = c.token || {};

if (
  !Number.isInteger(token.tokenBaseDecimal) ||
  token.tokenBaseDecimal < 6 ||
  token.tokenBaseDecimal > 9
) {
  add(
    "ERROR",
    "BASE_DECIMALS_INVALID",
    "tokenBaseDecimal must be between 6 and 9."
  );
}

if (
  !Number.isInteger(token.tokenQuoteDecimal) ||
  token.tokenQuoteDecimal < 0 ||
  token.tokenQuoteDecimal > 18
) {
  add(
    "WARN",
    "QUOTE_DECIMALS_SUSPICIOUS",
    "Check tokenQuoteDecimal against the actual quote mint."
  );
}

if (!num(token.totalTokenSupply) || token.totalTokenSupply <= 0) {
  add(
    "ERROR",
    "TOKEN_SUPPLY_INVALID",
    "totalTokenSupply must be positive."
  );
}

if (
  [3, 4].includes(token.tokenAuthorityOption) &&
  (token.tokenType !== 1 || !c.transferHookProgram)
) {
  add(
    "ERROR",
    "TOKEN_AUTHORITY_HOOK_REQUIRED",
    "Token authority options 3/4 require a Token-2022 transfer-hook configuration."
  );
}

/* ---------- fees ---------- */

const fee = c.fee || {};
const base = fee.baseFeeParams || {};

if (base.baseFeeMode === 2) {
  add(
    "ERROR",
    "RATE_LIMITER_DEPRECATED",
    "BaseFeeMode RateLimiter is rejected for new DBC configs in current SDK versions."
  );
}

if (![0, 1].includes(base.baseFeeMode)) {
  add(
    "ERROR",
    "BASE_FEE_MODE_INVALID",
    "For new DBC configs use Fee Scheduler Linear or Exponential."
  );
}

const sched = base.feeSchedulerParam;

if ([0, 1].includes(base.baseFeeMode)) {
  if (!sched) {
    add(
      "ERROR",
      "FEE_SCHEDULER_MISSING",
      "Fee Scheduler mode requires feeSchedulerParam."
    );
  } else {
    if (!between(sched.startingFeeBps, 25, 9900)) {
      add(
        "ERROR",
        "START_FEE_INVALID",
        "startingFeeBps must be between 25 and 9900."
      );
    }

    if (!between(sched.endingFeeBps, 25, 9900)) {
      add(
        "ERROR",
        "END_FEE_INVALID",
        "endingFeeBps must be between 25 and 9900."
      );
    }

    if (
      num(sched.startingFeeBps) &&
      num(sched.endingFeeBps) &&
      sched.endingFeeBps > sched.startingFeeBps
    ) {
      add(
        "WARN",
        "FEE_SCHEDULE_ASCENDING",
        "Ending fee is higher than starting fee. Confirm that this is intentional."
      );
    }
  }
}

if (!between(fee.creatorTradingFeePercentage, 0, 100)) {
  add(
    "ERROR",
    "CREATOR_FEE_SHARE_INVALID",
    "creatorTradingFeePercentage must be 0..100."
  );
}

if (
  num(fee.poolCreationFee) &&
  fee.poolCreationFee !== 0 &&
  (fee.poolCreationFee < 0.001 || fee.poolCreationFee > 100)
) {
  add(
    "ERROR",
    "POOL_CREATION_FEE_INVALID",
    "poolCreationFee must be 0 or between 0.001 and 100 SOL."
  );
}

/* ---------- migration ---------- */

const migration = c.migration || {};

if (migration.migrationOption === 0) {
  add(
    "ERROR",
    "DAMM_V1_DEPRECATED",
    "New DBC configs may not migrate to deprecated DAMM v1."
  );
}

if (migration.migrationOption !== 1) {
  add(
    "ERROR",
    "MIGRATION_OPTION_INVALID",
    "New configurations should use DAMM v2 migrationOption=1."
  );
}

if (
  !Number.isInteger(migration.migrationFeeOption) ||
  migration.migrationFeeOption < 0 ||
  migration.migrationFeeOption > 6
) {
  add(
    "ERROR",
    "MIGRATION_FEE_OPTION_INVALID",
    "migrationFeeOption must be 0..6."
  );
}

if (
  migration.migrationFeeOption === 6 &&
  !migration.migratedPoolFee
) {
  add(
    "ERROR",
    "CUSTOM_POOL_FEE_MISSING",
    "Customizable migration fee option requires migratedPoolFee."
  );
}

const mf = migration.migrationFee || {};

if (!between(mf.feePercentage ?? 0, 0, 50)) {
  add(
    "ERROR",
    "MIGRATION_FEE_INVALID",
    "migrationFee.feePercentage must be 0..50."
  );
}

if (!between(mf.creatorFeePercentage ?? 0, 0, 100)) {
  add(
    "ERROR",
    "MIGRATION_CREATOR_SHARE_INVALID",
    "migrationFee.creatorFeePercentage must be 0..100."
  );
}

/* ---------- LP distribution ---------- */

const lp = c.liquidityDistribution || {};

const lpFields = [
  "partnerLiquidityPercentage",
  "creatorLiquidityPercentage",
  "partnerPermanentLockedLiquidityPercentage",
  "creatorPermanentLockedLiquidityPercentage"
];

let lpTotal = 0;
let lpComplete = true;

for (const field of lpFields) {
  if (!between(lp[field], 0, 100)) {
    lpComplete = false;
    add(
      "ERROR",
      "LP_FIELD_INVALID",
      `${field} must be between 0 and 100.`
    );
  } else {
    lpTotal += lp[field];
  }
}

if (lpComplete && Math.abs(lpTotal - 100) > 0.000001) {
  add(
    "ERROR",
    "LP_TOTAL_INVALID",
    `LP distribution totals ${lpTotal}%; it must total 100%.`
  );
}

const permanentLocked =
  Number(lp.partnerPermanentLockedLiquidityPercentage || 0) +
  Number(lp.creatorPermanentLockedLiquidityPercentage || 0);

if (permanentLocked < 10) {
  const pv = lp.partnerLiquidityVestingInfoParams;
  const cv = lp.creatorLiquidityVestingInfoParams;

  const hasDayVesting =
    Number(pv?.cliffDurationFromMigrationTime || 0) >= 86400 ||
    Number(cv?.cliffDurationFromMigrationTime || 0) >= 86400;

  if (!hasDayVesting) {
    add(
      "ERROR",
      "LP_LOCK_REQUIREMENT",
      "Less than 10% is permanently locked and no >=1-day LP vesting schedule was detected."
    );
  } else {
    add(
      "WARN",
      "LP_VESTING_REVIEW",
      "Permanent lock is below 10%; verify that LP vesting contributes enough to satisfy the 10% protocol requirement."
    );
  }
}

/* ---------- addresses ---------- */

if (placeholder(c.feeClaimer)) {
  add(
    "WARN",
    "FEE_CLAIMER_PLACEHOLDER",
    "feeClaimer has not been configured yet."
  );
}

if (placeholder(c.leftoverReceiver)) {
  add(
    "WARN",
    "LEFTOVER_RECEIVER_PLACEHOLDER",
    "leftoverReceiver has not been configured yet."
  );
}

/* ---------- score ---------- */

const weights = {
  CRITICAL: 35,
  ERROR: 15,
  WARN: 5,
  INFO: 0
};

let score = findings.reduce(
  (sum, f) => sum + (weights[f.level] || 0),
  0
);

score = Math.min(100, score);

let risk = "LOW";

if (score >= 60) risk = "CRITICAL";
else if (score >= 35) risk = "HIGH";
else if (score >= 15) risk = "MEDIUM";

const report = {
  curveGuardVersion: "0.1.0",
  generatedAt: new Date().toISOString(),
  input: fullPath,
  buildCurveMode: mode,
  riskScore: score,
  riskLevel: risk,
  counts: {
    critical: findings.filter(x => x.level === "CRITICAL").length,
    error: findings.filter(x => x.level === "ERROR").length,
    warn: findings.filter(x => x.level === "WARN").length,
    info: findings.filter(x => x.level === "INFO").length
  },
  findings
};

fs.mkdirSync("reports", { recursive: true });

fs.writeFileSync(
  "reports/latest-risk-report.json",
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log("\n====================================");
console.log("       CURVEGUARD RISK REPORT");
console.log("====================================");
console.log(`Config : ${fullPath}`);
console.log(`Mode   : ${mode}`);
console.log(`Risk   : ${risk}`);
console.log(`Score  : ${score}/100`);
console.log("------------------------------------");

for (const f of findings) {
  console.log(`[${f.level}] ${f.code}`);
  console.log(`  ${f.message}`);
}

console.log("------------------------------------");
console.log("Report : reports/latest-risk-report.json");
console.log("No transaction was created or submitted.");
