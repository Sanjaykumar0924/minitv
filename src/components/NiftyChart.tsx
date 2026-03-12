import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  CandlestickSeries,
  LineSeries,
  type CandlestickData,
  type LineData,
  ColorType,
  type Time,
  type SeriesType,
  createSeriesMarkers,
} from "lightweight-charts";
import type { TradingSignal, SRLevel } from "@/lib/patternDetection";
import type { AdvancedTrendline } from "@/lib/trendlineEngine";

type ChartType = "candlestick" | "line";

export interface OHLCData {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface NiftyChartProps {
  data: OHLCData[];
  chartType: ChartType;
  signals?: TradingSignal[];
  advancedTrendlines?: AdvancedTrendline[];
  srLevels?: SRLevel[];
  onSignalClick?: (signal: TradingSignal) => void;
}

export interface NiftyChartHandle {
  updateLastCandle: (price: number) => void;
  focusLatestCandles: (bars?: number) => void;
}

const NiftyChart = forwardRef<NiftyChartHandle, NiftyChartProps>(
  ({ data, chartType, signals = [], advancedTrendlines = [], srLevels = [], onSignalClick }, ref) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
    const lastDataRef = useRef<OHLCData | null>(null);
    const preservedRangeRef = useRef<{ from: number; to: number } | null>(null);

    const focusLatestRange = (bars = 120) => {
      if (!chartRef.current || data.length === 0) return;
      const to = data.length - 1;
      const from = Math.max(0, to - bars);
      chartRef.current.timeScale().setVisibleLogicalRange({ from, to: to + 2 });
      chartRef.current.timeScale().scrollToRealTime();
    };

    useImperativeHandle(ref, () => ({
      updateLastCandle: (price: number) => {
        if (!seriesRef.current || !lastDataRef.current) return;
        const last = lastDataRef.current;
        const updated: OHLCData = {
          ...last,
          close: price,
          high: Math.max(last.high, price),
          low: Math.min(last.low, price),
        };
        lastDataRef.current = updated;
        if (chartType === "candlestick") {
          seriesRef.current.update(updated as CandlestickData);
        } else {
          seriesRef.current.update({ time: updated.time, value: price } as LineData);
        }
      },
      focusLatestCandles: (bars = 120) => {
        focusLatestRange(bars);
      },
    }));

    useEffect(() => {
      if (!chartContainerRef.current || data.length === 0) return;
      const container = chartContainerRef.current;

      const chart = createChart(container, {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "hsl(210, 20%, 55%)",
          fontFamily: "'JetBrains Mono', monospace",
        },
        grid: {
          vertLines: { color: "hsl(220, 14%, 14%)" },
          horzLines: { color: "hsl(220, 14%, 14%)" },
        },
        width: container.clientWidth,
        height: container.clientHeight,
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
        handleScale: {
          axisPressedMouseMove: { time: true, price: true },
          axisDoubleClickReset: { time: true, price: true },
          mouseWheel: true, pinch: true,
        },
        crosshair: {
          vertLine: { color: "hsl(142, 60%, 45%)", width: 1, style: 2 },
          horzLine: { color: "hsl(142, 60%, 45%)", width: 1, style: 2 },
        },
        timeScale: { borderColor: "hsl(220, 14%, 18%)", timeVisible: true, secondsVisible: false, shiftVisibleRangeOnNewBar: true },
        localization: {
          timeFormatter: (time: number) => {
            const d = new Date((time + 19800) * 1000);
            const h = d.getUTCHours().toString().padStart(2, "0");
            const m = d.getUTCMinutes().toString().padStart(2, "0");
            return `${h}:${m}`;
          },
        },
        rightPriceScale: { borderColor: "hsl(220, 14%, 18%)", autoScale: true },
      });

      chartRef.current = chart;
      lastDataRef.current = data[data.length - 1];

      let mainSeries: ISeriesApi<SeriesType>;

      if (chartType === "candlestick") {
        const series = chart.addSeries(CandlestickSeries, {
          upColor: "hsl(142, 60%, 45%)",
          downColor: "hsl(0, 72%, 55%)",
          borderUpColor: "hsl(142, 60%, 45%)",
          borderDownColor: "hsl(0, 72%, 55%)",
          wickUpColor: "hsl(142, 60%, 45%)",
          wickDownColor: "hsl(0, 72%, 55%)",
        });
        series.setData(data as CandlestickData[]);
        mainSeries = series as unknown as ISeriesApi<SeriesType>;
      } else {
        const series = chart.addSeries(LineSeries, {
          color: "hsl(142, 60%, 45%)",
          lineWidth: 2,
        });
        series.setData(data.map((d) => ({ time: d.time, value: d.close })) as LineData[]);
        mainSeries = series as unknown as ISeriesApi<SeriesType>;
      }

      seriesRef.current = mainSeries;

      // ── Signal markers ──
      const allMarkers: Array<{
        time: Time;
        position: "belowBar" | "aboveBar";
        color: string;
        shape: "arrowUp" | "arrowDown" | "circle";
        text: string;
        size: number;
      }> = [];

      if (signals.length > 0) {
        for (const sig of signals) {
          allMarkers.push({
            time: sig.time as unknown as Time,
            position: sig.direction === "bullish" ? "belowBar" : "aboveBar",
            color: "#FFD700",
            shape: sig.direction === "bullish" ? "arrowUp" : "arrowDown",
            text: sig.pattern,
            size: 2,
          });
        }
      }

      // ── Breakout markers from advanced trendlines ──
      for (const tl of advancedTrendlines) {
        if (tl.broken && tl.breakoutIndex !== undefined && tl.breakoutIndex < data.length) {
          allMarkers.push({
            time: data[tl.breakoutIndex].time,
            position: tl.type === "resistance" ? "belowBar" : "aboveBar",
            color: tl.type === "resistance" ? "#00FF88" : "#FF4444",
            shape: "circle",
            text: tl.type === "resistance" ? "⚡ Breakout" : "⚡ Breakdown",
            size: 1,
          });
        }
        if (tl.retested && tl.retestIndex !== undefined && tl.retestIndex < data.length) {
          allMarkers.push({
            time: data[tl.retestIndex].time,
            position: tl.type === "resistance" ? "belowBar" : "aboveBar",
            color: "#AA88FF",
            shape: "circle",
            text: "✓ Retest",
            size: 1,
          });
        }
      }

      if (allMarkers.length > 0) {
        allMarkers.sort((a, b) => (a.time as number) - (b.time as number));
        createSeriesMarkers(mainSeries, allMarkers);
      }

      // ── Support/Resistance horizontal lines ──
      for (const sr of srLevels) {
        const color = sr.type === "support" ? "hsl(210, 80%, 55%)" : "hsl(330, 80%, 55%)";
        const srSeries = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          lineStyle: 1,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: true,
        });

        const firstTime = data[0].time;
        const lastTime = data[data.length - 1].time;
        srSeries.setData([
          { time: firstTime, value: sr.price },
          { time: lastTime, value: sr.price },
        ] as LineData[]);
      }

      // ── Advanced Trendlines with extension & prediction ──
      for (const tl of advancedTrendlines) {
        if (tl.points.length < 2) continue;

        // Color: green for support, red for resistance
        let color: string;
        let lineWidth: 1 | 2 | 3 | 4 = 2;
        let lineStyle: number = 0; // solid

        if (tl.type === "support") {
          color = tl.broken ? "hsla(142, 60%, 45%, 0.3)" : "hsl(142, 60%, 45%)";
        } else {
          color = tl.broken ? "hsla(0, 72%, 55%, 0.3)" : "hsl(0, 72%, 55%)";
        }

        if (tl.category === "horizontal_support" || tl.category === "horizontal_resistance") {
          lineStyle = 1; // dashed
          lineWidth = 1;
        }

        const tlSeries = chart.addSeries(LineSeries, {
          color,
          lineWidth,
          lineStyle,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
        });

        const p1 = tl.points[0];
        const pLast = tl.points[tl.points.length - 1];

        const lineData: LineData[] = [
          { time: p1.time as unknown as Time, value: p1.value },
          { time: pLast.time as unknown as Time, value: pLast.value },
        ];

        // Extended projection into the future
        if (tl.extended.time > pLast.time) {
          lineData.push({ time: tl.extended.time as unknown as Time, value: tl.extended.value });
        }

        tlSeries.setData(lineData);
      }

      // Handle signal click
      if (onSignalClick && signals.length > 0) {
        chart.subscribeClick((param) => {
          if (!param.time) return;
          const clickTime = param.time as number;
          const matched = signals.find((s) => s.time === clickTime);
          if (matched) onSignalClick(matched);
        });
      }

      if (preservedRangeRef.current) {
        chart.timeScale().setVisibleLogicalRange(preservedRangeRef.current);
      } else {
        focusLatestRange();
      }

      const handleResize = () => {
        chart.applyOptions({ width: container.clientWidth });
      };
      window.addEventListener("resize", handleResize);

      return () => {
        preservedRangeRef.current = chart.timeScale().getVisibleLogicalRange();
        window.removeEventListener("resize", handleResize);
        chart.remove();
        seriesRef.current = null;
      };
    }, [data, chartType, signals, advancedTrendlines, srLevels, onSignalClick]);

    return <div ref={chartContainerRef} className="w-full h-full" />;
  }
);

NiftyChart.displayName = "NiftyChart";

export default NiftyChart;
