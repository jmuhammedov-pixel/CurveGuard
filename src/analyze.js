import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  spawnSync
} from "node:child_process";
import {
  parse
} from "jsonc-parser";

import {
  buildCurveFromConfig,
  getCurveModeName
} from "./curve-builder.js";

import {
  advisePrecisionBuffer
} from "./precision-advisor.js";

import {
  buildRecommendations
} from "./recommendations.js";

const CURVEGUARD_VERSION =
  "1.0.0";

const CURVEGUARD_EDITION =
  "Competition Edition";

const input =
  process.argv[2] ||
  "config/dbc_config.jsonc";

const sourcePath =
  path.resolve(input);

const sourceDisplayName =
  path.basename(sourcePath);

if (
  !fs.existsSync(sourcePath)
) {
  console.error(
    `Config not found: ${sourcePath}`
  );

  process.exit(2);
}

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(
      fs.readFileSync(filePath)
    )
    .digest("hex");
}

function safeJson(filePath) {
  try {
    return JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8"
      )
    );
  } catch {
    return null;
  }
}

function copyIfExists(
  from,
  to
) {
  if (
    fs.existsSync(from)
  ) {
    fs.copyFileSync(
      from,
      to
    );

    return true;
  }

  return false;
}

function removeIfExists(
  filePath
) {
  try {
    fs.rmSync(
      filePath,
      {
        force: true
      }
    );
  } catch {
  }
}

function htmlEscape(value) {
  return String(
    value ?? ""
  )
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const sourceHashBefore =
  sha256(sourcePath);

const raw =
  fs.readFileSync(
    sourcePath,
    "utf8"
  ).replace(/^\uFEFF/, "");

const parseErrors = [];

const root =
  parse(
    raw,
    parseErrors,
    {
      allowTrailingComma: true,
      disallowComments: false
    }
  );

if (
  parseErrors.length
) {
  console.error(
    "JSONC parse failed."
  );

  console.error(
    parseErrors
  );

  process.exit(3);
}

if (
  !root ||
  !root.dbcConfig
) {
  console.error(
    "dbcConfig is missing."
  );

  process.exit(4);
}

const originalDbc =
  structuredClone(
    root.dbcConfig
  );

const mode =
  Number(
    originalDbc
      .buildCurveMode ?? 0
  );

const modeName =
  getCurveModeName(mode);

const MODE_DISPLAY_NAMES = {
  0: "Standard Quote Threshold",
  1: "Market Cap",
  2: "Two Segment",
  3: "Liquidity Weights",
  4: "Mid Price",
  5: "Custom Prices"
};

const modeDisplayName =
  MODE_DISPLAY_NAMES[mode] ||
  modeName.replaceAll("_", " ");

const runId =
  new Date()
    .toISOString()
    .replace(
      /[:.]/g,
      "-"
    );

const runDir =
  path.resolve(
    "reports",
    "runs",
    runId
  );

fs.mkdirSync(
  runDir,
  {
    recursive: true
  }
);

console.log(
  "\n=============================================="
);

console.log(
  " CURVEGUARD COMPETITION EDITION v1.0 ANALYZER"
);

console.log(
  "=============================================="
);

console.log(
  `Input      : ${sourcePath}`
);

console.log(
  `Curve mode : ${mode} / ${modeName}`
);

console.log(
  `Run ID     : ${runId}`
);

/*
 * ============================================================
 * PRECISION ADVISOR
 * ============================================================
 */

console.log(
  "\n[1/7] Precision Advisor..."
);

const precision =
  advisePrecisionBuffer(
    originalDbc
  );

console.log(
  `      status : ${precision.status}`
);

if (
  precision.status ===
  "PRECISION_BUFFER_RECOMMENDED"
) {
  console.log(
    `      current leftover     : ${precision.originalLeftover}`
  );

  console.log(
    `      recommended leftover : ${precision.recommendedLeftover}`
  );
}

if (
  [
    "INVALID_CONFIG",
    "NON_PRECISION_ERROR",
    "BUFFER_TOO_LARGE",
    "ADVISOR_INTERNAL_ERROR"
  ].includes(
    precision.status
  )
) {
  console.error(
    `Precision Advisor blocked analysis: ${precision.error || precision.status}`
  );

  process.exit(5);
}

/*
 * ============================================================
 * SAFE ANALYSIS COPY
 * ============================================================
 */

const analysisRoot =
  structuredClone(root);

analysisRoot.dbcConfig =
  structuredClone(
    originalDbc
  );

let precisionApplied =
  false;

if (
  precision.status ===
  "PRECISION_BUFFER_RECOMMENDED"
) {
  analysisRoot.dbcConfig.token =
    structuredClone(
      analysisRoot.dbcConfig.token
    );

  analysisRoot.dbcConfig
    .token
    .leftover =
      precision.recommendedLeftover;

  precisionApplied =
    true;
}

/*
 * Analysis subprocesses require dryRun=true.
 * This changes ONLY the generated analysis copy.
 */
const originalDryRun =
  root.dryRun === true;

analysisRoot.dryRun =
  true;

let rpcOverrideApplied =
  false;

const originalRpc =
  String(
    root.rpcUrl || ""
  );

if (
  originalRpc
    .toLowerCase()
    .includes("mainnet")
) {
  analysisRoot.rpcUrl =
    "https://api.devnet.solana.com";

  rpcOverrideApplied =
    true;
}

const analysisConfigPath =
  path.join(
    runDir,
    "analysis-config.json"
  );

fs.writeFileSync(
  analysisConfigPath,
  JSON.stringify(
    analysisRoot,
    null,
    2
  ),
  "utf8"
);

/*
 * Ensure universal builder accepts
 * the actual analysis copy.
 */
let builderSummary;

try {
  const built =
    buildCurveFromConfig(
      analysisRoot.dbcConfig
    );

  builderSummary = {
    status:
      "PASS",

    mode,

    modeName,

    curvePoints:
      Array.isArray(
        built.curve
      )
        ? built.curve.filter(
            x =>
              x?.liquidity &&
              x?.sqrtPrice &&
              x.liquidity
                .toString() !== "0" &&
              x.sqrtPrice
                .toString() !== "0"
          ).length
        : 0,

    sqrtStartPrice:
      built.sqrtStartPrice
        ?.toString?.()
        ?? null,

    migrationQuoteThreshold:
      built.migrationQuoteThreshold
        ?.toString?.()
        ?? null,

    dynamicFeeEnabled:
      Boolean(
        built.poolFees
          ?.dynamicFee
      )
  };

} catch (err) {
  console.error(
    "Universal Builder rejected analysis copy:"
  );

  console.error(
    err?.message ||
    err
  );

  process.exit(6);
}

/*
 * ============================================================
 * PIPELINE RUNNER
 * ============================================================
 */

const rootReports =
  path.resolve(
    "reports"
  );

const scripts = {
  inspector:
    path.resolve(
      "src/inspect-config.js"
    ),

  launch:
    path.resolve(
      "src/stress-launch.js"
    ),

  base:
    path.resolve(
      "src/sequential-stress.js"
    ),

  dynamic:
    path.resolve(
      "src/sequential-stress-dynamic.js"
    ),

  compare:
    path.resolve(
      "src/compare-sequential.js"
    )
};

function runNodeStep({
  name,
  script,
  args = [],
  expectedReport = null,
  copiedReport = null
}) {
  if (
    expectedReport
  ) {
    removeIfExists(
      expectedReport
    );
  }

  const result =
    spawnSync(
      process.execPath,
      [
        script,
        ...args
      ],
      {
        cwd:
          process.cwd(),

        encoding:
          "utf8",

        timeout:
          180000,

        windowsHide:
          true
      }
    );

  const reportExists =
    expectedReport
      ? fs.existsSync(
          expectedReport
        )
      : true;

  const ok =
    result.status === 0 &&
    reportExists;

  if (
    ok &&
    expectedReport &&
    copiedReport
  ) {
    copyIfExists(
      expectedReport,
      copiedReport
    );
  }

  return {
    name,

    status:
      ok
        ? "PASS"
        : "FAIL",

    exitCode:
      result.status,

    reportExists,

    stdout:
      result.stdout || "",

    stderr:
      result.stderr || "",

    stdoutTail:
      (result.stdout || "")
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-12),

    stderrTail:
      (result.stderr || "")
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-12)
  };
}

const steps = [];

/*
 * ============================================================
 * INSPECTOR
 *
 * Run on ORIGINAL config so warnings about
 * dryRun/mainnet remain visible.
 * ============================================================
 */

console.log(
  "\n[2/7] Config Inspector..."
);

const riskRoot =
  path.join(
    rootReports,
    "latest-risk-report.json"
  );

const riskRun =
  path.join(
    runDir,
    "risk-report.json"
  );

const inspectorStep =
  runNodeStep({
    name:
      "CONFIG_INSPECTOR",

    script:
      scripts.inspector,

    args:
      [sourcePath],

    expectedReport:
      riskRoot,

    copiedReport:
      riskRun
  });

steps.push(
  inspectorStep
);

console.log(
  `      ${inspectorStep.status}`
);

/*
 * ============================================================
 * LAUNCH STRESS
 * ============================================================
 */

console.log(
  "\n[3/7] Universal Launch Stress..."
);

const launchRoot =
  path.join(
    rootReports,
    "latest-stress-report.json"
  );

const launchRun =
  path.join(
    runDir,
    "launch-stress-report.json"
  );

const launchStep =
  runNodeStep({
    name:
      "LAUNCH_STRESS",

    script:
      scripts.launch,

    args:
      [analysisConfigPath],

    expectedReport:
      launchRoot,

    copiedReport:
      launchRun
  });

steps.push(
  launchStep
);

console.log(
  `      ${launchStep.status}`
);

/*
 * ============================================================
 * SEQUENTIAL BASE
 * ============================================================
 */

console.log(
  "\n[4/7] Sequential Base-Fee Stress..."
);

const baseRoot =
  path.join(
    rootReports,
    "sequential-v03a-basefee.json"
  );

const baseRun =
  path.join(
    runDir,
    "sequential-base.json"
  );

const baseStep =
  runNodeStep({
    name:
      "SEQUENTIAL_BASE",

    script:
      scripts.base,

    args:
      [analysisConfigPath],

    expectedReport:
      baseRoot,

    copiedReport:
      baseRun
  });

steps.push(
  baseStep
);

console.log(
  `      ${baseStep.status}`
);

/*
 * ============================================================
 * SEQUENTIAL DYNAMIC
 * ============================================================
 */

console.log(
  "\n[5/7] Sequential Dynamic-Fee Stress..."
);

const dynamicRoot =
  path.join(
    rootReports,
    "sequential-v03b-dynamic.json"
  );

const dynamicRun =
  path.join(
    runDir,
    "sequential-dynamic.json"
  );

const dynamicStep =
  runNodeStep({
    name:
      "SEQUENTIAL_DYNAMIC",

    script:
      scripts.dynamic,

    args:
      [analysisConfigPath],

    expectedReport:
      dynamicRoot,

    copiedReport:
      dynamicRun
  });

steps.push(
  dynamicStep
);

console.log(
  `      ${dynamicStep.status}`
);

/*
 * ============================================================
 * A/B COMPARISON
 * ============================================================
 */

console.log(
  "\n[6/7] A/B Comparator..."
);

const comparisonRoot =
  path.join(
    rootReports,
    "curveguard-ab-comparison.json"
  );

const comparisonHtmlRoot =
  path.join(
    rootReports,
    "curveguard-ab-comparison.html"
  );

const comparisonRun =
  path.join(
    runDir,
    "ab-comparison.json"
  );

const comparisonHtmlRun =
  path.join(
    runDir,
    "ab-comparison.html"
  );

removeIfExists(
  comparisonHtmlRoot
);

const compareStep =
  runNodeStep({
    name:
      "AB_COMPARISON",

    script:
      scripts.compare,

    expectedReport:
      comparisonRoot,

    copiedReport:
      comparisonRun
  });

if (
  compareStep.status ===
  "PASS"
) {
  copyIfExists(
    comparisonHtmlRoot,
    comparisonHtmlRun
  );
}

steps.push(
  compareStep
);

console.log(
  `      ${compareStep.status}`
);

/*
 * ============================================================
 * LOAD REPORTS
 * ============================================================
 */

const riskReport =
  safeJson(riskRun);

const launchReport =
  safeJson(launchRun);

const baseReport =
  safeJson(baseRun);

const dynamicReport =
  safeJson(dynamicRun);

const comparison =
  safeJson(comparisonRun);

const recommendations =
  buildRecommendations({
    riskReport,
    launchReport,
    baseReport,
    dynamicReport,
    comparison,
    precision
  });

const dynamicEvents =
  Array.isArray(
    dynamicReport?.events
  )
    ? dynamicReport.events
    : [];

const feeRows =
  dynamicEvents.filter(
    x =>
      typeof x
        ?.effectiveFeeBps ===
      "number"
  );

const maxDynamicFee =
  feeRows.length
    ? Math.max(
        ...feeRows.map(
          x =>
            x.effectiveFeeBps
        )
      )
    : null;

const initialDynamicFee =
  feeRows.length
    ? feeRows[0]
        .effectiveFeeBps
    : null;

const maxVolatility =
  dynamicEvents.reduce(
    (max, row) => {
      try {
        const current =
          BigInt(
            row
              ?.volatilityAccumulator
            ?? "0"
          );

        return current >
          BigInt(max)
          ? current.toString()
          : max;

      } catch {
        return max;
      }
    },
    "0"
  );

const dumpEvent =
  dynamicEvents.find(
    x =>
      x.name ===
      "DUMP_25_PERCENT"
  );

const pipelinePassed =
  steps.every(
    x =>
      x.status === "PASS"
  );

const sourceHashAfter =
  sha256(sourcePath);

const sourceConfigUnchanged =
  sourceHashBefore ===
  sourceHashAfter;

/*
 * ============================================================
 * UNIFIED REPORT
 * ============================================================
 */

const unified = {
  curveGuardVersion:
    CURVEGUARD_VERSION,

  generatedAt:
    new Date().toISOString(),

  runId,

  source: {
    path:
      sourceDisplayName,

    sha256Before:
      sourceHashBefore,

    sha256After:
      sourceHashAfter,

    unchanged:
      sourceConfigUnchanged,

    originalDryRun,

    originalRpc:
      originalRpc ||
      null
  },

  safety: {
    analysisDryRun:
      true,

    rpcOverrideApplied,

    analysisRpc:
      analysisRoot.rpcUrl ||
      null,

    originalConfigModified:
      false,

    transactionCreated:
      false,

    transactionSigned:
      false,

    transactionSubmitted:
      false
  },

  curve: {
    mode,
    modeName,
    builder:
      builderSummary
  },

  precisionAdvisor:
    precision,

  precisionAppliedToAnalysisCopy:
    precisionApplied,

  pipeline: {
    passed:
      pipelinePassed,

    steps:
      steps.map(
        x => ({
          name:
            x.name,

          status:
            x.status,

          exitCode:
            x.exitCode,

          reportExists:
            x.reportExists,

          stdoutTail:
            x.stdoutTail,

          stderrTail:
            x.stderrTail
        })
      )
  },

  inspector: {
    riskLevel:
      riskReport
        ?.riskLevel ??
      null,

    riskScore:
      riskReport
        ?.riskScore ??
      null,

    report:
      "risk-report.json"
  },

  launchStress: {
    riskLevel:
      launchReport
        ?.riskLevel ??
      null,

    riskScore:
      launchReport
        ?.riskScore ??
      null,

    report:
      "launch-stress-report.json"
  },

  sequentialBase: {
    riskLevel:
      baseReport
        ?.riskLevel ??
      null,

    riskScore:
      baseReport
        ?.riskScore ??
      null,

    report:
      "sequential-base.json"
  },

  sequentialDynamic: {
    riskLevel:
      dynamicReport
        ?.riskLevel ??
      null,

    riskScore:
      dynamicReport
        ?.riskScore ??
      null,

    initialFeeBps:
      initialDynamicFee,

    maxFeeBps:
      maxDynamicFee,

    maxVolatilityAccumulator:
      maxVolatility,

    dumpDrawdownPct:
      dumpEvent
        ?.drawdownFromPeakPct ??
      null,

    report:
      "sequential-dynamic.json"
  },

  recommendations,

  comparison: {
    report:
      "ab-comparison.json",

    html:
      fs.existsSync(
        comparisonHtmlRun
      )
        ? "ab-comparison.html"
        : null,

    data:
      comparison
  }
};

const unifiedJsonPath =
  path.join(
    runDir,
    "curveguard-report.json"
  );

fs.writeFileSync(
  unifiedJsonPath,
  JSON.stringify(
    unified,
    null,
    2
  ),
  "utf8"
);

/*
 * ============================================================
 * HTML DASHBOARD
 * ============================================================
 */

const stepRows =
  unified
    .pipeline
    .steps
    .map(
      step => `
<tr>
  <td>${htmlEscape(step.name)}</td>
  <td>
    <span class="${
      step.status === "PASS"
        ? "pass"
        : "fail"
    }">
      ${htmlEscape(step.status)}
    </span>
  </td>
  <td>${htmlEscape(step.exitCode)}</td>
</tr>`
    )
    .join("");

const precisionText =
  precision.status ===
    "PRECISION_BUFFER_RECOMMENDED"
    ? `${precision.originalLeftover} to ${precision.recommendedLeftover}`
    : precision.status === "NO_BUFFER_NEEDED"
      ? "No buffer needed"
      : precision.status;

const feeText =
  initialDynamicFee !== null &&
  maxDynamicFee !== null
    ? `${initialDynamicFee.toFixed(4)} to ${maxDynamicFee.toFixed(4)} bps`
    : "-";

const recommendationCards =
  recommendations.items
    .map(
      item => `
<div class="recommendation">

  <div class="rec-top">

    <span class="rec-priority ${htmlEscape(item.priority.toLowerCase())}">
      ${htmlEscape(item.priority)}
    </span>

    <span class="rec-title">
      ${htmlEscape(item.title)}
    </span>

  </div>

  <div class="rec-evidence">
    <strong>Why:</strong>
    ${htmlEscape(item.evidence)}
  </div>

  <div class="rec-action">
    <strong>Suggested review:</strong>
    ${htmlEscape(item.action)}
  </div>

  <div class="rec-source">
    Source: ${htmlEscape(item.source)}
    ${item.scenario ? ` / ${htmlEscape(item.scenario)}` : ""}
  </div>

</div>`
    )
    .join("");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>CurveGuard Competition Edition v1.0 Report</title>

<style>
:root {
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background:
    radial-gradient(
      circle at top right,
      #18244a,
      #080d18 45%
    );

  color: #edf3ff;

  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    "Segoe UI",
    sans-serif;
}

main {
  width: min(
    1240px,
    calc(100% - 36px)
  );

  margin: 0 auto;
  padding: 44px 0 80px;
}

.top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 30px;
  margin-bottom: 30px;
}

.brand {
  font-size: 42px;
  font-weight: 800;
  letter-spacing: -1.5px;
}

.version {
  color: #8ea1c6;
  margin-top: 5px;
}

.badge {
  border: 1px solid #314064;
  background: #111a2d;
  border-radius: 999px;
  padding: 9px 14px;
  font-size: 13px;
}

.grid {
  display: grid;
  grid-template-columns:
    repeat(
      auto-fit,
      minmax(205px,1fr)
    );
  gap: 14px;
  margin-bottom: 28px;
}

.card {
  border: 1px solid #273554;
  border-radius: 16px;
  padding: 18px;
  background:
    linear-gradient(
      145deg,
      rgba(28,40,70,.92),
      rgba(15,23,42,.92)
    );
}

.label {
  color: #8fa2c8;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: .7px;
  margin-bottom: 8px;
}

.value {
  font-size: clamp(18px, 1.6vw, 23px);
  font-weight: 750;
  line-height: 1.25;

  overflow-wrap: break-word;
  word-break: normal;
  hyphens: none;
}

.card {
  min-width: 0;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns:
      repeat(
        auto-fit,
        minmax(240px, 1fr)
      );
  }
}

.subvalue {
  margin-top: 8px;
  color: #7f91b2;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .4px;
}

.recommendations {
  display: grid;
  gap: 12px;
  padding: 18px 20px 20px;
}

.recommendation {
  border: 1px solid #283957;
  border-radius: 13px;
  padding: 15px 16px;
  background: #0d1727;
}

.rec-top {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 9px;
}

.rec-priority {
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .6px;
}

.rec-priority.setup {
  background: rgba(126, 174, 255, .10);
  color: #a8c6ff;
  border: 1px solid rgba(126, 174, 255, .25);
}

.rec-priority.action {
  background: rgba(255, 127, 127, .12);
  color: #ff9b9b;
  border: 1px solid rgba(255, 127, 127, .28);
}

.rec-priority.review {
  background: rgba(255, 201, 104, .10);
  color: #ffd080;
  border: 1px solid rgba(255, 201, 104, .25);
}

.rec-priority.info {
  background: rgba(126, 174, 255, .10);
  color: #9fc1ff;
  border: 1px solid rgba(126, 174, 255, .25);
}

.rec-title {
  font-weight: 750;
  font-size: 15px;
}

.rec-evidence,
.rec-action,
.rec-source {
  color: #aebbd2;
  font-size: 13px;
  line-height: 1.55;
}

.rec-action {
  margin-top: 7px;
}

.rec-source {
  margin-top: 8px;
  color: #778aaa;
  font-size: 11px;
}

.section {
  margin-top: 24px;
  border: 1px solid #273554;
  border-radius: 16px;
  overflow: hidden;
  background: #101827;
}

.section h2 {
  font-size: 18px;
  margin: 0;
  padding: 17px 20px;
  border-bottom: 1px solid #273554;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 12px 18px;
  border-bottom: 1px solid #222f4b;
  text-align: left;
}

th {
  color: #8fa2c8;
  font-size: 12px;
  text-transform: uppercase;
}

.pass {
  color: #7fe6ac;
  font-weight: 750;
}

.fail {
  color: #ff8e9b;
  font-weight: 750;
}

.note {
  line-height: 1.6;
  color: #b8c4da;
  padding: 18px 20px;
}

code {
  color: #b8d3ff;
}

.footer {
  color: #7f91b2;
  margin-top: 26px;
  font-size: 13px;
  line-height: 1.6;
}
</style>
</head>

<body>

<main>

<div class="top">

<div>
  <div class="brand">
    CurveGuard
  </div>

  <div class="version">
    Meteora DBC Pre-Launch Stress Lab - Competition Edition v1.0</div>
</div>

<div class="badge">
  ${
    pipelinePassed
      ? "PIPELINE PASS"
      : "PIPELINE ATTENTION"
  }
</div>

</div>

<div class="grid">

<div class="card">
  <div class="label">
    Curve Type
  </div>

  <div class="value">
    ${htmlEscape(modeDisplayName)}
  </div>

  <div class="subvalue">
    Mode ${htmlEscape(mode)}
  </div>
</div>

<div class="card">
  <div class="label">
    Config Risk
  </div>
  <div class="value">
    ${htmlEscape(
      unified.inspector.riskLevel ??
      "-"
    )}
    ${htmlEscape(
      unified.inspector.riskScore ??
      "-"
    )}/100
  </div>
</div>

<div class="card">
  <div class="label">
    Launch Stress
  </div>
  <div class="value">
    ${htmlEscape(
      unified.launchStress.riskLevel ??
      "-"
    )}
    ${htmlEscape(
      unified.launchStress.riskScore ??
      "-"
    )}/100
  </div>
</div>

<div class="card">
  <div class="label">
    Sequential Dynamic
  </div>
  <div class="value">
    ${htmlEscape(
      unified.sequentialDynamic.riskLevel ??
      "-"
    )}
    ${htmlEscape(
      unified.sequentialDynamic.riskScore ??
      "-"
    )}/100
  </div>
</div>

<div class="card">
  <div class="label">
    Dynamic Fee Range
  </div>
  <div class="value">
    ${htmlEscape(feeText)}
  </div>
</div>

<div class="card">
  <div class="label">
    Max Volatility
  </div>
  <div class="value">
    ${htmlEscape(maxVolatility)}
  </div>
</div>

<div class="card">
  <div class="label">
    Dump Drawdown
  </div>
  <div class="value">
    ${
      dumpEvent
        ?.drawdownFromPeakPct !==
      undefined
        ? htmlEscape(
            dumpEvent
              .drawdownFromPeakPct
              .toFixed(2)
          ) + "%"
        : "-"
    }
  </div>
</div>

<div class="card">
  <div class="label">
    Precision Advisor
  </div>
  <div class="value">
    ${htmlEscape(precisionText)}
  </div>
</div>

</div>

<div class="section">

<h2>
  Analysis Pipeline
</h2>

<table>

<thead>
<tr>
  <th>Stage</th>
  <th>Status</th>
  <th>Exit</th>
</tr>
</thead>

<tbody>
${stepRows}
</tbody>

</table>

</div>

<div class="section">

<h2>
  Safety & Source Integrity
</h2>

<div class="note">

<strong>
Original config unchanged:
</strong>
${sourceConfigUnchanged ? "YES" : "NO"}

<br>

<strong>
Analysis copy dry-run:
</strong>
YES

<br>

<strong>
Precision recommendation applied only to analysis copy:
</strong>
${precisionApplied ? "YES" : "NO"}

<br>

<strong>
Mainnet RPC overridden for local analysis:
</strong>
${rpcOverrideApplied ? "YES" : "NO"}

<br>

<strong>
Transaction created / signed / submitted:
</strong>
NO / NO / NO

<br><br>

<code>
SHA-256:
${htmlEscape(sourceHashBefore)}
</code>

</div>

</div>

<div class="section">

<h2>
  Builder Summary
</h2>

<div class="note">

Curve points:
<strong>
${htmlEscape(builderSummary.curvePoints)}
</strong>

<br>

Migration quote threshold:
<strong>
${htmlEscape(builderSummary.migrationQuoteThreshold)}
</strong>

<br>

Dynamic fee:
<strong>
${builderSummary.dynamicFeeEnabled ? "ENABLED" : "DISABLED"}
</strong>

</div>

</div>

<div class="section">

<h2>
  Developer Recommendations
</h2>

<div class="recommendations">
${recommendationCards}
</div>

<div class="note">
Recommendations are CurveGuard diagnostics and developer guidance,
not official Meteora protocol advice.
</div>

</div>

<div class="section">

<h2>
  Interpretation
</h2>

<div class="note">

CurveGuard evaluates a Meteora Dynamic Bonding Curve
before launch using configuration validation,
launch-state stress scenarios,
persistent sequential market simulation,
dynamic-fee volatility tracking and A/B comparison.

<br><br>

Risk scores shown here are
<strong>CurveGuard diagnostics</strong>,
not an official Meteora protocol rating
and not a prediction of token performance.

</div>

</div>

<div class="footer">

Run ID:
${htmlEscape(runId)}

<br>

Source:
${htmlEscape(sourceDisplayName)}

<br>

Full machine-readable report:
<code>curveguard-report.json</code>

</div>

</main>

</body>
</html>`;

const dashboardPath =
  path.join(
    runDir,
    "index.html"
  );

fs.writeFileSync(
  dashboardPath,
  html,
  "utf8"
);

/*
 * ============================================================
 * FINAL
 * ============================================================
 */

console.log(
  "\n[7/7] Unified Dashboard..."
);

console.log(
  "      PASS"
);

console.log(
  "\n----------------------------------------------"
);

console.log(
  `Pipeline passed : ${pipelinePassed}`
);

console.log(
  `Source unchanged: ${sourceConfigUnchanged}`
);

console.log(
  `Precision copy  : ${precisionApplied}`
);

console.log(
  `Dashboard       : ${dashboardPath}`
);

console.log(
  `JSON report     : ${unifiedJsonPath}`
);

console.log(
  "\nNo transaction was created, signed, or submitted."
);

console.log(
  `CURVEGUARD_DASHBOARD=${dashboardPath}`
);

if (
  !pipelinePassed ||
  !sourceConfigUnchanged
) {
  process.exit(10);
}