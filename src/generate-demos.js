import fs from "node:fs";
import path from "node:path";
import { parse } from "jsonc-parser";

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
    structuredClone(
      c.token
    );

  switch (mode) {

    case 0:
      c.percentageSupplyOnMigration = 20;
      c.migrationQuoteThreshold = 10;
      c.token.leftover = 0;
      break;

    case 1:
      c.initialMarketCap = 100;
      c.migrationMarketCap = 3000;
      c.token.leftover = 0;
      break;

    case 2:
      c.initialMarketCap = 100;
      c.migrationMarketCap = 3000;
      c.percentageSupplyOnMigration = 20;
      c.token.leftover = 0.000249;
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

      c.token.leftover = 0.7498;
      break;

    case 4:
      c.initialMarketCap = 100;
      c.migrationMarketCap = 3000;
      c.midPrice = 0.0000006;
      c.percentageSupplyOnMigration = 20;
      c.token.leftover = 0.000173;
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

      c.token.leftover = 0.743234;
      break;
  }

  return c;
}

const names = [
  "standard-quote-threshold",
  "market-cap",
  "two-segment",
  "liquidity-weights",
  "mid-price",
  "custom-prices"
];

fs.mkdirSync(
  path.resolve(
    "public",
    "demos"
  ),
  {
    recursive: true
  }
);

for (
  let mode = 0;
  mode <= 5;
  mode++
) {

  const demoRoot = {
    ...root,

    dryRun: true,

    dbcConfig:
      fixture(mode)
  };

  const output =
    path.resolve(
      "public",
      "demos",
      `${mode}-${names[mode]}.json`
    );

  fs.writeFileSync(
    output,
    JSON.stringify(
      demoRoot,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    `DEMO_${mode}_CREATED=${output}`
  );
}

console.log(
  "\nDEMO_PRESETS_6_CREATED"
);