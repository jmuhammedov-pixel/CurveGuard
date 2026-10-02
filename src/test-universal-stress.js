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

      c.token.leftover =
        0.000249;

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

      c.token.leftover =
        0.7498;

      break;

    case 4:
      c.initialMarketCap = 100;
      c.migrationMarketCap = 3000;
      c.midPrice = 0.0000006;
      c.percentageSupplyOnMigration = 20;

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

function makeRoot(dbc) {
  return {
    ...root,
    dryRun: true,
    dbcConfig: dbc
  };
}

const tempDir =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "curveguard-v07-"
    )
  );

const engines = [
  {
    name:
      "BASE_FEE",

    script:
      path.resolve(
        "src/sequential-stress.js"
      )
  },

  {
    name:
      "DYNAMIC_FEE",

    script:
      path.resolve(
        "src/sequential-stress-dynamic.js"
      )
  }
];

const results = [];

console.log(
  "\n=============================================="
);

console.log(
  " CURVEGUARD UNIVERSAL STRESS ENGINE TEST"
);

console.log(
  "==============================================\n"
);

for (
  let mode = 0;
  mode <= 5;
  mode++
) {
  const dbc =
    fixture(mode);

  const modeName =
    getCurveModeName(mode);

  const configPath =
    path.join(
      tempDir,
      `mode-${mode}.json`
    );

  fs.writeFileSync(
    configPath,
    JSON.stringify(
      makeRoot(dbc),
      null,
      2
    ),
    "utf8"
  );

  for (
    const engine of engines
  ) {
    const run =
      spawnSync(
        process.execPath,
        [
          engine.script,
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

    const safetySeen =
      combined.includes(
        "No transaction was created"
      );

    const stressReportSeen =
      engine.name ===
        "DYNAMIC_FEE"
        ? combined.includes(
            "DYNAMIC STRESS REPORT"
          )
        : combined.includes(
            "SEQUENTIAL STRESS REPORT"
          );

    const ok =
      run.status === 0 &&
      builderSeen &&
      safetySeen &&
      stressReportSeen;

    results.push({
      mode,
      modeName,

      engine:
        engine.name,

      status:
        ok ? "PASS" : "FAIL",

      exitCode:
        run.status,

      builderSeen,
      safetySeen,
      stressReportSeen,

      stdoutTail:
        stdout
          .split(/\r?\n/)
          .slice(-20)
          .join("\n"),

      stderrTail:
        stderr
          .split(/\r?\n/)
          .slice(-20)
          .join("\n")
    });

    console.log(
      `[${ok ? "PASS" : "FAIL"}] MODE ${mode} / ${modeName} / ${engine.name}`
    );

    if (!ok) {
      console.log(
        `       exit       : ${run.status}`
      );

      console.log(
        `       builder    : ${builderSeen}`
      );

      console.log(
        `       report     : ${stressReportSeen}`
      );

      console.log(
        `       safety     : ${safetySeen}`
      );

      const tail =
        combined
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(-8);

      for (
        const line of tail
      ) {
        console.log(
          `       ${line}`
        );
      }
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

const report = {
  curveGuardVersion:
    "0.7.0",

  generatedAt:
    new Date().toISOString(),

  modes:
    6,

  engines:
    2,

  totalTests:
    total,

  passed,

  failed:
    total - passed,

  universalStressEnginePass:
    passed === total,

  results
};

fs.mkdirSync(
  "reports",
  { recursive: true }
);

fs.writeFileSync(
  "reports/universal-stress-test.json",
  JSON.stringify(
    report,
    null,
    2
  ),
  "utf8"
);

console.log(
  "----------------------------------------------"
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
    "\nUNIVERSAL_STRESS_ENGINE_PASS"
  );
} else {
  console.log(
    "\nUNIVERSAL_STRESS_ENGINE_INCOMPLETE"
  );
}

console.log(
  "\nReport: reports/universal-stress-test.json"
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
} catch {
  // Temporary files are harmless if cleanup fails.
}

if (
  passed !== total
) {
  process.exit(10);
}