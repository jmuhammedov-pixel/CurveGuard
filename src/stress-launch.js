import fs from "node:fs";
import path from "node:path";
import BN from "bn.js";
import { Connection } from "@solana/web3.js";
import { parse } from "jsonc-parser";

import {
  DynamicBondingCurveClient,
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

const raw = fs.readFileSync(fullPath, "utf8").replace(/^\uFEFF/, "");
const errors = [];
const root = parse(raw, errors, {
  allowTrailingComma: true,
  disallowComments: false
});

if (errors.length) {
  console.error("JSONC parse failed.");
  process.exit(2);
}

if (root.dryRun !== true) {
  console.error("BLOCKED: CurveGuard Stress Engine requires dryRun=true.");
  process.exit(3);
}

const dbc = root.dbcConfig || {};

const buildCurveMode =
  Number(
    dbc.buildCurveMode ?? 0
  );

let curveConfig;

try {
  curveConfig =
    buildCurveFromConfig(dbc);

  console.log(
    `Curve builder: mode ${buildCurveMode} / ${getCurveModeName(buildCurveMode)}`
  );

} catch (err) {
  console.error(
    "\nMeteora curve builder rejected this configuration:"
  );

  console.error(
    err?.message ||
    err
  );

  process.exit(5);
}

const rpc =
  root.rpcUrl ||
  "https://api.devnet.solana.com";

const client = DynamicBondingCurveClient.create(
  new Connection(rpc, "confirmed"),
  "confirmed"
);

const quoteDecimals =
  Number(dbc?.token?.tokenQuoteDecimal ?? 9);

const baseDecimals =
  Number(dbc?.token?.tokenBaseDecimal ?? 6);

function toBaseUnits(amount, decimals) {
  const scale = 10n ** BigInt(decimals);

  const text = String(amount);
  const [whole, frac = ""] = text.split(".");

  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);

  return new BN(
    (
      BigInt(whole || "0") * scale +
      BigInt(padded || "0")
    ).toString()
  );
}

function human(bnValue, decimals) {
  if (bnValue === undefined || bnValue === null) return null;

  const s = BN.isBN(bnValue)
    ? bnValue.toString()
    : String(bnValue);

  const negative = s.startsWith("-");
  const digits = negative ? s.slice(1) : s;

  const padded =
    digits.padStart(decimals + 1, "0");

  const whole =
    padded.slice(0, padded.length - decimals);

  const fraction =
    padded
      .slice(padded.length - decimals)
      .replace(/0+$/, "");

  const out =
    fraction.length
      ? `${whole}.${fraction}`
      : whole;

  return negative ? `-${out}` : out;
}

function serialise(value) {
  if (BN.isBN(value)) {
    return value.toString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(serialise);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(
        ([k, v]) => [k, serialise(v)]
      )
    );
  }

  return value;
}

const scenarios = [
  {
    name: "MICRO_BUY",
    amount: "0.01",
    mode: SwapMode.ExactIn
  },
  {
    name: "RETAIL_BUY",
    amount: "0.10",
    mode: SwapMode.ExactIn
  },
  {
    name: "STRONG_RETAIL",
    amount: "0.50",
    mode: SwapMode.ExactIn
  },
  {
    name: "LARGE_BUY",
    amount: "1.00",
    mode: SwapMode.ExactIn
  },
  {
    name: "WHALE_BUY",
    amount: "5.00",
    mode: SwapMode.ExactIn
  },
  {
    name: "MIGRATION_PRESSURE",
    amount: "9.00",
    mode: SwapMode.PartialFill
  },
  {
    name: "OVERSIZED_WHALE",
    amount: "25.00",
    mode: SwapMode.PartialFill
  }
];

const results = [];

for (const scenario of scenarios) {
  const amountIn =
    toBaseUnits(scenario.amount, quoteDecimals);

  try {
    const quote =
      client.pool.getQuoteFromInputAmount({
        config: curveConfig,
        swapBaseForQuote: false,
        amountIn,
        swapMode: scenario.mode,
        slippageBps: 100,
        hasReferral: false,
        eligibleForFirstSwapWithMinFee: false,
        currentPoint: new BN(0)
      });

    const outputHuman =
      human(quote.outputAmount, baseDecimals);

    const leftHuman =
      human(quote.amountLeft, quoteDecimals);

    const includedHuman =
      human(
        quote.includedFeeInputAmount,
        quoteDecimals
      );

    const excludedHuman =
      human(
        quote.excludedFeeInputAmount,
        quoteDecimals
      );

    const requested =
      Number(scenario.amount);

    // For partial fills, use the SDK's includedFeeInputAmount
    // as the actual gross input consumed.
    const includedGross =
      Number(includedHuman || 0);

    const excludedNet =
      Number(excludedHuman || 0);

    // amountLeft is retained as the SDK's low-level/net leftover.
    const sdkAmountLeftNet =
      Number(leftHuman || 0);

    const consumed =
      includedGross;

    const unfilledGross =
      Math.max(0, requested - includedGross);

    const output =
      Number(outputHuman || 0);

    const rate =
      consumed > 0
        ? output / consumed
        : 0;

    results.push({
      name: scenario.name,
      requestedQuote: requested,
      consumedQuote: consumed,
      unfilledQuote: unfilledGross,
      sdkAmountLeftNet,
      excludedInputNet: excludedNet,
      outputBaseTokens: output,
      tokensPerQuote: rate,

      minimumAmountOut:
        human(
          quote.minimumAmountOut,
          baseDecimals
        ),

      includedFeeInput:
        includedHuman,

      excludedFeeInput:
        excludedHuman,

      nextSqrtPrice:
        quote.nextSqrtPrice?.toString?.()
          ?? null,

      mode:
        scenario.mode === SwapMode.PartialFill
          ? "PARTIAL_FILL"
          : "EXACT_IN",

      raw: serialise(quote)
    });

  } catch (err) {
    results.push({
      name: scenario.name,
      requestedQuote:
        Number(scenario.amount),
      mode:
        scenario.mode === SwapMode.PartialFill
          ? "PARTIAL_FILL"
          : "EXACT_IN",
      error:
        err?.message || String(err)
    });
  }
}

const baseline =
  results.find(
    x =>
      x.name === "MICRO_BUY" &&
      !x.error &&
      x.tokensPerQuote > 0
  )?.tokensPerQuote || null;

const flags = [];

for (const r of results) {
  if (r.error) {
    flags.push({
      level: "WARN",
      scenario: r.name,
      code: "QUOTE_REJECTED",
      message: r.error
    });

    continue;
  }

  if (
    (r.unfilledQuote ?? 0) > 0.000000001 ||
    (r.sdkAmountLeftNet ?? 0) > 0
  ) {
    flags.push({
      level: "HIGH",
      scenario: r.name,
      code: "CURVE_CAPACITY_HIT",
      message:
        `${r.unfilledQuote.toFixed(9)} gross quote was not consumed ` +
        `(SDK amountLeft=${r.sdkAmountLeftNet}).`
    });
  }

  if (
    baseline &&
    r.tokensPerQuote > 0
  ) {
    r.averagePriceImpactPct =
      ((baseline - r.tokensPerQuote) /
        baseline) *
      100;

    if (r.averagePriceImpactPct >= 25) {
      flags.push({
        level: "HIGH",
        scenario: r.name,
        code: "SEVERE_PRICE_IMPACT",
        message:
          `Average execution degraded by ${r.averagePriceImpactPct.toFixed(2)}% versus micro-buy baseline.`
      });

    } else if (
      r.averagePriceImpactPct >= 10
    ) {
      flags.push({
        level: "WARN",
        scenario: r.name,
        code: "HIGH_PRICE_IMPACT",
        message:
          `Average execution degraded by ${r.averagePriceImpactPct.toFixed(2)}% versus micro-buy baseline.`
      });
    }
  }
}

const successful =
  results.filter(x => !x.error);

const impacts =
  successful
    .map(x => x.averagePriceImpactPct)
    .filter(
      x =>
        typeof x === "number" &&
        Number.isFinite(x)
    );

const worstImpact =
  impacts.length
    ? Math.max(...impacts)
    : null;

const capacityHits =
  flags.filter(
    x => x.code === "CURVE_CAPACITY_HIT"
  ).length;

const errorsCount =
  results.filter(x => x.error).length;

let riskScore = 0;

if (worstImpact !== null) {
  if (worstImpact >= 40) riskScore += 45;
  else if (worstImpact >= 25) riskScore += 30;
  else if (worstImpact >= 10) riskScore += 15;
}

riskScore +=
  Math.min(30, capacityHits * 15);

riskScore +=
  Math.min(25, errorsCount * 10);

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
  curveGuardVersion: "0.2.1",
  engine: "Meteora DBC launch-state quote stress matrix",

  importantNote:
    "Each scenario is independently simulated from fresh launch state. This is not yet a sequential multi-trade pool-state simulation.",

  generatedAt:
    new Date().toISOString(),

  sdkConfig: {
    buildCurveMode,
    quoteDecimals,
    baseDecimals
  },

  riskLevel,
  riskScore,

  worstAveragePriceImpactPct:
    worstImpact,

  capacityHits,
  quoteErrors: errorsCount,

  scenarios: results,
  flags
};

fs.mkdirSync("reports", {
  recursive: true
});

fs.writeFileSync(
  "reports/latest-stress-report.json",
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(
  "\n========================================"
);

console.log(
  "     CURVEGUARD v0.2 STRESS REPORT"
);

console.log(
  "========================================"
);

console.log(
  "Engine : Meteora SDK launch-state quotes"
);

console.log(
  "Safety : LOCAL QUOTE ONLY"
);

console.log(
  `Risk   : ${riskLevel}`
);

console.log(
  `Score  : ${riskScore}/100`
);

console.log(
  "\nNOTE: every scenario starts from fresh launch state."
);

console.log(
  "This is NOT yet a sequential buy/sell simulation.\n"
);

for (const r of results) {

  console.log(
    `--- ${r.name} ---`
  );

  console.log(
    `Requested : ${r.requestedQuote} quote`
  );

  console.log(
    `Mode      : ${r.mode}`
  );

  if (r.error) {
    console.log(
      `ERROR     : ${r.error}`
    );

    continue;
  }


  console.log(
    `Consumed  : ${r.consumedQuote}`
  );

  console.log(
    `Unfilled  : ${r.unfilledQuote}`
  );

  console.log(
    `SDK left  : ${r.sdkAmountLeftNet}`
  );

  console.log(
    `Output    : ${r.outputBaseTokens} base tokens`
  );

  console.log(
    `Tokens/Q  : ${r.tokensPerQuote.toFixed(4)}`
  );

  if (
    typeof r.averagePriceImpactPct ===
    "number"
  ) {
    console.log(
      `Impact    : ${r.averagePriceImpactPct.toFixed(2)}%`
    );
  }

  console.log(
    `Next sqrt : ${r.nextSqrtPrice}`
  );
}

console.log(
  "\n------------- FLAGS ----------------"
);

if (!flags.length) {
  console.log(
    "No stress flags detected."
  );
} else {
  for (const f of flags) {
    console.log(
      `[${f.level}] ${f.scenario} / ${f.code}`
    );

    console.log(
      `  ${f.message}`
    );
  }
}

console.log(
  "\nReport: reports/latest-stress-report.json"
);

console.log(
  "No transaction was created, signed, or submitted."
);