import fs from "node:fs";
import path from "node:path";
import { parse } from "jsonc-parser";

import {
  buildCurveFromConfig,
  getCurveModeName
} from "./curve-builder.js";

const sourcePath =
  path.resolve(
    "config/dbc_config.jsonc"
  );

const raw =
  fs.readFileSync(
    sourcePath,
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
  console.error(
    "Base config JSONC parse failed."
  );

  process.exit(2);
}

const base =
  structuredClone(
    root.dbcConfig
  );

function cleanModeFields(c) {
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
    cleanModeFields(
      structuredClone(base)
    );

  c.buildCurveMode = mode;

  switch (mode) {

    case 0:
      c.percentageSupplyOnMigration = 20;
      c.migrationQuoteThreshold = 10;
      break;

    case 1:
      c.initialMarketCap = 100;
      c.migrationMarketCap = 3000;
      break;

    case 2:
      c.initialMarketCap = 100;
      c.migrationMarketCap = 3000;
      c.percentageSupplyOnMigration = 20;

      /*
       * Minimal precision buffer found by
       * CurveGuard probe for this fixture.
       */
      c.token.leftover = 0.001;

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

      /*
       * 1 token out of 1B supply =
       * 0.0000001% precision buffer.
       */
      c.token.leftover = 1;

      break;

    case 4:
      c.initialMarketCap = 100;
      c.migrationMarketCap = 3000;

      /*
       * For 1B supply:
       * initial price   = 0.0000001
       * migration price = 0.000003
       */
      c.midPrice = 0.0000006;

      c.percentageSupplyOnMigration = 20;

      c.token.leftover = 0.001;

      break;

    case 5:
      /*
       * Human-readable prices.
       * CurveGuard converts these with
       * Meteora createSqrtPrices().
       */
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

      c.token.leftover = 1;

      break;

    default:
      throw new Error(
        `Unknown test mode ${mode}`
      );
  }

  return c;
}

function serial(value) {
  if (
    value &&
    typeof value.toString === "function"
  ) {
    return value.toString();
  }

  return value;
}

const results = [];

console.log(
  "\n=========================================="
);

console.log(
  " CURVEGUARD UNIVERSAL CURVE ENGINE TEST"
);

console.log(
  "==========================================\n"
);

for (
  let mode = 0;
  mode <= 5;
  mode++
) {
  const dbc =
    makeMode(mode);

  const name =
    getCurveModeName(mode);

  try {
    const built =
      buildCurveFromConfig(dbc);

    const points =
      Array.isArray(built.curve)
        ? built.curve.filter(
            x =>
              x &&
              x.sqrtPrice &&
              x.liquidity &&
              x.sqrtPrice.toString() !== "0" &&
              x.liquidity.toString() !== "0"
          )
        : [];

    if (!points.length) {
      throw new Error(
        "Builder returned no usable curve points."
      );
    }

    if (
      !built.sqrtStartPrice ||
      built.sqrtStartPrice.isZero()
    ) {
      throw new Error(
        "Invalid sqrtStartPrice."
      );
    }

    if (
      !built.migrationQuoteThreshold ||
      built.migrationQuoteThreshold.isZero()
    ) {
      throw new Error(
        "Invalid migrationQuoteThreshold."
      );
    }

    const row = {
      mode,
      name,
      status: "PASS",

      curvePoints:
        points.length,

      sqrtStartPrice:
        serial(
          built.sqrtStartPrice
        ),

      migrationQuoteThreshold:
        serial(
          built.migrationQuoteThreshold
        ),

      dynamicFeeEnabled:
        Boolean(
          built.poolFees?.dynamicFee
        )
    };

    results.push(row);

    console.log(
      `[PASS] MODE ${mode} / ${name}`
    );

    console.log(
      `       curve points : ${row.curvePoints}`
    );

    console.log(
      `       start sqrt   : ${row.sqrtStartPrice}`
    );

    console.log(
      `       migration    : ${row.migrationQuoteThreshold}`
    );

    console.log(
      `       dynamic fee  : ${row.dynamicFeeEnabled ? "ON" : "OFF"}`
    );

    console.log("");

  } catch (err) {

    results.push({
      mode,
      name,
      status: "FAIL",
      error:
        err?.message ||
        String(err)
    });

    console.log(
      `[FAIL] MODE ${mode} / ${name}`
    );

    console.log(
      `       ${err?.message || err}`
    );

    console.log("");
  }
}

const passed =
  results.filter(
    x => x.status === "PASS"
  ).length;

const failed =
  results.length - passed;

const report = {
  curveGuardVersion: "0.5B",

  generatedAt:
    new Date().toISOString(),

  totalModes:
    results.length,

  passed,
  failed,

  universalCurveEnginePass:
    passed === 6,

  results
};

fs.mkdirSync(
  "reports",
  { recursive: true }
);

fs.writeFileSync(
  "reports/universal-curve-test.json",
  JSON.stringify(
    report,
    null,
    2
  ),
  "utf8"
);

console.log(
  "------------------------------------------"
);

console.log(
  `PASSED : ${passed}/6`
);

console.log(
  `FAILED : ${failed}/6`
);

if (passed === 6) {
  console.log(
    "\nUNIVERSAL_CURVE_ENGINE_PASS"
  );
} else {
  console.log(
    "\nUNIVERSAL_CURVE_ENGINE_INCOMPLETE"
  );
}

console.log(
  "\nReport: reports/universal-curve-test.json"
);

console.log(
  "No transaction was created, signed, or submitted."
);

if (failed > 0) {
  process.exit(10);
}