import fs from "node:fs";
import path from "node:path";

const aPath =
  path.resolve(
    "reports/sequential-v03a-basefee.json"
  );

const bPath =
  path.resolve(
    "reports/sequential-v03b-dynamic.json"
  );

if (!fs.existsSync(aPath)) {
  console.error(
    `Missing report: ${aPath}`
  );
  process.exit(2);
}

if (!fs.existsSync(bPath)) {
  console.error(
    `Missing report: ${bPath}`
  );
  process.exit(2);
}

const A =
  JSON.parse(
    fs.readFileSync(aPath, "utf8")
  );

const B =
  JSON.parse(
    fs.readFileSync(bPath, "utf8")
  );

function num(v) {
  return typeof v === "number" &&
    Number.isFinite(v);
}

function fixed(v, digits = 4) {
  return num(v)
    ? v.toFixed(digits)
    : "-";
}

const aMap =
  new Map(
    A.events.map(
      x => [x.name, x]
    )
  );

const bMap =
  new Map(
    B.events.map(
      x => [x.name, x]
    )
  );

const eventNames =
  Array.from(
    new Set([
      ...A.events.map(x => x.name),
      ...B.events.map(x => x.name)
    ])
  );

const comparisons =
  eventNames.map(name => {
    const a = aMap.get(name);
    const b = bMap.get(name);

    return {
      name,

      priceFactorBase:
        a?.priceFactorVsLaunch ?? null,

      priceFactorDynamic:
        b?.priceFactorVsLaunch ?? null,

      priceDelta:
        num(a?.priceFactorVsLaunch) &&
        num(b?.priceFactorVsLaunch)
          ? b.priceFactorVsLaunch -
            a.priceFactorVsLaunch
          : null,

      migrationBase:
        a?.migrationProgressPct ?? null,

      migrationDynamic:
        b?.migrationProgressPct ?? null,

      migrationDelta:
        num(a?.migrationProgressPct) &&
        num(b?.migrationProgressPct)
          ? b.migrationProgressPct -
            a.migrationProgressPct
          : null,

      feeDynamicBps:
        b?.effectiveFeeBps ?? null,

      volatility:
        b?.volatilityAccumulator ?? null,

      volatilityReference:
        b?.volatilityReference ?? null,

      drawdownBase:
        a?.drawdownFromPeakPct ?? null,

      drawdownDynamic:
        b?.drawdownFromPeakPct ?? null
    };
  });

const dynamicRows =
  B.events.filter(
    x =>
      !x.error &&
      num(x.effectiveFeeBps)
  );

const observedBaseFee =
  dynamicRows.length
    ? dynamicRows[0].effectiveFeeBps
    : null;

const maxFee =
  dynamicRows.length
    ? Math.max(
        ...dynamicRows.map(
          x => x.effectiveFeeBps
        )
      )
    : null;

const maxVol =
  dynamicRows.length
    ? dynamicRows.reduce(
        (max, x) =>
          BigInt(
            x.volatilityAccumulator || "0"
          ) > BigInt(max)
            ? x.volatilityAccumulator
            : max,
        "0"
      )
    : "0";

const firstMaxVolEvent =
  dynamicRows.find(
    x =>
      String(
        x.volatilityAccumulator
      ) === String(maxVol)
  )?.name ?? null;

const dumpA =
  aMap.get(
    "DUMP_25_PERCENT"
  );

const dumpB =
  bMap.get(
    "DUMP_25_PERCENT"
  );

const summary = {
  curveGuardVersion: "0.4.0",

  generatedAt:
    new Date().toISOString(),

  baselineEngine: {
    riskLevel: A.riskLevel,
    riskScore: A.riskScore,
    maxPriceFactor:
      A.maxPriceFactorVsLaunch,
    maxMigrationPct:
      A.maxMigrationProgressPct
  },

  dynamicEngine: {
    riskLevel: B.riskLevel,
    riskScore: B.riskScore,
    maxPriceFactor:
      B.maxPriceFactorVsLaunch,
    maxMigrationPct:
      B.maxMigrationProgressPct,

    observedInitialFeeBps:
      observedBaseFee,

    maxObservedFeeBps:
      maxFee,

    maxVolatilityAccumulator:
      maxVol,

    firstMaxVolatilityEvent:
      firstMaxVolEvent
  },

  dumpComparison: {
    baseFeeDrawdownPct:
      dumpA?.drawdownFromPeakPct ?? null,

    dynamicFeeDrawdownPct:
      dumpB?.drawdownFromPeakPct ?? null
  },

  events:
    comparisons
};

fs.writeFileSync(
  "reports/curveguard-ab-comparison.json",
  JSON.stringify(
    summary,
    null,
    2
  ),
  "utf8"
);

const tableRows =
  comparisons.map(x => `
    <tr>
      <td>${x.name}</td>

      <td class="num">
        ${fixed(x.priceFactorBase)}x
      </td>

      <td class="num">
        ${fixed(x.priceFactorDynamic)}x
      </td>

      <td class="num">
        ${fixed(x.migrationBase, 2)}%
      </td>

      <td class="num">
        ${fixed(x.migrationDynamic, 2)}%
      </td>

      <td class="num">
        ${fixed(x.feeDynamicBps, 4)}
      </td>

      <td class="num">
        ${x.volatility ?? "-"}
      </td>
    </tr>
  `).join("");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>CurveGuard A/B Stress Report</title>

<style>
body {
  font-family:
    Inter,
    system-ui,
    -apple-system,
    Segoe UI,
    sans-serif;

  margin: 0;
  background: #0b1020;
  color: #e8ecf5;
}

main {
  max-width: 1180px;
  margin: 0 auto;
  padding: 42px 24px 80px;
}

h1 {
  font-size: 36px;
  margin-bottom: 8px;
}

.subtitle {
  color: #9aa6bd;
  margin-bottom: 34px;
}

.grid {
  display: grid;
  grid-template-columns:
    repeat(auto-fit, minmax(190px, 1fr));
  gap: 14px;
  margin-bottom: 32px;
}

.card {
  background: #141b2d;
  border: 1px solid #26314d;
  border-radius: 14px;
  padding: 18px;
}

.label {
  color: #8fa0bb;
  font-size: 13px;
  margin-bottom: 8px;
}

.value {
  font-size: 24px;
  font-weight: 700;
}

table {
  width: 100%;
  border-collapse: collapse;
  background: #141b2d;
  border-radius: 14px;
  overflow: hidden;
}

th,
td {
  padding: 12px 10px;
  border-bottom: 1px solid #26314d;
  text-align: left;
}

th {
  color: #9fb0ca;
  font-size: 12px;
  text-transform: uppercase;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.note {
  margin-top: 28px;
  padding: 18px;
  border-radius: 14px;
  background: #141b2d;
  border: 1px solid #26314d;
  line-height: 1.55;
}

small {
  color: #8696b0;
}
</style>
</head>

<body>

<main>

<h1>CurveGuard</h1>

<div class="subtitle">
  DBC Sequential Stress Test — Base Fee vs Dynamic Fee
</div>

<div class="grid">

  <div class="card">
    <div class="label">
      Baseline Risk
    </div>
    <div class="value">
      ${A.riskLevel} ${A.riskScore}/100
    </div>
  </div>

  <div class="card">
    <div class="label">
      Dynamic Risk
    </div>
    <div class="value">
      ${B.riskLevel} ${B.riskScore}/100
    </div>
  </div>

  <div class="card">
    <div class="label">
      Observed Fee Range
    </div>
    <div class="value">
      ${fixed(observedBaseFee, 2)}
      →
      ${fixed(maxFee, 2)}
      bps
    </div>
  </div>

  <div class="card">
    <div class="label">
      Max Volatility Accumulator
    </div>
    <div class="value">
      ${maxVol}
    </div>
  </div>

  <div class="card">
    <div class="label">
      First Volatility Maximum
    </div>
    <div class="value">
      ${firstMaxVolEvent ?? "-"}
    </div>
  </div>

  <div class="card">
    <div class="label">
      Dump Drawdown
    </div>
    <div class="value">
      ${fixed(
        dumpB?.drawdownFromPeakPct,
        2
      )}%
    </div>
  </div>

</div>

<table>

<thead>
<tr>
  <th>Event</th>
  <th class="num">Base Price</th>
  <th class="num">Dynamic Price</th>
  <th class="num">Base Migration</th>
  <th class="num">Dynamic Migration</th>
  <th class="num">Dynamic Fee bps</th>
  <th class="num">Volatility</th>
</tr>
</thead>

<tbody>
${tableRows}
</tbody>

</table>

<div class="note">

<strong>What this report demonstrates</strong>

<p>
The two engines replay the same sequential market scenario.
The baseline run disables the dynamic variable-fee component.
The dynamic run carries Meteora-style volatility state from one
trade to the next and feeds that state into the SDK quote engine.
</p>

<p>
This is a local pre-launch simulation.
No wallet is required and no transaction is created,
signed, or submitted.
</p>

<small>
CurveGuard stress scores are CurveGuard diagnostics,
not an official Meteora protocol rating.
</small>

</div>

</main>

</body>
</html>`;

fs.writeFileSync(
  "reports/curveguard-ab-comparison.html",
  html,
  "utf8"
);

console.log(
  "\n======================================"
);

console.log(
  " CURVEGUARD v0.4 A/B COMPARISON"
);

console.log(
  "======================================"
);

console.log(
  `Baseline risk : ${A.riskLevel} ${A.riskScore}/100`
);

console.log(
  `Dynamic risk  : ${B.riskLevel} ${B.riskScore}/100`
);

console.log(
  `Fee observed  : ${fixed(observedBaseFee, 4)} -> ${fixed(maxFee, 4)} bps`
);

console.log(
  `Max volatility: ${maxVol}`
);

console.log(
  `First max vol : ${firstMaxVolEvent}`
);

console.log(
  `Dump baseline : ${fixed(dumpA?.drawdownFromPeakPct, 2)}%`
);

console.log(
  `Dump dynamic  : ${fixed(dumpB?.drawdownFromPeakPct, 2)}%`
);

console.log(
  "\nJSON : reports/curveguard-ab-comparison.json"
);

console.log(
  "HTML : reports/curveguard-ab-comparison.html"
);

console.log(
  "\nNo transaction was created, signed, or submitted."
);