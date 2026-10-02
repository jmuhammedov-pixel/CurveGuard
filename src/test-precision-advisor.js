import fs from "node:fs";
import path from "node:path";
import { parse } from "jsonc-parser";

import {
  advisePrecisionBuffer
} from "./precision-advisor.js";

import {
  buildCurveFromConfig,
  getCurveModeName
} from "./curve-builder.js";

const raw =
  fs.readFileSync(
    path.resolve(
      "config/dbc_config.jsonc"
    ),
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
    "Base config parse failed."
  );

  process.exit(2);
}

const base =
  structuredClone(
    root.dbcConfig
  );

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

function fixture(mode) {
  const c =
    clean(
      structuredClone(base)
    );

  c.buildCurveMode =
    mode;

  c.token =
    structuredClone(c.token);

  /*
   * Intentionally start at zero.
   */
  c.token.leftover = 0;

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
  }

  return c;
}

let passed = 0;

const output = [];

console.log(
  "\n=========================================="
);

console.log(
  " CURVEGUARD PRECISION ADVISOR TEST"
);

console.log(
  "==========================================\n"
);

for (
  const mode of [2, 3, 4, 5]
) {
  const dbc =
    fixture(mode);

  const recommendation =
    advisePrecisionBuffer(
      dbc
    );

  let verification =
    false;

  if (
    recommendation.status ===
    "PRECISION_BUFFER_RECOMMENDED"
  ) {
    const fixed =
      structuredClone(dbc);

    fixed.token =
      structuredClone(
        fixed.token
      );

    fixed.token.leftover =
      recommendation
        .recommendedLeftover;

    try {
      buildCurveFromConfig(
        fixed
      );

      verification =
        true;

    } catch {
      verification =
        false;
    }
  }

  const ok =
    recommendation.status ===
      "PRECISION_BUFFER_RECOMMENDED" &&
    verification === true &&
    recommendation.configWasModified ===
      false;

  if (ok) {
    passed++;
  }

  output.push({
    mode,
    modeName:
      getCurveModeName(mode),

    pass:
      ok,

    recommendation
  });

  console.log(
    `[${ok ? "PASS" : "FAIL"}] MODE ${mode} / ${getCurveModeName(mode)}`
  );

  console.log(
    `       status       : ${recommendation.status}`
  );

  console.log(
    `       original     : ${recommendation.originalLeftover}`
  );

  console.log(
    `       recommended  : ${recommendation.recommendedLeftover}`
  );

  console.log(
    `       base units   : ${recommendation.recommendedBaseUnits ?? "-"}`
  );

  console.log(
    `       supply share : ${
      recommendation.percentageOfSupply !== undefined
        ? recommendation.percentageOfSupply.toFixed(12)
        : "-"
    }%`
  );

  console.log(
    `       verified     : ${verification}`
  );

  console.log("");
}

fs.writeFileSync(
  "reports/precision-advisor-test.json",
  JSON.stringify(
    {
      curveGuardVersion:
        "0.6.0",

      passed,
      total:
        output.length,

      precisionAdvisorPass:
        passed === output.length,

      results:
        output
    },
    null,
    2
  ),
  "utf8"
);

console.log(
  "------------------------------------------"
);

console.log(
  `PASSED : ${passed}/${output.length}`
);

console.log(
  `FAILED : ${output.length - passed}/${output.length}`
);

if (
  passed === output.length
) {
  console.log(
    "\nPRECISION_ADVISOR_PASS"
  );
} else {
  console.log(
    "\nPRECISION_ADVISOR_INCOMPLETE"
  );
}

console.log(
  "\nNo source config was modified."
);

console.log(
  "No transaction was created, signed, or submitted."
);

if (
  passed !== output.length
) {
  process.exit(10);
}