import fs from "node:fs";
import path from "node:path";
import { parse } from "jsonc-parser";

import {
  buildCurveFromConfig,
  getCurveModeName
} from "./curve-builder.js";

const input =
  process.argv[2] ||
  "config/dbc_config.jsonc";

const fullPath =
  path.resolve(input);

const raw =
  fs.readFileSync(
    fullPath,
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
    "JSONC parse failed."
  );

  process.exit(2);
}

const dbc =
  root.dbcConfig || root;

const mode =
  Number(
    dbc.buildCurveMode ?? 0
  );

try {
  const built =
    buildCurveFromConfig(dbc);

  const populatedCurvePoints =
    Array.isArray(built.curve)
      ? built.curve.filter(
          x =>
            x &&
            x.liquidity &&
            x.sqrtPrice &&
            x.liquidity.toString() !== "0" &&
            x.sqrtPrice.toString() !== "0"
        ).length
      : 0;

  console.log(
    "\n========================================"
  );

  console.log(
    " CURVEGUARD v0.5A BUILDER SMOKE TEST"
  );

  console.log(
    "========================================"
  );

  console.log(
    `Mode       : ${mode}`
  );

  console.log(
    `Mode name  : ${getCurveModeName(mode)}`
  );

  console.log(
    `Curve pts  : ${populatedCurvePoints}`
  );

  console.log(
    `Start sqrt : ${built.sqrtStartPrice?.toString?.() ?? "-"}`
  );

  console.log(
    `Migration  : ${built.migrationQuoteThreshold?.toString?.() ?? "-"}`
  );

  console.log(
    `Dynamic fee: ${built.poolFees?.dynamicFee ? "ENABLED" : "DISABLED"}`
  );

  console.log(
    "\nBUILDER_SMOKE_OK"
  );

} catch (err) {
  console.error(
    "\nBUILDER_SMOKE_FAILED"
  );

  console.error(
    err?.stack ||
    err?.message ||
    String(err)
  );

  process.exit(3);
}