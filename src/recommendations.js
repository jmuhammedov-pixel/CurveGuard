function humanize(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(
      /\b\w/g,
      char => char.toUpperCase()
    );
}

function numberOrNull(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function maxFromEvents(
  events,
  field
) {
  if (!Array.isArray(events)) {
    return null;
  }

  const values =
    events
      .map(
        event =>
          numberOrNull(
            event?.[field]
          )
      )
      .filter(
        value =>
          value !== null
      );

  return values.length
    ? Math.max(...values)
    : null;
}

export function buildRecommendations({
  riskReport,
  launchReport,
  baseReport,
  dynamicReport,
  comparison,
  precision
}) {
  const items = [];

  function add(item) {
    items.push({
      priority:
        item.priority ||
        "REVIEW",

      code:
        item.code ||
        "GENERAL_REVIEW",

      title:
        item.title ||
        "Review configuration",

      evidence:
        item.evidence ||
        "",

      action:
        item.action ||
        "",

      source:
        item.source ||
        "CurveGuard",

      scenario:
        item.scenario ||
        null
    });
  }

  /*
   * ==========================================================
   * CONFIG INSPECTOR FINDINGS
   * ==========================================================
   */

  const findings =
    Array.isArray(
      riskReport?.findings
    )
      ? riskReport.findings
      : [];

  for (const finding of findings) {

    if (
      finding?.level === "INFO"
    ) {
      continue;
    }

    switch (finding?.code) {

      case "FEE_CLAIMER_PLACEHOLDER":

        add({
          priority:
            "SETUP",

          code:
            finding.code,

          title:
            "Configure the fee claimer",

          evidence:
            finding.message,

          action:
            "Replace the placeholder feeClaimer with the intended production address before deployment.",

          source:
            "Config Inspector"
        });

        break;

      case "LEFTOVER_RECEIVER_PLACEHOLDER":

        add({
          priority:
            "SETUP",

          code:
            finding.code,

          title:
            "Configure the leftover receiver",

          evidence:
            finding.message,

          action:
            "Replace the placeholder leftoverReceiver with the intended production address before deployment.",

          source:
            "Config Inspector"
        });

        break;

      case "DRY_RUN_OFF":

        add({
          priority:
            "ACTION",

          code:
            finding.code,

          title:
            "Enable dry-run validation first",

          evidence:
            finding.message,

          action:
            "Validate the configuration in dry-run or devnet conditions before any live deployment.",

          source:
            "Config Inspector"
        });

        break;

      case "MAINNET_LIVE":

        add({
          priority:
            "ACTION",

          code:
            finding.code,

          title:
            "Do not skip pre-launch validation",

          evidence:
            finding.message,

          action:
            "Switch to dry-run or devnet analysis, resolve flagged issues, and only then consider a live deployment.",

          source:
            "Config Inspector"
        });

        break;

      default:

        add({
          priority:
            finding?.level ===
            "CRITICAL"
              ? "ACTION"
              : "REVIEW",

          code:
            finding?.code ||
            "CONFIG_FINDING",

          title:
            humanize(
              finding?.code ||
              "Configuration finding"
            ),

          evidence:
            finding?.message ||
            "Configuration review required.",

          action:
            "Review this configuration field before deployment.",

          source:
            "Config Inspector"
        });
    }
  }

  /*
   * ==========================================================
   * LAUNCH STRESS FLAGS
   * ==========================================================
   */

  const launchFlags =
    Array.isArray(
      launchReport?.flags
    )
      ? launchReport.flags
      : [];

  for (const flag of launchFlags) {

    if (
      flag?.code ===
      "HIGH_PRICE_IMPACT"
    ) {
      add({
        priority:
          "REVIEW",

        code:
          flag.code,

        scenario:
          flag.scenario,

        title:
          `${humanize(flag.scenario)} execution impact`,

        evidence:
          flag.message,

        action:
          "Review the curve shape, migration threshold and liquidity distribution for this trade-size regime. Re-run CurveGuard after adjusting the configuration.",

        source:
          "Launch Stress"
      });

      continue;
    }

    add({
      priority:
        flag?.level ===
        "CRITICAL"
          ? "ACTION"
          : "REVIEW",

      code:
        flag?.code ||
        "LAUNCH_STRESS_FLAG",

      scenario:
        flag?.scenario,

      title:
        humanize(
          flag?.code ||
          "Launch stress finding"
        ),

      evidence:
        flag?.message ||
        "Launch-state stress condition detected.",

      action:
        "Review the affected scenario and compare it against the intended launch behavior.",

      source:
        "Launch Stress"
    });
  }

  /*
   * ==========================================================
   * LAUNCH ENGINE COUNTERS
   * ==========================================================
   */

  const capacityHits =
    numberOrNull(
      launchReport?.capacityHits
    );

  if (
    capacityHits !== null &&
    capacityHits > 0
  ) {
    add({
      priority:
        "REVIEW",

      code:
        "CAPACITY_HITS",

      title:
        "Curve capacity was reached",

      evidence:
        `CurveGuard observed ${capacityHits} capacity-limited scenario(s).`,

      action:
        "Review migration capacity, quote threshold and intended maximum trade size.",

      source:
        "Launch Stress"
    });
  }

  const quoteErrors =
    numberOrNull(
      launchReport?.quoteErrors
    );

  if (
    quoteErrors !== null &&
    quoteErrors > 0
  ) {
    add({
      priority:
        "ACTION",

      code:
        "QUOTE_ERRORS",

      title:
        "Quote simulation errors detected",

      evidence:
        `${quoteErrors} quote scenario(s) failed during stress analysis.`,

      action:
        "Inspect the failed scenarios and configuration boundaries before deployment.",

      source:
        "Launch Stress"
    });
  }

  /*
   * ==========================================================
   * SEQUENTIAL FLAGS
   * ==========================================================
   */

  for (
    const report of [
      {
        name:
          "Sequential Base",

        data:
          baseReport
      },
      {
        name:
          "Sequential Dynamic",

        data:
          dynamicReport
      }
    ]
  ) {
    const flags =
      Array.isArray(
        report.data?.flags
      )
        ? report.data.flags
        : [];

    for (const flag of flags) {
      add({
        priority:
          flag?.level ===
          "CRITICAL"
            ? "ACTION"
            : "REVIEW",

        code:
          flag?.code ||
          "SEQUENTIAL_FLAG",

        scenario:
          flag?.scenario ||
          flag?.name,

        title:
          humanize(
            flag?.code ||
            "Sequential stress finding"
          ),

        evidence:
          flag?.message ||
          "Sequential market stress condition detected.",

        action:
          "Review the triggering market sequence and compare the base-fee and dynamic-fee runs.",

        source:
          report.name
      });
    }
  }

  /*
   * ==========================================================
   * QUANTITATIVE DYNAMIC-FEE SIGNALS
   * ==========================================================
   */

  const dynamicEvents =
    Array.isArray(
      dynamicReport?.events
    )
      ? dynamicReport.events
      : [];

  const feeValues =
    dynamicEvents
      .map(
        event =>
          numberOrNull(
            event?.effectiveFeeBps
          )
      )
      .filter(
        value =>
          value !== null
      );

  if (
    feeValues.length >= 2
  ) {
    const minFee =
      Math.min(
        ...feeValues
      );

    const maxFee =
      Math.max(
        ...feeValues
      );

    const feeIncrease =
      maxFee -
      minFee;

    /*
     * CurveGuard heuristic:
     * >= 10 bps expansion is worth surfacing
     * to the developer for review.
     */
    if (
      feeIncrease >= 10
    ) {
      add({
        priority:
          "REVIEW",

        code:
          "DYNAMIC_FEE_EXPANSION",

        title:
          "Dynamic fee expanded under stress",

        evidence:
          `Observed fee range: ${minFee.toFixed(4)} to ${maxFee.toFixed(4)} bps (${feeIncrease.toFixed(4)} bps expansion).`,

        action:
          "Confirm that this fee expansion matches the intended protection-versus-user-cost tradeoff.",

        source:
          "Sequential Dynamic"
      });
    }
  }

  const maxDrawdown =
    maxFromEvents(
      dynamicEvents,
      "drawdownFromPeakPct"
    );

  if (
    maxDrawdown !== null &&
    maxDrawdown >= 20
  ) {
    add({
      priority:
        "REVIEW",

      code:
        "LARGE_DRAWDOWN",

      title:
        "Large simulated drawdown",

      evidence:
        `Maximum simulated drawdown reached ${maxDrawdown.toFixed(2)}%.`,

      action:
        "Review liquidity distribution, curve steepness and migration timing under sell pressure.",

      source:
        "Sequential Dynamic"
    });
  }

  /*
   * ==========================================================
   * PRECISION ADVISOR
   * ==========================================================
   */

  if (
    precision?.status ===
    "PRECISION_BUFFER_RECOMMENDED"
  ) {
    add({
      priority:
        "ACTION",

      code:
        "PRECISION_BUFFER",

      title:
        "Precision buffer recommended",

      evidence:
        `Current leftover ${precision.originalLeftover}; minimum tested value ${precision.recommendedLeftover}.`,

      action:
        "Review the suggested leftover precision buffer. CurveGuard applied it only to the analysis copy and did not modify the source config.",

      source:
        "Precision Advisor"
    });
  }

  /*
   * ==========================================================
   * DEDUPLICATION
   * ==========================================================
   */

  const unique = [];

  const seen =
    new Set();

  for (const item of items) {

    const key =
      [
        item.code,
        item.scenario || "",
        item.source
      ].join("|");

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    unique.push(item);
  }

  /*
   * If nothing material was detected,
   * keep the UI informative rather than empty.
   */
  if (
    unique.length === 0
  ) {
    unique.push({
      priority:
        "INFO",

      code:
        "NO_MATERIAL_ADVISORY",

      title:
        "No material advisory findings",

      evidence:
        "The current CurveGuard rules did not identify a configuration or stress condition requiring additional review.",

      action:
        "Continue with normal testing and validate assumptions against the intended launch conditions.",

      source:
        "CurveGuard"
    });
  }

  const counts = {
    SETUP:
      unique.filter(
        x =>
          x.priority === "SETUP"
      ).length,

    ACTION:
      unique.filter(
        x =>
          x.priority === "ACTION"
      ).length,

    REVIEW:
      unique.filter(
        x =>
          x.priority === "REVIEW"
      ).length,

    INFO:
      unique.filter(
        x =>
          x.priority === "INFO"
      ).length
  };

  return {
    engine:
      "CurveGuard Recommendations v0.3",

    note:
      "Recommendations are CurveGuard diagnostics and developer guidance, not official Meteora protocol advice.",

    counts,

    items:
      unique
  };
}