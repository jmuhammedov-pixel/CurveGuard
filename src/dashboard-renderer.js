
function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function fmt(value, digits = 2, fallback = "-") {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

function niceLabel(name) {
  return String(name ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, m => m.toUpperCase());
}

function svgLineChart({
  series = [],
  width = 760,
  height = 300,
  xLabels = [],
  leftLabel = "",
  rightLabel = "",
  leftFormat = v => String(v),
  rightFormat = v => String(v)
}) {
  const pad = { l: 62, r: 58, t: 26, b: 44 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;

  const valid = series.filter(s => Array.isArray(s.values) && s.values.length);
  const maxLen = Math.max(2, ...valid.map(s => s.values.length));

  const axisStats = axis => {
    const vals = valid
      .filter(s => (s.axis || "left") === axis)
      .flatMap(s => s.values)
      .map(Number)
      .filter(Number.isFinite);

    if (!vals.length) return { min: 0, max: 1 };
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) {
      const bump = Math.abs(max || 1) * 0.15;
      min -= bump;
      max += bump;
    } else {
      const margin = (max - min) * 0.12;
      min -= margin;
      max += margin;
    }
    return { min, max };
  };

  const left = axisStats("left");
  const right = axisStats("right");

  const xAt = i => pad.l + (i / (maxLen - 1)) * plotW;
  const yAt = (v, stats) =>
    pad.t + plotH - ((finite(v) - stats.min) / (stats.max - stats.min)) * plotH;

  const grid = [];
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.t + (i / 4) * plotH;
    const leftV = left.max - (i / 4) * (left.max - left.min);
    const rightV = right.max - (i / 4) * (right.max - right.min);
    grid.push(`
      <line x1="${pad.l}" y1="${y}" x2="${width-pad.r}" y2="${y}" class="svg-grid"/>
      <text x="${pad.l-10}" y="${y+4}" text-anchor="end" class="svg-axis">${esc(leftFormat(leftV))}</text>
      <text x="${width-pad.r+10}" y="${y+4}" text-anchor="start" class="svg-axis">${esc(rightFormat(rightV))}</text>
    `);
  }

  const paths = valid.map((s, idx) => {
    const stats = (s.axis || "left") === "right" ? right : left;
    const pts = s.values
      .map((v, i) => `${xAt(i).toFixed(1)},${yAt(v, stats).toFixed(1)}`)
      .join(" ");
    const id = `g${idx}`;
    return `
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${esc(s.color)}" stop-opacity=".40"/>
          <stop offset="100%" stop-color="${esc(s.color)}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polyline points="${pts}" fill="none" stroke="${esc(s.color)}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" class="glow-line"/>
      <polygon points="${pad.l},${pad.t+plotH} ${pts} ${width-pad.r},${pad.t+plotH}" fill="url(#${id})" opacity="${idx === 0 ? ".44" : ".16"}"/>
    `;
  });

  const labelStep = Math.max(1, Math.ceil(maxLen / 5));
  const xTexts = Array.from({ length: maxLen }, (_, i) => {
    if (i % labelStep !== 0 && i !== maxLen - 1) return "";
    const text = xLabels[i] ?? String(i + 1);
    return `<text x="${xAt(i)}" y="${height-13}" text-anchor="middle" class="svg-axis">${esc(text)}</text>`;
  }).join("");

  const legend = valid.map((s, i) => `
    <span class="legend-item"><span class="legend-dot" style="background:${esc(s.color)}"></span>${esc(s.name)}</span>
  `).join("");

  return `
    <div class="chart-legend">${legend}</div>
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img">
      ${grid.join("")}
      <text x="18" y="${height/2}" transform="rotate(-90 18 ${height/2})" class="svg-axis svg-label">${esc(leftLabel)}</text>
      <text x="${width-12}" y="${height/2}" transform="rotate(90 ${width-12} ${height/2})" class="svg-axis svg-label">${esc(rightLabel)}</text>
      ${paths.join("")}
      ${xTexts}
    </svg>
  `;
}

function svgFeeChart(events) {
  const rows = events.filter(x => Number.isFinite(Number(x?.effectiveFeeBps)));
  const values = rows.map(x => Number(x.effectiveFeeBps));
  const labels = rows.map(x => niceLabel(x.name));
  return svgLineChart({
    series: [{ name: "Effective fee", values, color: "#6ae7ff", axis: "left" }],
    xLabels: labels,
    leftLabel: "Fee (bps)",
    rightLabel: "",
    leftFormat: v => fmt(v, 1),
    rightFormat: () => ""
  });
}

function heatColor(v) {
  const x = clamp(v);
  const hue = 150 - (150 * x);
  return `hsl(${hue} 84% 52%)`;
}

function launchHeatmap(launchReport) {
  const scenarios = Array.isArray(launchReport?.scenarios) ? launchReport.scenarios : [];
  if (!scenarios.length) return `<div class="empty-chart">No launch-stress matrix data.</div>`;

  const metricRows = [
    {
      label: "Price impact",
      values: scenarios.map(x => Math.abs(finite(x?.averagePriceImpactPct))),
    },
    {
      label: "Unfilled",
      values: scenarios.map(x => Math.abs(finite(x?.unfilledQuote))),
    },
    {
      label: "Capacity",
      values: scenarios.map(x => Math.abs(finite(x?.sdkAmountLeftNet))),
    }
  ];

  const maxByRow = metricRows.map(r => Math.max(0.000001, ...r.values));
  const cols = scenarios.length;
  const cellW = 70;
  const cellH = 62;
  const left = 104;
  const top = 30;
  const legendW = 74;
  const width = left + cols * cellW + legendW;
  const height = top + metricRows.length * cellH + 92;

  const cells = metricRows.flatMap((row, rIdx) =>
    row.values.map((value, cIdx) => {
      const intensity = clamp(value / maxByRow[rIdx]);
      return `<rect x="${left + cIdx*cellW}" y="${top + rIdx*cellH}" width="${cellW-4}" height="${cellH-4}" rx="6" fill="${heatColor(intensity)}" fill-opacity="${0.28 + intensity*0.72}" stroke="rgba(255,255,255,.08)"/>`;
    })
  ).join("");

  const rowLabels = metricRows.map((row, rIdx) =>
    `<text x="${left-10}" y="${top + rIdx*cellH + 26}" text-anchor="end" class="svg-axis">${esc(row.label)}</text>`
  ).join("");

  const colLabels = scenarios.map((s, i) => {
    const short = String(s.name || "")
      .replace("MIGRATION_PRESSURE", "MIGRATION")
      .replace("OVERSIZED_WHALE", "OVERSIZED")
      .replace("STRONG_RETAIL", "STRONG")
      .replace("RETAIL_BUY", "RETAIL")
      .replace("MICRO_BUY", "MICRO")
      .replace("LARGE_BUY", "LARGE")
      .replace("WHALE_BUY", "WHALE");
    const x = left + i*cellW + cellW/2;
    return `<text x="${x}" y="${top + metricRows.length*cellH + 18}" text-anchor="middle" class="svg-axis heat-x">${esc(short)}</text>`;
  }).join("");

  const legendX = left + cols * cellW + 22;
  const legendY = top;
  const legendH = metricRows.length * cellH - 4;

  return `
    <svg class="chart-svg heatmap-svg" viewBox="0 0 ${width} ${height}" role="img">
      <defs>
        <linearGradient id="riskLegend" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stop-color="${heatColor(0)}"/>
          <stop offset="50%" stop-color="${heatColor(.5)}"/>
          <stop offset="100%" stop-color="${heatColor(1)}"/>
        </linearGradient>
      </defs>
      ${cells}
      ${rowLabels}
      ${colLabels}
      <rect x="${legendX}" y="${legendY}" width="13" height="${legendH}" rx="6" fill="url(#riskLegend)"/>
      <text x="${legendX + 20}" y="${legendY + 11}" class="svg-axis">High</text>
      <text x="${legendX + 20}" y="${legendY + legendH - 2}" class="svg-axis">Low</text>
    </svg>
    <div class="micro-note heat-note">Normalized within each real launch-stress metric row. No synthetic values are used.</div>
  `;
}

function donutSegments(launchReport) {
  const scenarios = Array.isArray(launchReport?.scenarios) ? launchReport.scenarios : [];
  const groups = [
    ["Retail", ["MICRO_BUY", "RETAIL_BUY", "STRONG_RETAIL"]],
    ["Large", ["LARGE_BUY"]],
    ["Whale", ["WHALE_BUY"]],
    ["Migration", ["MIGRATION_PRESSURE"]],
    ["Oversized", ["OVERSIZED_WHALE"]],
  ].map(([label, names]) => ({
    label,
    value: scenarios
      .filter(x => names.includes(x?.name))
      .reduce((sum, x) => sum + Math.max(0, finite(x?.requestedQuote)), 0)
  }));

  const total = groups.reduce((a, b) => a + b.value, 0) || 1;
  let acc = 0;
  const colors = ["#29e8ff", "#6c83ff", "#985bff", "#ffb62e", "#ff4f8b"];
  const stops = groups.map((g, i) => {
    const start = acc;
    const end = acc + (g.value / total) * 100;
    acc = end;
    return `${colors[i]} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  }).join(",");

  const legend = groups.map((g, i) => `
    <div class="pressure-row">
      <span><i style="background:${colors[i]}"></i>${esc(g.label)}</span>
      <strong>${fmt((g.value/total)*100, 1)}%</strong>
    </div>
  `).join("");

  return `
    <div class="donut-wrap">
      <div class="donut" style="background:conic-gradient(${stops})">
        <div class="donut-hole">
          <strong>${fmt(total, 2)}</strong>
          <span>quote tested</span>
        </div>
      </div>
      <div class="pressure-legend">${legend}</div>
    </div>
    <div class="micro-note">Share of requested quote volume across the built-in stress scenarios.</div>
  `;
}

function pressureBars(events) {
  const rows = events.filter(x =>
    Number.isFinite(Number(x?.quoteReserveBefore)) &&
    Number.isFinite(Number(x?.quoteReserveAfter))
  );

  if (!rows.length) return `<div class="empty-chart">No sequential pressure data.</div>`;

  const deltas = rows.map(x => Number(x.quoteReserveAfter) - Number(x.quoteReserveBefore));
  const maxAbs = Math.max(0.000001, ...deltas.map(x => Math.abs(x)));
  const bars = deltas.map((v, i) => {
    const h = Math.max(3, Math.abs(v)/maxAbs*78);
    const positive = v >= 0;
    const left = 8 + i*(92/rows.length);
    const top = positive ? 82-h : 82;
    return `
      <div class="bar-col" style="left:${left}%;height:${h}px;top:${top}px;background:${positive ? "linear-gradient(#49ffd0,#16cfa4)" : "linear-gradient(#b06cff,#7742ff)"}" title="${esc(rows[i].name)}: ${fmt(v,3)}"></div>
    `;
  }).join("");

  const labels = rows.map((x, i) => {
    const left = 8 + i*(92/rows.length);
    return `<span class="bar-label" style="left:${left}%">${esc(String(x.name||"").replaceAll("_"," ").slice(0,8))}</span>`;
  }).join("");

  return `
    <div class="bars">
      <div class="zero-line"></div>
      ${bars}
      ${labels}
    </div>
    <div class="micro-note">Quote-reserve delta per sequential simulation event.</div>
  `;
}

function miniSparkline(values = [], color = "#39e6ff") {
  const nums = values
    .map(Number)
    .filter(Number.isFinite);

  if (nums.length < 2) return "";

  let min = Math.min(...nums);
  let max = Math.max(...nums);

  if (min === max) {
    min -= 1;
    max += 1;
  }

  const w = 118;
  const h = 42;
  const pad = 4;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;

  const points = nums.map((v, i) => {
    const x = pad + (i / (nums.length - 1)) * plotW;
    const y = pad + plotH - ((v - min) / (max - min)) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return `
    <svg class="metric-spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <polyline points="${points}" fill="none" stroke="${esc(color)}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

function metricCard({
  label,
  value,
  sub = "",
  accent = "cyan",
  icon = "◆",
  sparkValues = [],
  sparkColor = "#39e6ff"
}) {
  return `
    <article class="metric ${esc(accent)}">
      <div class="metric-icon">${esc(icon)}</div>
      <div class="metric-copy">
        <div class="metric-label">${esc(label)}</div>
        <div class="metric-value">${value}</div>
        ${sub ? `<div class="metric-sub">${sub}</div>` : ""}
      </div>
      ${miniSparkline(sparkValues, sparkColor)}
    </article>
  `;
}

function recommendationCards(items) {
  return (items || []).map(item => `
    <article class="rec-card">
      <div class="rec-head">
        <span class="rec-tag ${esc(String(item.priority || "info").toLowerCase())}">${esc(item.priority || "INFO")}</span>
        <strong>${esc(item.title)}</strong>
      </div>
      <div class="rec-body"><b>Why:</b> ${esc(item.evidence)}</div>
      <div class="rec-body"><b>Suggested review:</b> ${esc(item.action)}</div>
      <div class="rec-source">Source: ${esc(item.source)}${item.scenario ? ` / ${esc(item.scenario)}` : ""}</div>
    </article>
  `).join("");
}

function insightCards({ unified, precisionText, feeText, launchReport }) {
  const items = [];
  const configScore = finite(unified?.inspector?.riskScore, 0);
  items.push({
    icon: configScore < 15 ? "↑" : "!",
    title: configScore < 15 ? "Configuration risk is low" : "Configuration deserves review",
    text: `Config Inspector scored this setup ${esc(unified?.inspector?.riskLevel ?? "-")} ${esc(unified?.inspector?.riskScore ?? "-")}/100.`
  });

  if (feeText !== "-") {
    items.push({
      icon: "⚙",
      title: "Dynamic fee behavior measured",
      text: `Observed sequential fee range: ${esc(feeText)}.`
    });
  }

  const worst = Number(launchReport?.worstAveragePriceImpactPct);
  if (Number.isFinite(worst)) {
    items.push({
      icon: "↗",
      title: "Largest launch-state execution impact",
      text: `Worst measured average price impact: ${fmt(worst, 2)}%.`
    });
  }

  items.push({
    icon: "✓",
    title: "Precision Advisor",
    text: esc(precisionText)
  });

  return items.slice(0, 4).map(x => `
    <div class="insight">
      <div class="insight-icon">${x.icon}</div>
      <div><strong>${x.title}</strong><span>${x.text}</span></div>
    </div>
  `).join("");
}

export function renderDashboard({
  unified,
  mode,
  modeDisplayName,
  runId,
  sourceDisplayName,
  sourceHashBefore,
  sourceConfigUnchanged,
  precision,
  precisionApplied,
  rpcOverrideApplied,
  builderSummary,
  recommendations,
  launchReport,
  dynamicReport
}) {
  const events = Array.isArray(dynamicReport?.events) ? dynamicReport.events : [];
  const priceRows = events.filter(x =>
    Number.isFinite(Number(x?.priceFactorVsLaunch)) &&
    Number.isFinite(Number(x?.volatilityAccumulator))
  );

  const priceSeries = priceRows.map(x => Number(x.priceFactorVsLaunch));
  const volatilitySeries = priceRows.map(x => Number(x.volatilityAccumulator));
  const eventLabels = priceRows.map(x => niceLabel(x.name));

  const initialFee = Number(unified?.sequentialDynamic?.initialFeeBps);
  const maxFee = Number(unified?.sequentialDynamic?.maxFeeBps);
  const feeText =
    Number.isFinite(initialFee) && Number.isFinite(maxFee)
      ? `${initialFee.toFixed(4)} to ${maxFee.toFixed(4)} bps`
      : "-";

  const precisionText =
    precision?.status === "PRECISION_BUFFER_RECOMMENDED"
      ? `${esc(precision.originalLeftover)} to ${esc(precision.recommendedLeftover)}`
      : precision?.status === "NO_BUFFER_NEEDED"
        ? "No buffer needed"
        : esc(precision?.status ?? "-");

  const dump = Number(unified?.sequentialDynamic?.dumpDrawdownPct);
  const dumpText = Number.isFinite(dump) ? `${dump.toFixed(2)}%` : "-";

  const launchImpactSeries =
    (Array.isArray(launchReport?.scenarios) ? launchReport.scenarios : [])
      .map(x => finite(x?.averagePriceImpactPct, 0));

  const feeSeries =
    events
      .map(x => Number(x?.effectiveFeeBps))
      .filter(Number.isFinite);

  const volatilityMetricSeries =
    events
      .map(x => Number(x?.volatilityAccumulator))
      .filter(Number.isFinite);

  const drawdownPriceSeries =
    events
      .map(x => Number(x?.priceFactorVsLaunch))
      .filter(Number.isFinite);

  const metricHtml = [
    metricCard({
      label: "Curve Type",
      value: esc(modeDisplayName),
      sub: `Mode ${esc(mode)}`,
      accent: "cyan",
      icon: "◉"
    }),
    metricCard({
      label: "Config Risk",
      value: `${esc(unified?.inspector?.riskLevel ?? "-")} ${esc(unified?.inspector?.riskScore ?? "-")}/100`,
      accent: "green",
      icon: "◇"
    }),
    metricCard({
      label: "Launch Stress",
      value: `${esc(unified?.launchStress?.riskLevel ?? "-")} ${esc(unified?.launchStress?.riskScore ?? "-")}/100`,
      accent: "amber",
      icon: "ϟ",
      sparkValues: launchImpactSeries,
      sparkColor: "#ffc44d"
    }),
    metricCard({
      label: "Sequential Dynamic",
      value: `${esc(unified?.sequentialDynamic?.riskLevel ?? "-")} ${esc(unified?.sequentialDynamic?.riskScore ?? "-")}/100`,
      accent: "cyan",
      icon: "⌁",
      sparkValues: drawdownPriceSeries,
      sparkColor: "#39e6ff"
    }),
    metricCard({
      label: "Dynamic Fee Range",
      value: esc(feeText),
      accent: "violet",
      icon: "%",
      sparkValues: feeSeries,
      sparkColor: "#9b72ff"
    }),
    metricCard({
      label: "Max Volatility",
      value: esc(unified?.sequentialDynamic?.maxVolatilityAccumulator ?? "-"),
      accent: "violet",
      icon: "▥",
      sparkValues: volatilityMetricSeries,
      sparkColor: "#b05cff"
    }),
    metricCard({
      label: "Dump Drawdown",
      value: esc(dumpText),
      accent: "pink",
      icon: "↓",
      sparkValues: drawdownPriceSeries,
      sparkColor: "#ff5d9e"
    }),
    metricCard({
      label: "Precision Advisor",
      value: precisionText,
      accent: "green",
      icon: "✦"
    })
  ].join("");

  const pipelineRows = (unified?.pipeline?.steps || []).map(step => `
    <tr>
      <td>${esc(step.name)}</td>
      <td><span class="status ${step.status === "PASS" ? "ok" : "bad"}">${esc(step.status)}</span></td>
      <td>${esc(step.exitCode)}</td>
    </tr>
  `).join("");

  const priceChart = priceSeries.length
    ? svgLineChart({
        series: [
          { name: "Price factor vs launch", values: priceSeries, color: "#39e6ff", axis: "left" },
          { name: "Volatility accumulator", values: volatilitySeries, color: "#a85cff", axis: "right" }
        ],
        xLabels: eventLabels,
        leftLabel: "Price factor",
        rightLabel: "Volatility",
        leftFormat: v => fmt(v, 2),
        rightFormat: v => {
          const n = Number(v);
          if (!Number.isFinite(n)) return "-";
          if (Math.abs(n) >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
          if (Math.abs(n) >= 1_000) return `${(n/1_000).toFixed(0)}k`;
          return n.toFixed(0);
        }
      })
    : `<div class="empty-chart">No sequential price/volatility series.</div>`;

  const pipelinePass = Boolean(unified?.pipeline?.passed);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CurveGuard Competition Edition v1.0 Report</title>
<style>
:root{
  color-scheme:dark;
  --bg:#030817;
  --panel:rgba(6,20,47,.90);
  --panel2:rgba(7,27,58,.92);
  --line:#0ebeff;
  --line2:#6f5cff;
  --text:#f4f8ff;
  --muted:#91a8d1;
  --green:#29f0ad;
  --amber:#ffc44d;
  --pink:#ff5d9e;
}
*{box-sizing:border-box}
html{background:#020611}
body{
  margin:0;
  color:var(--text);
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  background:
    radial-gradient(circle at 78% 0%,rgba(37,74,191,.38),transparent 28%),
    radial-gradient(circle at 15% 12%,rgba(20,119,255,.18),transparent 27%),
    linear-gradient(180deg,#030918 0%,#020711 58%,#01040b 100%);
  min-height:100vh;
}
body:before{
  content:"";
  position:fixed;inset:0;pointer-events:none;opacity:.30;
  background-image:
    radial-gradient(circle at 20% 25%,#39e6ff 0 1px,transparent 1.5px),
    radial-gradient(circle at 68% 16%,#765dff 0 1px,transparent 1.5px),
    radial-gradient(circle at 83% 38%,#39e6ff 0 1px,transparent 1.5px);
  background-size:170px 170px,230px 230px,290px 290px;
}
.shell{width:min(1680px,calc(100% - 26px));margin:auto;padding:20px 0 42px}
.hero{
  position:relative;overflow:hidden;border:1px solid rgba(34,193,255,.35);
  border-radius:22px;padding:24px 26px 20px;margin-bottom:12px;
  background:
    radial-gradient(circle at 72% 35%,rgba(57,230,255,.22),transparent 18%),
    radial-gradient(circle at 84% 30%,rgba(151,75,255,.25),transparent 18%),
    linear-gradient(135deg,rgba(5,25,57,.96),rgba(4,13,32,.93));
  box-shadow:0 0 45px rgba(0,166,255,.14),inset 0 0 35px rgba(57,230,255,.04);
}
.hero:after{
  content:"";position:absolute;right:-5%;top:-58px;width:56%;height:190px;
  border-top:3px solid rgba(57,230,255,.82);border-radius:50%;
  transform:rotate(-5deg);filter:drop-shadow(0 0 15px #1bcfff);opacity:.92
}
.hero:before{
  content:"";position:absolute;right:2%;top:18px;width:38%;height:118px;opacity:.28;
  background:
    linear-gradient(to top,rgba(46,219,255,.58),transparent 70%) 5% 100%/3% 42% no-repeat,
    linear-gradient(to top,rgba(46,219,255,.48),transparent 70%) 12% 100%/3% 65% no-repeat,
    linear-gradient(to top,rgba(124,93,255,.62),transparent 70%) 19% 100%/3% 34% no-repeat,
    linear-gradient(to top,rgba(46,219,255,.52),transparent 70%) 26% 100%/3% 78% no-repeat,
    linear-gradient(to top,rgba(124,93,255,.50),transparent 70%) 33% 100%/3% 52% no-repeat,
    linear-gradient(to top,rgba(46,219,255,.58),transparent 70%) 40% 100%/3% 88% no-repeat;
  filter:drop-shadow(0 0 10px rgba(47,218,255,.55));pointer-events:none
}
.hero-top{display:flex;align-items:center;justify-content:space-between;gap:20px;position:relative;z-index:1}
.brand-wrap{display:flex;align-items:center;gap:16px}
.brand-shield{
  width:62px;height:70px;display:grid;place-items:center;font-size:28px;font-weight:900;
  background:linear-gradient(180deg,#0fe6ff,#1766ff 60%,#8b54ff);
  clip-path:polygon(50% 0,92% 18%,86% 72%,50% 100%,14% 72%,8% 18%);
  filter:drop-shadow(0 0 15px rgba(39,213,255,.85))
}
.brand{font-size:clamp(34px,4vw,62px);font-weight:900;letter-spacing:-2px;line-height:.95;text-shadow:0 0 22px rgba(102,177,255,.35)}
.subtitle{margin-top:8px;color:#b7cdf4;font-weight:650;font-size:clamp(14px,1.3vw,20px)}
.hero-meta{display:flex;align-items:center;gap:16px}
.pass-badge{
  border:1px solid ${pipelinePass ? "#27f0ad" : "#ff647f"};
  color:${pipelinePass ? "#56ffc3" : "#ff8095"};
  background:${pipelinePass ? "rgba(13,119,88,.20)" : "rgba(145,39,63,.18)"};
  border-radius:999px;padding:12px 18px;font-weight:850;box-shadow:0 0 20px rgba(37,237,179,.15);white-space:nowrap
}
.run-meta{font-size:11px;color:#9bb2d9;line-height:1.55;text-align:right;max-width:250px;overflow-wrap:anywhere}
.metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:20px;position:relative;z-index:1}
.metric{
  min-height:104px;border:1px solid rgba(36,202,255,.52);border-radius:14px;padding:14px 14px;
  background:linear-gradient(150deg,rgba(8,39,84,.94),rgba(5,17,39,.96));
  box-shadow:inset 0 0 24px rgba(32,177,255,.07),0 0 15px rgba(0,157,255,.08);
  display:flex;align-items:center;gap:12px;position:relative;overflow:hidden;min-width:0
}
.metric:nth-child(n+6){min-height:82px}
.metric-icon{
  flex:0 0 42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:22px;font-weight:900;
  background:linear-gradient(145deg,rgba(18,181,255,.26),rgba(95,74,255,.20));color:#70efff;
  box-shadow:inset 0 0 16px rgba(50,207,255,.15)
}
.metric-copy{min-width:0;position:relative;z-index:2;max-width:calc(100% - 54px)}
.metric-spark{position:absolute;right:10px;bottom:10px;width:86px;height:32px;opacity:.88;filter:drop-shadow(0 0 5px currentColor);pointer-events:none}
.metric-label{font-size:11px;color:#91a9d4;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px}
.metric-value{font-size:clamp(16px,1.55vw,24px);font-weight:850;line-height:1.08;overflow-wrap:anywhere;text-shadow:0 0 14px rgba(133,190,255,.10)}
.metric-sub{margin-top:5px;color:#9fb4d8;font-size:11px}
.metric:before{content:"";position:absolute;inset:auto -30px -44px auto;width:130px;height:90px;border-radius:50%;filter:blur(8px);opacity:.20}
.metric.green:before{background:#26f0ae}.metric.amber:before{background:#ffbe35}.metric.violet:before{background:#8a5cff}.metric.pink:before{background:#ff4f8f}.metric.cyan:before{background:#31dfff}
.dashboard{display:grid;grid-template-columns:1.5fr 1fr .78fr;gap:12px;margin-top:12px}
.panel{
  min-width:0;border:1px solid rgba(34,191,255,.52);border-radius:15px;
  background:linear-gradient(155deg,rgba(5,28,62,.96),rgba(4,14,33,.97));
  box-shadow:inset 0 0 30px rgba(36,174,255,.055),0 0 15px rgba(0,146,255,.07);
  overflow:hidden
}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 16px;border-bottom:1px solid rgba(35,140,211,.20)}
.panel-title{font-weight:850;font-size:16px;display:flex;align-items:center;gap:8px}
.panel-title:before{content:"⌁";color:#31e2ff;font-size:20px}
.panel-body{padding:14px 16px}
.price-panel{grid-column:span 1}
.fee-panel{grid-column:span 1}
.heat-panel{grid-column:span 1}
.pressure-panel{grid-column:span 1}
.insights-panel{grid-column:span 1}
.builder-panel{grid-column:span 1}
.chart-legend{display:flex;flex-wrap:wrap;gap:14px;font-size:11px;color:#b4c6e4;margin:0 0 4px 52px}
.legend-item{display:flex;align-items:center;gap:6px}.legend-dot{width:9px;height:9px;border-radius:50%;box-shadow:0 0 9px currentColor}
.chart-svg{width:100%;height:auto;display:block;overflow:visible}
.svg-grid{stroke:#193b67;stroke-width:1;stroke-dasharray:3 4;opacity:.75}
.svg-axis{fill:#91a9cb;font-size:11px;font-family:Inter,system-ui,sans-serif}.svg-label{font-size:10px;fill:#aac0e5}
.glow-line{filter:drop-shadow(0 0 5px rgba(59,229,255,.68))}
.heat-x{font-size:9.5px}
.heatmap-svg{height:252px;width:100%}
.heat-note{text-align:center;margin:2px auto 0;max-width:94%}
.empty-chart{height:220px;display:grid;place-items:center;color:#7f96bd}
.donut-wrap{display:grid;grid-template-columns:148px 1fr;gap:18px;align-items:center}
.donut{width:136px;height:136px;border-radius:50%;padding:24px;box-shadow:0 0 26px rgba(72,144,255,.24)}
.donut-hole{width:100%;height:100%;border-radius:50%;background:#07162f;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;box-shadow:inset 0 0 20px rgba(56,210,255,.12)}
.donut-hole strong{font-size:22px}.donut-hole span{font-size:9px;color:#92a8ca}
.pressure-legend{display:grid;gap:7px}.pressure-row{display:flex;justify-content:space-between;gap:12px;color:#bfd0eb;font-size:12px}.pressure-row span{display:flex;align-items:center;gap:7px}.pressure-row i{width:9px;height:9px;border-radius:50%}
.micro-note{font-size:10px;color:#7f97be;margin-top:8px;line-height:1.45}
.bars{height:132px;position:relative;margin-top:5px;border-left:1px solid #244b78;border-bottom:1px solid #244b78}
.zero-line{position:absolute;left:0;right:0;top:82px;border-top:1px dashed #5072a0;opacity:.7}
.bar-col{position:absolute;width:5.5%;min-width:8px;border-radius:3px 3px 0 0;box-shadow:0 0 8px rgba(58,235,215,.25)}
.bar-label{position:absolute;top:112px;transform:rotate(-30deg);transform-origin:left top;color:#7188ad;font-size:7px;white-space:nowrap}
.insights{display:grid;gap:9px}
.insight{display:grid;grid-template-columns:42px 1fr;gap:10px;align-items:center;padding:10px;border:1px solid rgba(66,151,227,.25);border-radius:12px;background:rgba(8,35,72,.68)}
.insight-icon{height:42px;border-radius:11px;display:grid;place-items:center;background:linear-gradient(145deg,#0c7b8a,#0bb67d);font-weight:900;font-size:19px;box-shadow:0 0 14px rgba(36,222,183,.16)}
.insight strong{display:block;font-size:13px}.insight span{display:block;font-size:11px;color:#9fb5d8;margin-top:3px;line-height:1.35}
.builder-list{display:grid;gap:0}.kv{display:flex;justify-content:space-between;gap:14px;padding:12px 3px;border-bottom:1px solid rgba(63,116,180,.18);font-size:12px}.kv span{color:#9cb1d2}.kv strong{overflow-wrap:anywhere;text-align:right}.enabled{color:#40f4b4}
.lower{display:grid;grid-template-columns:.78fr .9fr 1.8fr;gap:12px;margin-top:12px}
.pipeline table{width:100%;border-collapse:collapse}.pipeline th,.pipeline td{padding:9px 10px;border-bottom:1px solid rgba(54,102,157,.20);text-align:left;font-size:11px}.pipeline th{color:#879fc6;text-transform:uppercase;font-size:9px;letter-spacing:.5px}
.status{display:inline-block;border-radius:999px;padding:4px 9px;font-weight:850;font-size:10px}.status.ok{color:#4affbf;background:rgba(32,196,137,.14)}.status.bad{color:#ff7990;background:rgba(229,69,100,.14)}
.safety-list{display:grid;gap:0}.safety-row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid rgba(54,102,157,.18);font-size:11.5px}.safety-row span{color:#9fb5d6}.yes,.safe-no{color:#43efb1}.no{color:#ff6c93}.neutral{color:#9fc3ff}.hash{margin-top:12px;color:#7893ba;font-size:9.5px;line-height:1.45;overflow-wrap:anywhere}
.recs{display:grid;grid-template-columns:1fr 1fr;gap:10px}.rec-card{border:1px solid rgba(56,135,210,.30);border-radius:11px;padding:12px;background:rgba(6,25,53,.84)}.rec-head{display:flex;align-items:center;gap:8px;margin-bottom:7px;font-size:12px}.rec-tag{border-radius:999px;padding:3px 7px;font-size:8.5px;font-weight:900;letter-spacing:.5px}.rec-tag.setup,.rec-tag.info{color:#94c8ff;border:1px solid #3269a7;background:rgba(58,120,200,.14)}.rec-tag.review{color:#ffd06b;border:1px solid #986f20;background:rgba(152,111,32,.13)}.rec-tag.action{color:#ff91a5;border:1px solid #a33d56;background:rgba(163,61,86,.13)}
.rec-body{font-size:10.5px;color:#b5c7e2;line-height:1.48;margin-top:5px}.rec-source{margin-top:7px;color:#718bb3;font-size:9px}
.interpretation{margin-top:12px;padding:18px 20px;border:1px solid rgba(37,180,245,.40);border-radius:14px;background:linear-gradient(145deg,rgba(7,30,62,.94),rgba(4,17,38,.94));display:grid;grid-template-columns:150px 1fr;gap:20px;align-items:start;color:#b9cae4;line-height:1.62}
.interpretation-title{font-size:17px;font-weight:900;color:#f3f8ff;letter-spacing:.1px}
.interpretation-copy{font-size:11.5px}
.interpretation strong{color:#f0f6ff}
.footer{display:flex;justify-content:space-between;gap:20px;margin-top:12px;color:#6f87ae;font-size:10px;line-height:1.55}.footer code{color:#9fc3ff}
@media (max-width:1250px){.metrics{grid-template-columns:repeat(4,1fr)}.dashboard{grid-template-columns:1fr 1fr}.heat-panel,.builder-panel{grid-column:auto}.lower{grid-template-columns:1fr 1fr}.recs-panel{grid-column:1/-1}}
@media (max-width:800px){.shell{width:min(100% - 16px,1680px)}.hero{padding:18px 14px}.hero-top{align-items:flex-start;flex-direction:column}.hero-meta{width:100%;justify-content:space-between}.metrics{grid-template-columns:1fr 1fr}.dashboard,.lower{grid-template-columns:1fr}.panel{grid-column:auto}.brand-shield{width:44px;height:50px}.run-meta{text-align:left}.recs{grid-template-columns:1fr}.interpretation{grid-template-columns:1fr;gap:8px}.metric-spark{width:74px}}
@media (max-width:540px){.metrics{grid-template-columns:1fr}.donut-wrap{grid-template-columns:1fr}.donut{margin:auto}.hero-meta{align-items:flex-start;flex-direction:column}}
</style>
</head>
<body>
<main class="shell">
  <section class="hero">
    <div class="hero-top">
      <div class="brand-wrap">
        <div class="brand-shield">CG</div>
        <div>
          <div class="brand">CurveGuard</div>
          <div class="subtitle">Meteora DBC Pre-Launch Stress Lab - Competition Edition v1.0</div>
        </div>
      </div>
      <div class="hero-meta">
        <div class="pass-badge">${pipelinePass ? "✓ PIPELINE PASS" : "! PIPELINE ATTENTION"}</div>
        <div class="run-meta">Run ID<br>${esc(runId)}<br>Source: ${esc(sourceDisplayName)}</div>
      </div>
    </div>
    <div class="metrics">${metricHtml}</div>
  </section>

  <section class="dashboard">
    <article class="panel price-panel">
      <div class="panel-head"><div class="panel-title">Price & Volatility Simulation</div></div>
      <div class="panel-body">${priceChart}</div>
    </article>

    <article class="panel fee-panel">
      <div class="panel-head"><div class="panel-title">Dynamic Fee Curve</div></div>
      <div class="panel-body">${svgFeeChart(events)}</div>
    </article>

    <article class="panel heat-panel">
      <div class="panel-head"><div class="panel-title">Launch Stress Heatmap</div></div>
      <div class="panel-body">${launchHeatmap(launchReport)}</div>
    </article>

    <article class="panel pressure-panel">
      <div class="panel-head"><div class="panel-title">Whale / Large Order Pressure</div></div>
      <div class="panel-body">
        ${donutSegments(launchReport)}
        <div style="height:12px"></div>
        <div class="panel-title" style="font-size:13px;margin-bottom:8px">Sequential Net Pressure</div>
        ${pressureBars(events)}
      </div>
    </article>

    <article class="panel insights-panel">
      <div class="panel-head"><div class="panel-title">CurveGuard Insights</div></div>
      <div class="panel-body"><div class="insights">${insightCards({ unified, precisionText, feeText, launchReport })}</div></div>
    </article>

    <article class="panel builder-panel">
      <div class="panel-head"><div class="panel-title">Builder Summary</div></div>
      <div class="panel-body builder-list">
        <div class="kv"><span>Curve points</span><strong>${esc(builderSummary?.curvePoints ?? "-")}</strong></div>
        <div class="kv"><span>Migration quote threshold</span><strong>${esc(builderSummary?.migrationQuoteThreshold ?? "-")}</strong></div>
        <div class="kv"><span>Dynamic fee</span><strong class="${builderSummary?.dynamicFeeEnabled ? "enabled" : ""}">${builderSummary?.dynamicFeeEnabled ? "ENABLED" : "DISABLED"}</strong></div>
      </div>
    </article>
  </section>

  <section class="lower">
    <article class="panel pipeline">
      <div class="panel-head"><div class="panel-title">Analysis Pipeline</div></div>
      <div class="panel-body">
        <table>
          <thead><tr><th>Stage</th><th>Status</th><th>Exit</th></tr></thead>
          <tbody>${pipelineRows}</tbody>
        </table>
      </div>
    </article>

    <article class="panel">
      <div class="panel-head"><div class="panel-title">Safety & Source Integrity</div></div>
      <div class="panel-body safety-list">
        <div class="safety-row"><span>Original config unchanged</span><strong class="${sourceConfigUnchanged ? "yes" : "no"}">${sourceConfigUnchanged ? "YES" : "NO"}</strong></div>
        <div class="safety-row"><span>Analysis copy dry-run</span><strong class="yes">YES</strong></div>
        <div class="safety-row"><span>Precision applied to analysis copy</span><strong class="${precisionApplied ? "yes" : "safe-no"}">${precisionApplied ? "YES" : "NO"}</strong></div>
        <div class="safety-row"><span>Mainnet RPC overridden for local analysis</span><strong class="${rpcOverrideApplied ? "neutral" : "safe-no"}">${rpcOverrideApplied ? "YES" : "NO"}</strong></div>
        <div class="safety-row"><span>Transaction created / signed / submitted</span><strong class="safe-no">NO / NO / NO</strong></div>
        <div class="hash">SHA-256: ${esc(sourceHashBefore)}</div>
      </div>
    </article>

    <article class="panel recs-panel">
      <div class="panel-head"><div class="panel-title">Developer Recommendations</div></div>
      <div class="panel-body">
        <div class="recs">${recommendationCards(recommendations?.items || [])}</div>
        <div class="micro-note">Recommendations are CurveGuard diagnostics and developer guidance, not official Meteora protocol advice.</div>
      </div>
    </article>
  </section>

  <section class="interpretation">
    <div class="interpretation-title">Interpretation</div>
    <div class="interpretation-copy">CurveGuard evaluates a Meteora Dynamic Bonding Curve before launch using configuration validation, launch-state stress scenarios, persistent sequential market simulation, dynamic-fee volatility tracking and A/B comparison. Risk scores shown here are <strong>CurveGuard diagnostics</strong>, not an official Meteora protocol rating and not a prediction of token performance.</div>
  </section>

  <footer class="footer">
    <div>Run ID: ${esc(runId)}<br>Source: ${esc(sourceDisplayName)}</div>
    <div>Full machine-readable report: <code>curveguard-report.json</code></div>
  </footer>
</main>
</body>
</html>`;
}
