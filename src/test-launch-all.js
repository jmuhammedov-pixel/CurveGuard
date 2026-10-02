import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  spawnSync
} from "node:child_process";

import {
  parse
} from "jsonc-parser";

import {
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

if (
  errors.length
) {
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
      c.percentageSupplyOnMigration =
        20;

      c.migrationQuoteThreshold =
        10;

      c.token.leftover =
        0;

      break;

    case 1:
      c.initialMarketCap =
        100;

      c.migrationMarketCap =
        3000;

      c.token.leftover =
        0;

      break;

    case 2:
      c.initialMarketCap =
        100;

      c.migrationMarketCap =
        3000;

      c.percentageSupplyOnMigration =
        20;

      c.token.leftover =
        0.000249;

      break;

    case 3:
      c.initialMarketCap =
        100;

      c.migrationMarketCap =
        3000;

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

      c.token.leftover =
        0.7498;

      break;

    case 4:
      c.initialMarketCap =
        100;

      c.migrationMarketCap =
        3000;

      c.midPrice =
        0.0000006;

      c.percentageSupplyOnMigration =
        20;

      c.token.leftover =
        0.000173;

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

      c.token.leftover =
        0.743234;

      break;

    default:
      throw new Error(
        `Unknown mode ${mode}`
      );
  }

  return c;
}

const tempDir =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "curveguard-launch-"
    )
  );

const stressScript =
  path.resolve(
    "src/stress-launch.js"
  );

const reportPath =
  path.resolve(
    "reports/latest-stress-report.json"
  );

const results = [];

console.log(
  "\n============================================"
);

console.log(
  " CURVEGUARD UNIVERSAL LAUNCH STRESS TEST"
);

console.log(
  "============================================\n"
);

for (
  let mode = 0;
  mode <= 5;
  mode++
) {
  const modeName =
    getCurveModeName(mode);

  const dbc =
    fixture(mode);

  const configPath =
    path.join(
      tempDir,
      `launch-mode-${mode}.json`
    );

  const tempRoot = {
    ...root,
    dryRun: true,
    dbcConfig: dbc
  };

  fs.writeFileSync(
    configPath,
    JSON.stringify(
      tempRoot,
      null,
      2
    ),
    "utf8"
  );

  /*
   * Remove the prior report so a stale
   * file can never make a test pass.
   */
  try {
    fs.rmSync(
      reportPath,
      {
        force: true
      }
    );
  } catch {
  }

  const run =
    spawnSync(
      process.execPath,
      [
        stressScript,
        configPath
      ],
      {
        cwd:
          process.cwd(),

        encoding:
          "utf8",

        timeout:
          120000,

        windowsHide:
          true
      }
    );

  const stdout =
    run.stdout || "";

  const stderr =
    run.stderr || "";

  const combined =
    `${stdout}\n${stderr}`;

  const builderSeen =
    combined.includes(
      `Curve builder: mode ${mode} / ${modeName}`
    );

  let reportOk =
    false;

  let reportRisk =
    null;

  let reportScore =
    null;

  try {
    if (
      fs.existsSync(
        reportPath
      )
    ) {
      const report =
        JSON.parse(
          fs.readFileSync(
            reportPath,
            "utf8"
          )
        );

      reportRisk =
        report.riskLevel ??
        null;

      reportScore =
        report.riskScore ??
        null;

      reportOk =
        Number(
          report
            ?.sdkConfig
            ?.buildCurveMode
        ) === mode &&
        typeof reportRisk ===
          "string" &&
        Number.isFinite(
          Number(reportScore)
        );
    }
  } catch {
    reportOk =
      false;
  }

  const noModeZeroBlock =
    !combined.includes(
      "supports buildCurveMode=0 only"
    );

  const ok =
    run.status === 0 &&
    builderSeen &&
    reportOk &&
    noModeZeroBlock;

  results.push({
    mode,
    modeName,

    status:
      ok
        ? "PASS"
        : "FAIL",

    exitCode:
      run.status,

    builderSeen,
    reportOk,
    noModeZeroBlock,

    riskLevel:
      reportRisk,

    riskScore:
      reportScore,

    stdoutTail:
      stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-15),

    stderrTail:
      stderr
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-15)
  });

  console.log(
    `[${ok ? "PASS" : "FAIL"}] MODE ${mode} / ${modeName}`
  );

  if (
    reportRisk !== null
  ) {
    console.log(
      `       risk : ${reportRisk} ${reportScore}/100`
    );
  }

  if (!ok) {
    console.log(
      `       exit       : ${run.status}`
    );

    console.log(
      `       builder    : ${builderSeen}`
    );

    console.log(
      `       report     : ${reportOk}`
    );

    console.log(
      `       mode guard : ${noModeZeroBlock}`
    );

    const tail =
      combined
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-10);

    for (
      const line of tail
    ) {
      console.log(
        `       ${line}`
      );
    }
  }

  console.log("");
}

const passed =
  results.filter(
    x =>
      x.status === "PASS"
  ).length;

const total =
  results.length;

fs.mkdirSync(
  "reports",
  {
    recursive: true
  }
);

fs.writeFileSync(
  "reports/universal-launch-stress-test.json",
  JSON.stringify(
    {
      curveGuardVersion:
        "0.8.0",

      generatedAt:
        new Date().toISOString(),

      totalTests:
        total,

      passed,

      failed:
        total - passed,

      universalLaunchStressPass:
        passed === total,

      results
    },
    null,
    2
  ),
  "utf8"
);

console.log(
  "--------------------------------------------"
);

console.log(
  `PASSED : ${passed}/${total}`
);

console.log(
  `FAILED : ${total - passed}/${total}`
);

if (
  passed === total
) {
  console.log(
    "\nUNIVERSAL_LAUNCH_STRESS_PASS"
  );
}
else {
  console.log(
    "\nUNIVERSAL_LAUNCH_STRESS_INCOMPLETE"
  );
}

console.log(
  "\nReport: reports/universal-launch-stress-test.json"
);

console.log(
  "No transaction was created, signed, or submitted by this test."
);

try {
  fs.rmSync(
    tempDir,
    {
      recursive: true,
      force: true
    }
  );
}
catch {
}

if (
  passed !== total
) {
  process.exit(10);
}