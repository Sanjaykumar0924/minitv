

## Problem

The chart resets its zoom/scroll position because the entire chart is **destroyed and recreated** every time `data`, `signals`, `advancedTrendlines`, or `srLevels` change. When a new candle arrives (every few minutes), `setData` triggers a cascade: data changes → memoized signals/trendlines/SR levels recompute → the `useEffect` in `NiftyChart` fires → `chart.remove()` runs → a brand new chart is built → zoom/scroll is lost.

The `preservedRangeRef` attempts to restore the range, but it's unreliable because logical ranges shift when data length changes.

## Solution

Refactor `NiftyChart` to **separate chart creation from data updates**:

1. **Split the single `useEffect` into two**:
   - **Chart creation effect** — depends only on `chartType`. Creates the chart instance once and stores it in a ref. Handles resize. Cleans up on unmount or chart type change.
   - **Data update effect** — depends on `data`, `signals`, `advancedTrendlines`, `srLevels`. Uses the existing chart instance to call `series.setData()` and update overlays **without destroying the chart**. Saves and restores the visible time range (using `getVisibleRange()` with actual timestamps, not logical range) so zoom/scroll is preserved.

2. **Use time-based range preservation** instead of logical range — save `chart.timeScale().getVisibleRange()` (actual time values) before updating data, then restore with `setVisibleRange()` after. This is stable regardless of data length changes.

3. **Clean up overlay series** (SR levels, trendlines) by tracking them in a ref and removing them before re-adding on data changes, rather than recreating the whole chart.

### Files Changed

- `src/components/NiftyChart.tsx` — Refactor the single large `useEffect` into a chart-creation effect and a data-update effect. Track overlay series in a ref for cleanup.

