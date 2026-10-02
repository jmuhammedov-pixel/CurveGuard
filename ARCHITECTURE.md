# CurveGuard Architecture

## Competition Edition

Browser UI
  |
  | Upload Config / Demo Preset
  v
Local CurveGuard Web API
  |
  v
One-Click Analyzer
  |
  +-- Config Inspector
  |
  +-- Precision Advisor
  |
  v
Universal Meteora Curve Builder
  |
  +-- Mode 0: Standard Quote Threshold
  +-- Mode 1: Market Cap
  +-- Mode 2: Two Segment
  +-- Mode 3: Liquidity Weights
  +-- Mode 4: Mid Price
  +-- Mode 5: Custom Prices
  |
  v
Launch Stress Engine
  |
  v
Sequential Simulation
  |
  +-- Base Fee
  +-- Dynamic Fee
  |
  v
A/B Comparator
  |
  v
Recommendations Engine
  |
  v
HTML Dashboard + JSON Report

## Design Principles

### Source config remains read-only

CurveGuard computes SHA-256 before and after analysis to verify that the input configuration was not modified.

### Temporary analysis copy

Simulation-only adjustments, including a precision buffer when required, are applied only to an isolated analysis copy.

### Dry-run first

The Competition Edition does not require transaction permissions.

### Structured diagnostics

Analysis engines return structured findings and metrics rather than only console output.

### Two stress approaches

CurveGuard combines:

1. independent launch-state scenarios;
2. persistent sequential market simulation.

These approaches reveal different classes of curve behavior.

### Stable analysis core

The browser interface is separated from the simulation core.
The same analysis pipeline can be invoked from the browser UI or directly from the command line.
