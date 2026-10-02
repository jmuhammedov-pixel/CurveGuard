import fs from "node:fs";
import path from "node:path";
import BN from "bn.js";
import { Connection } from "@solana/web3.js";
import { parse } from "jsonc-parser";

import {
  DynamicBondingCurveClient,
  buildCurve,
  getMigrationThresholdPrice,
  SwapMode
} from "@meteora-ag/dynamic-bonding-curve-sdk";

import {
  buildCurveFromConfig,
  getCurveModeName
} from "./curve-builder.js";

const input = process.argv[2] || "config/dbc_config.jsonc";
const fullPath = path.resolve(input);

if (!fs.existsSync(fullPath)) {
  console.error(`ERROR: config not found: ${fullPath}`);
  process.exit(2);
}

const raw = fs
  .readFileSync(fullPath, "utf8")
  .replace(/^\uFEFF/, "");

const parseErrors = [];

const root = parse(raw, parseErrors, {
  allowTrailingComma: true,
  disallowComments: false
});

if (parseErrors.length) {
  console.error("JSONC parse failed.");
  process.exit(2);
}

if (root.dryRun !== true) {
  console.error(
    "BLOCKED: sequential simulator requires dryRun=true."
  );
  process.exit(3);
}

const dbc = root.dbcConfig || {};

/*
 * v0.3A currently supports QuoteToken fee collection only.
 * This lets us update quote reserve unambiguously.
 */
if (dbc?.fee?.collectFeeMode !== 0) {
  console.error(
    "v0.3A currently requires collectFeeMode=0 (QuoteToken)."
  );
  process.exit(5);
}

const buildCurveMode =
  Number(
    dbc.buildCurveMode ?? 0
  );

let built;

try {
  built =
    buildCurveFromConfig(dbc);

  console.log(
    `Curve builder: mode ${buildCurveMode} / ${getCurveModeName(buildCurveMode)}`
  );

} catch (err) {
  console.error("Meteora buildCurve rejected config:");
  console.error(err?.message || err);
  process.exit(6);
}

/*
 * v0.3B restores Meteora dynamic-fee parameters produced by buildCurve().
 *
 * buildCurve returns DynamicFeeParameters.
 * The on-chain PoolConfig additionally contains initialized/padding fields,
 * so we normalize them here for swapQuote2().
 */
const rawDynamicFee =
  built.poolFees.dynamicFee;

if (!rawDynamicFee) {
  console.error(
    "v0.3B requires dynamicFeeEnabled=true."
  );
  process.exit(7);
}

const dynamicFeeConfig = {
  ...rawDynamicFee,
  initialized: 1,
  padding: [],
  padding2: []
};

const config = {
  ...built,

  migrationSqrtPrice:
    built.migrationSqrtPrice ??
    getMigrationThresholdPrice(
      built.migrationQuoteThreshold,
      built.sqrtStartPrice,
      built.curve
    ),

  poolFees: {
    ...built.poolFees,
    dynamicFee: dynamicFeeConfig
  }
};

const rpc =
  root.rpcUrl ||
  "https://api.devnet.solana.com";

const client =
  DynamicBondingCurveClient.create(
    new Connection(rpc, "confirmed"),
    "confirmed"
  );

const quoteDecimals =
  Number(dbc.token.tokenQuoteDecimal);

const baseDecimals =
  Number(dbc.token.tokenBaseDecimal);

function toUnits(amount, decimals) {
  const s = String(amount);
  const [whole, frac = ""] = s.split(".");

  const padded =
    (frac + "0".repeat(decimals))
      .slice(0, decimals);

  return new BN(
    (
      BigInt(whole || "0") *
        (10n ** BigInt(decimals)) +
      BigInt(padded || "0")
    ).toString()
  );
}

function humanBN(value, decimals) {
  if (value === undefined || value === null) {
    return 0;
  }

  const s = BN.isBN(value)
    ? value.toString()
    : String(value);

  const neg = s.startsWith("-");
  const digits = neg ? s.slice(1) : s;

  const padded =
    digits.padStart(decimals + 1, "0");

  const whole =
    padded.slice(0, -decimals) || "0";

  const frac =
    padded.slice(-decimals)
      .replace(/0+$/, "");

  const text =
    frac ? `${whole}.${frac}` : whole;

  return Number(neg ? `-${text}` : text);
}

function sumBN(...values) {
  return values.reduce(
    (acc, x) =>
      acc.add(
        x ? new BN(x) : new BN(0)
      ),
    new BN(0)
  );
}

function pctBN(part, total) {
  if (!total || total.isZero()) return 0;

  return (
    Number(part.toString()) /
    Number(total.toString())
  ) * 100;
}

function priceFactor(current, start) {
  const a = Number(current.toString());
  const b = Number(start.toString());

  if (!a || !b) return null;

  const ratio = a / b;

  return ratio * ratio;
}

/*
 * ============================================================
 * METEORA VOLATILITY TRACKER
 * ============================================================
 *
 * Ported from the public on-chain Dynamic Bonding Curve program:
 *
 * VolatilityTracker::get_delta_bin_id
 * VolatilityTracker::update_references
 * VolatilityTracker::update_volatility_accumulator
 * PoolState::update_pre_swap
 * PoolState::update_post_swap
 */

const ONE_Q64 =
  new BN(1).ushln(64);

const BASIS_POINT_MAX =
  new BN(10000);

function asBN(value) {
  return BN.isBN(value)
    ? value.clone()
    : new BN(String(value));
}

function getDeltaBinId(
  binStepU128,
  sqrtPriceA,
  sqrtPriceB
) {
  const a = asBN(sqrtPriceA);
  const b = asBN(sqrtPriceB);

  if (a.isZero() || b.isZero()) {
    throw new Error(
      "Volatility reference sqrt price is zero."
    );
  }

  const upper =
    a.gt(b) ? a : b;

  const lower =
    a.gt(b) ? b : a;

  const step =
    asBN(binStepU128);

  if (step.isZero()) {
    throw new Error(
      "Dynamic fee binStepU128 is zero."
    );
  }

  /*
   * On-chain:
   *
   * price_ratio =
   *   (upper_sqrt_price << 64) / lower_sqrt_price
   *
   * delta_bin =
   *   ((price_ratio - ONE_Q64) / bin_step_u128) * 2
   */

  const priceRatio =
    upper
      .ushln(64)
      .div(lower);

  if (priceRatio.lte(ONE_Q64)) {
    return new BN(0);
  }

  return priceRatio
    .sub(ONE_Q64)
    .div(step)
    .muln(2);
}

function updatePreSwap(currentTimestamp) {
  const dynamic =
    config.poolFees.dynamicFee;

  if (
    !dynamic ||
    Number(dynamic.initialized) === 0
  ) {
    return;
  }

  const tracker =
    virtualPool.poolState.volatilityTracker;

  const last =
    Number(
      tracker.lastUpdateTimestamp.toString()
    );

  const elapsed =
    Math.max(
      0,
      currentTimestamp - last
    );

  /*
   * Mirrors VolatilityTracker::update_references().
   */
  if (
    elapsed >=
    Number(dynamic.filterPeriod)
  ) {
    tracker.sqrtPriceReference =
      new BN(
        virtualPool.poolState.sqrtPrice
      );

    if (
      elapsed <
      Number(dynamic.decayPeriod)
    ) {
      tracker.volatilityReference =
        tracker.volatilityAccumulator
          .muln(
            Number(
              dynamic.reductionFactor
            )
          )
          .divn(10000);
    } else {
      tracker.volatilityReference =
        new BN(0);
    }
  }
}

function updatePostSwap(
  oldSqrtPrice,
  currentTimestamp
) {
  const dynamic =
    config.poolFees.dynamicFee;

  if (
    !dynamic ||
    Number(dynamic.initialized) === 0
  ) {
    return;
  }

  const tracker =
    virtualPool.poolState.volatilityTracker;

  /*
   * Defensive fallback.
   * In real on-chain execution the first pre-swap call
   * establishes sqrt_price_reference.
   */
  if (
    tracker.sqrtPriceReference.isZero()
  ) {
    tracker.sqrtPriceReference =
      new BN(oldSqrtPrice);
  }

  /*
   * Mirrors update_volatility_accumulator().
   */
  const deltaFromReference =
    getDeltaBinId(
      dynamic.binStepU128,
      virtualPool.poolState.sqrtPrice,
      tracker.sqrtPriceReference
    );

  const uncapped =
    tracker.volatilityReference.add(
      deltaFromReference.muln(10000)
    );

  const maxAccumulator =
    asBN(
      dynamic.maxVolatilityAccumulator
    );

  tracker.volatilityAccumulator =
    uncapped.gt(maxAccumulator)
      ? maxAccumulator
      : uncapped;

  /*
   * On-chain last_update_timestamp changes
   * only if the swap crossed at least one bin.
   */
  const crossedBins =
    getDeltaBinId(
      dynamic.binStepU128,
      oldSqrtPrice,
      virtualPool.poolState.sqrtPrice
    );

  if (!crossedBins.isZero()) {
    tracker.lastUpdateTimestamp =
      new BN(currentTimestamp);
  }
}

/*
 * One persistent virtual pool.
 */
const virtualPool = {
  poolState: {
    sqrtPrice:
      new BN(config.sqrtStartPrice),

    /*
     * New pools start with their pre-migration token supply
     * in the base vault.
     */
    baseReserve:
      new BN(
        config.tokenSupply
          ?.preMigrationTokenSupply
          ?? 0
      ),

    quoteReserve:
      new BN(0),

    activationPoint:
      new BN(0),

    volatilityTracker: {
      lastUpdateTimestamp:
        new BN(0),

      sqrtPriceReference:
        new BN(0),

      volatilityAccumulator:
        new BN(0),

      volatilityReference:
        new BN(0),

      padding: []
    }
  }
};

let acquiredBase =
  new BN(0);

const startSqrt =
  new BN(config.sqrtStartPrice);

let peakPriceFactor = 1;

const events = [
  {
    name: "RETAIL_1",
    side: "BUY",
    quote: 0.10,
    t: 10
  },
  {
    name: "RETAIL_2",
    side: "BUY",
    quote: 0.15,
    t: 20
  },
  {
    name: "BOT_BURST_1",
    side: "BUY",
    quote: 0.20,
    t: 21
  },
  {
    name: "BOT_BURST_2",
    side: "BUY",
    quote: 0.20,
    t: 22
  },
  {
    name: "BOT_BURST_3",
    side: "BUY",
    quote: 0.20,
    t: 23
  },
  {
    name: "WHALE_BUY",
    side: "BUY",
    quote: 2.00,
    t: 30
  },

  /*
   * Sell 25% of all base tokens accumulated
   * by the simulated traders so far.
   */
  {
    name: "DUMP_25_PERCENT",
    side: "SELL_FRACTION",
    fraction: 0.25,
    t: 40
  },

  {
    name: "SECOND_WHALE",
    side: "BUY",
    quote: 3.00,
    t: 50
  },

  {
    name: "FINAL_PRESSURE",
    side: "BUY",
    quote: 6.00,
    t: 60
  }
];

const rows = [];
const flags = [];

function runBuy(event) {
  const requested =
    toUnits(event.quote, quoteDecimals);

  const oldSqrt =
    new BN(
      virtualPool.poolState.sqrtPrice
    );

  updatePreSwap(event.t);

  const q =
    client.pool.swapQuote2({
      virtualPool,
      config,

      swapBaseForQuote: false,

      swapMode:
        SwapMode.PartialFill,

      amountIn: requested,

      slippageBps: 100,
      hasReferral: false,

      eligibleForFirstSwapWithMinFee:
        false,

      currentPoint:
        new BN(event.t)
    });

  const grossUsed =
    new BN(q.includedFeeInputAmount);

  const netCurveInput =
    new BN(q.excludedFeeInputAmount);

  const baseOut =
    new BN(q.outputAmount);

  const unfilledGross =
    requested.sub(grossUsed);

  /*
   * Quote token entering curve after quote-token fees.
   */
  virtualPool.poolState.quoteReserve =
    virtualPool.poolState.quoteReserve
      .add(netCurveInput);

  /*
   * Partial-fill arithmetic can land exactly one smallest
   * quote unit above migration threshold because of integer
   * rounding. Clamp only that one-unit case.
   *
   * Larger overshoots are intentionally NOT hidden.
   */
  if (
    virtualPool.poolState.quoteReserve.gt(
      config.migrationQuoteThreshold
    )
  ) {
    const excess =
      virtualPool.poolState.quoteReserve.sub(
        config.migrationQuoteThreshold
      );

    if (excess.lte(new BN(1))) {
      virtualPool.poolState.quoteReserve =
        new BN(
          config.migrationQuoteThreshold
        );
    }
  }

  virtualPool.poolState.baseReserve =
    virtualPool.poolState.baseReserve
      .sub(baseOut);

  if (
    virtualPool.poolState.baseReserve.isNeg()
  ) {
    throw new Error(
      "Base reserve became negative."
    );
  }

  virtualPool.poolState.sqrtPrice =
    new BN(q.nextSqrtPrice);

  updatePostSwap(
    oldSqrt,
    event.t
  );

  acquiredBase =
    acquiredBase.add(baseOut);

  return {
    requestedGross:
      humanBN(requested, quoteDecimals),

    consumedGross:
      humanBN(grossUsed, quoteDecimals),

    unfilledGross:
      humanBN(unfilledGross, quoteDecimals),

    output:
      humanBN(baseOut, baseDecimals),

    tradingFee:
      humanBN(q.tradingFee, quoteDecimals),

    protocolFee:
      humanBN(q.protocolFee, quoteDecimals),

    referralFee:
      humanBN(q.referralFee, quoteDecimals),

    sdkAmountLeft:
      humanBN(q.amountLeft, quoteDecimals)
  };
}

function runSell(event) {
  if (acquiredBase.isZero()) {
    throw new Error(
      "No simulated base inventory available to sell."
    );
  }

  const oldSqrt =
    new BN(
      virtualPool.poolState.sqrtPrice
    );

  updatePreSwap(event.t);

  const million =
    new BN(1_000_000);

  const fractionScaled =
    Math.round(event.fraction * 1_000_000);

  const requested =
    acquiredBase
      .mul(new BN(fractionScaled))
      .div(million);

  const q =
    client.pool.swapQuote2({
      virtualPool,
      config,

      swapBaseForQuote: true,

      swapMode:
        SwapMode.PartialFill,

      amountIn: requested,

      slippageBps: 100,
      hasReferral: false,

      eligibleForFirstSwapWithMinFee:
        false,

      currentPoint:
        new BN(event.t)
    });

  const baseUsed =
    new BN(q.includedFeeInputAmount);

  const quoteToTrader =
    new BN(q.outputAmount);

  /*
   * In QuoteToken fee mode on Base->Quote,
   * quote fees are taken from output.
   * Gross quote removed from curve is:
   * trader output + all quote-denominated fees.
   */
  const grossQuoteOut =
    sumBN(
      q.outputAmount,
      q.tradingFee,
      q.protocolFee,
      q.referralFee
    );

  virtualPool.poolState.quoteReserve =
    virtualPool.poolState.quoteReserve
      .sub(grossQuoteOut);

  if (
    virtualPool.poolState.quoteReserve.isNeg()
  ) {
    virtualPool.poolState.quoteReserve =
      new BN(0);
  }

  virtualPool.poolState.baseReserve =
    virtualPool.poolState.baseReserve
      .add(baseUsed);

  virtualPool.poolState.sqrtPrice =
    new BN(q.nextSqrtPrice);

  updatePostSwap(
    oldSqrt,
    event.t
  );

  acquiredBase =
    acquiredBase.sub(baseUsed);

  if (acquiredBase.isNeg()) {
    acquiredBase = new BN(0);
  }

  return {
    requestedBase:
      humanBN(requested, baseDecimals),

    consumedBase:
      humanBN(baseUsed, baseDecimals),

    quoteReceived:
      humanBN(quoteToTrader, quoteDecimals),

    grossQuoteRemoved:
      humanBN(grossQuoteOut, quoteDecimals),

    tradingFee:
      humanBN(q.tradingFee, quoteDecimals),

    protocolFee:
      humanBN(q.protocolFee, quoteDecimals),

    referralFee:
      humanBN(q.referralFee, quoteDecimals),

    sdkAmountLeft:
      humanBN(q.amountLeft, baseDecimals)
  };
}

for (const event of events) {
  const beforeSqrt =
    new BN(
      virtualPool.poolState.sqrtPrice
    );

  const beforeReserve =
    new BN(
      virtualPool.poolState.quoteReserve
    );

  let execution;

  try {
    if (event.side === "BUY") {
      execution = runBuy(event);
    } else {
      execution = runSell(event);
    }
  } catch (err) {
    rows.push({
      name: event.name,
      side: event.side,
      error:
        err?.message || String(err)
    });

    flags.push({
      level: "HIGH",
      event: event.name,
      code: "EXECUTION_REJECTED",
      message:
        err?.message || String(err)
    });

    continue;
  }

  const afterSqrt =
    new BN(
      virtualPool.poolState.sqrtPrice
    );

  const afterReserve =
    new BN(
      virtualPool.poolState.quoteReserve
    );

  const factor =
    priceFactor(
      afterSqrt,
      startSqrt
    );

  peakPriceFactor =
    Math.max(
      peakPriceFactor,
      factor ?? 1
    );

  const migrationPct =
    pctBN(
      afterReserve,
      config.migrationQuoteThreshold
    );

  const totalFeeQuote =
    Number(
      execution.tradingFee || 0
    ) +
    Number(
      execution.protocolFee || 0
    ) +
    Number(
      execution.referralFee || 0
    );

  const feeDenominator =
    event.side === "BUY"
      ? Number(
          execution.consumedGross || 0
        )
      : Number(
          execution.quoteReceived || 0
        ) + totalFeeQuote;

  const effectiveFeeBps =
    feeDenominator > 0
      ? (
          totalFeeQuote /
          feeDenominator
        ) * 10000
      : 0;

  const tracker =
    virtualPool.poolState
      .volatilityTracker;

  const row = {
    name: event.name,
    side: event.side,

    effectiveFeeBps,

    volatilityAccumulator:
      tracker
        .volatilityAccumulator
        .toString(),

    volatilityReference:
      tracker
        .volatilityReference
        .toString(),

    volatilityLastUpdate:
      tracker
        .lastUpdateTimestamp
        .toString(),

    beforeSqrtPrice:
      beforeSqrt.toString(),

    afterSqrtPrice:
      afterSqrt.toString(),

    priceFactorVsLaunch:
      factor,

    quoteReserveBefore:
      humanBN(
        beforeReserve,
        quoteDecimals
      ),

    quoteReserveAfter:
      humanBN(
        afterReserve,
        quoteDecimals
      ),

    migrationProgressPct:
      migrationPct,

    simulatedBaseInventory:
      humanBN(
        acquiredBase,
        baseDecimals
      ),

    execution
  };

  rows.push(row);

  if (
    factor !== null &&
    factor >= 2
  ) {
    flags.push({
      level: "WARN",
      event: event.name,
      code: "PRICE_2X_FROM_LAUNCH",
      message:
        `Spot-price proxy reached ${factor.toFixed(2)}x launch.`
    });
  }

  if (migrationPct >= 80) {
    flags.push({
      level: "HIGH",
      event: event.name,
      code: "MIGRATION_PRESSURE",
      message:
        `Migration reserve reached ${migrationPct.toFixed(2)}%.`
    });
  }

  if (
    event.side === "SELL_FRACTION" &&
    factor !== null
  ) {
    const drawdown =
      peakPriceFactor > 0
        ? (
            (peakPriceFactor - factor) /
            peakPriceFactor
          ) * 100
        : 0;

    row.drawdownFromPeakPct =
      drawdown;

    if (drawdown >= 25) {
      flags.push({
        level: "HIGH",
        event: event.name,
        code: "DUMP_DRAWDOWN",
        message:
          `25% inventory dump caused ${drawdown.toFixed(2)}% drawdown from peak proxy price.`
      });
    }
  }

  /*
   * Stop once the migration quote threshold
   * is reached.
   */
  if (
    afterReserve.gte(
      config.migrationQuoteThreshold
    )
  ) {
    flags.push({
      level: "INFO",
      event: event.name,
      code: "MIGRATION_THRESHOLD_REACHED",
      message:
        "Sequential simulation reached the configured migration quote threshold."
    });

    break;
  }
}

const maxMigration =
  rows
    .filter(x =>
      typeof x.migrationProgressPct === "number"
    )
    .reduce(
      (m, x) =>
        Math.max(
          m,
          x.migrationProgressPct
        ),
      0
    );

const maxPrice =
  rows
    .filter(x =>
      typeof x.priceFactorVsLaunch === "number"
    )
    .reduce(
      (m, x) =>
        Math.max(
          m,
          x.priceFactorVsLaunch
        ),
      1
    );

const dumpRow =
  rows.find(
    x =>
      x.name === "DUMP_25_PERCENT"
  );

let riskScore = 0;

if (maxPrice >= 4) {
  riskScore += 30;
} else if (maxPrice >= 2) {
  riskScore += 15;
}

if (maxMigration >= 90) {
  riskScore += 25;
} else if (maxMigration >= 70) {
  riskScore += 15;
}

if (
  dumpRow?.drawdownFromPeakPct >= 40
) {
  riskScore += 30;
} else if (
  dumpRow?.drawdownFromPeakPct >= 20
) {
  riskScore += 15;
}

riskScore +=
  Math.min(
    20,
    rows.filter(x => x.error).length * 10
  );

riskScore =
  Math.min(100, riskScore);

let riskLevel = "LOW";

if (riskScore >= 60) {
  riskLevel = "CRITICAL";
} else if (riskScore >= 35) {
  riskLevel = "HIGH";
} else if (riskScore >= 15) {
  riskLevel = "MEDIUM";
}

const report = {
  curveGuardVersion: "0.3B",

  engine:
    "Sequential Meteora DBC simulation with on-chain volatility tracker",

  limitations: [
    "Volatility tracker follows the public Meteora DBC on-chain state-transition logic.",
    "Dynamic variable fee is enabled and consumed by the Meteora SDK quote engine.",
    "No blockchain transaction is created or submitted."
  ],

  generatedAt:
    new Date().toISOString(),

  riskLevel,
  riskScore,

  maxPriceFactorVsLaunch:
    maxPrice,

  maxMigrationProgressPct:
    maxMigration,

  events: rows,
  flags
};

fs.mkdirSync(
  "reports",
  { recursive: true }
);

fs.writeFileSync(
  "reports/sequential-v03b-dynamic.json",
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(
  "\n=========================================="
);

console.log(
  " CURVEGUARD v0.3B DYNAMIC STRESS REPORT"
);

console.log(
  "=========================================="
);

console.log(
  "Engine : Persistent curve state"
);

console.log(
  "Fees   : Meteora dynamic volatility fee ENABLED"
);

console.log(
  "Safety : LOCAL SIMULATION ONLY"
);

console.log(
  `Risk   : ${riskLevel}`
);

console.log(
  `Score  : ${riskScore}/100\n`
);

for (const r of rows) {
  console.log(
    `--- ${r.name} / ${r.side} ---`
  );

  if (r.error) {
    console.log(
      `ERROR: ${r.error}`
    );
    continue;
  }

  console.log(
    `Quote reserve : ${r.quoteReserveBefore} -> ${r.quoteReserveAfter}`
  );

  console.log(
    `Migration     : ${r.migrationProgressPct.toFixed(2)}%`
  );

  console.log(
    `Price factor  : ${r.priceFactorVsLaunch.toFixed(4)}x`
  );

  console.log(
    `Fee effective : ${r.effectiveFeeBps.toFixed(4)} bps`
  );

  console.log(
    `Volatility    : ${r.volatilityAccumulator}`
  );

  console.log(
    `Vol reference : ${r.volatilityReference}`
  );

  console.log(
    `Base inventory: ${r.simulatedBaseInventory}`
  );

  if (
    typeof r.drawdownFromPeakPct === "number"
  ) {
    console.log(
      `Peak drawdown : ${r.drawdownFromPeakPct.toFixed(2)}%`
    );
  }

  console.log("");
}

console.log(
  "--------------- FLAGS ----------------"
);

if (!flags.length) {
  console.log("No flags.");
} else {
  for (const f of flags) {
    console.log(
      `[${f.level}] ${f.event} / ${f.code}`
    );

    console.log(
      `  ${f.message}`
    );
  }
}

console.log(
  "\nReport: reports/sequential-v03b-dynamic.json"
);

console.log(
  "No transaction was created, signed, or submitted."
);