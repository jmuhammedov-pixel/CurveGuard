import fs from "node:fs";
import path from "node:path";
import { parse } from "jsonc-parser";

import {
  buildCurveFromConfig,
  getCurveModeName
} from "./curve-builder.js";

const raw =
  fs.readFileSync(
    path.resolve("config/dbc_config.jsonc"),
    "utf8"
  ).replace(/^\uFEFF/, "");

const errors = [];

const root =
  parse(
    raw,
    errors,
    {
      allowTrailingComma: true,
      disallowComments: false
    }
  );

if (errors.length) {
  console.error("Base config JSONC parse failed.");
  process.exit(2);
}

const base =
  structuredClone(root.dbcConfig);

function clean(c) {
  delete c.percentageSupplyOnMigration;
  delete c.migrationQuoteThreshold;
  delete c.initialMarketCap;
  delete c.migrationMarketCap;
  delete c.midPrice;
  delete c.liquidityWeights;
  delete c.prices;
  delete c.sqrtPrices;

  return c;
}

function makeMode(mode) {
  const c =
    clean(
      structuredClone(base)
    );

  c.buildCurveMode = mode;

  switch (mode) {

    case 2:
      c.initialMarketCap = 100;
      c.migrationMarketCap = 3000;
      c.percentageSupplyOnMigration = 20;
      break;

    case 3:
      c.initialMarketCap = 100;
      c.migrationMarketCap = 3000;

      c.liquidityWeights = [
        1.00,
        1.05,
        1.10,
        1.15,
        1.20,
        1.25,
        1.30,
        1.35,
        1.40,
        1.45,
        1.50,
        1.55,
        1.60,
        1.65,
        1.70,
        1.75
      ];
      break;

    case 4:
      c.initialMarketCap = 100;
      c.migrationMarketCap = 3000;
      c.midPrice = 0.0000006;
      c.percentageSupplyOnMigration = 20;
      break;

    case 5:
      c.prices = [
        0.0000001,
        0.0000004,
        0.000001,
        0.000003
      ];

      c.liquidityWeights = [
        1,
        1.25,
        1.5
      ];
      break;

    default:
      throw new Error(
        `Unsupported probe mode ${mode}`
      );
  }

  return c;
}

const candidates = [
  0,
  0.000001,
  0.00001,
  0.0001,
  0.001,
  0.01,
  0.1,
  1,
  10,
  100,
  1000,
  10000,
  100000,
  1000000,
  10000000,
  100000000,
  200000000,
  350000000,
  500000000
];

const results = [];

console.log(
  "\n=========================================="
);

console.log(
  " CURVEGUARD LEFTOVER PRECISION PROBE"
);

console.log(
  "==========================================\n"
);

for (
  const mode of [2, 3, 4, 5]
) {
  const name =
    getCurveModeName(mode);

  let firstPass = null;
  let lastError = null;

  for (
    const leftover of candidates
  ) {
    const dbc =
      makeMode(mode);

    dbc.token =
      structuredClone(dbc.token);

    dbc.token.leftover =
      leftover;

    try {
      const built =
        buildCurveFromConfig(dbc);

      firstPass = {
        leftover,
        migrationQuoteThreshold:
          built.migrationQuoteThreshold.toString(),
        curvePoints:
          built.curve.filter(
            x =>
              x?.liquidity &&
              x.liquidity.toString() !== "0"
          ).length
      };

      break;

    } catch (err) {
      lastError =
        err?.message ||
        String(err);
    }
  }

  if (firstPass) {
    const supply =
      Number(
        base.token.totalTokenSupply
      );

    const percent =
      supply > 0
        ? (
            firstPass.leftover /
            supply
          ) * 100
        : null;

    console.log(
      `[PASS] MODE ${mode} / ${name}`
    );

    console.log(
      `       first passing leftover : ${firstPass.leftover}`
    );

    console.log(
      `       share of total supply  : ${percent.toFixed(9)}%`
    );

    console.log(
      `       curve points           : ${firstPass.curvePoints}`
    );

    console.log(
      `       migration threshold    : ${firstPass.migrationQuoteThreshold}`
    );

    results.push({
      mode,
      name,
      status: "PASS",
      ...firstPass,
      leftoverPercentOfSupply:
        percent
    });

  } else {
    console.log(
      `[FAIL] MODE ${mode} / ${name}`
    );

    console.log(
      `       no candidate succeeded`
    );

    console.log(
      `       last error: ${lastError}`
    );

    results.push({
      mode,
      name,
      status: "FAIL",
      lastError
    });
  }

  console.log("");
}

fs.mkdirSync(
  "reports",
  { recursive: true }
);

fs.writeFileSync(
  "reports/leftover-precision-probe.json",
  JSON.stringify(
    {
      curveGuardVersion:
        "0.5B-probe",

      generatedAt:
        new Date().toISOString(),

      results
    },
    null,
    2
  ),
  "utf8"
);

console.log(
  "Report: reports/leftover-precision-probe.json"
);

console.log(
  "No transaction was created, signed, or submitted."
);