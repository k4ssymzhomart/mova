// The stored Heel Slide proxy over time, as a plain server-rendered SVG: hairline axes, one line, and the reps the
// recount accepted shaded behind it. The value is a relative orientation difference between two uncalibrated
// sensors, so the y axis says exactly that and the caption says what it is not. The figure is already capped at
// MAX_CHART_POINTS by the view; this component only maps it to pixels.

import { formatDecimal, niceTicks, type HeelSlideView } from "@/lib/clinic/heelSlideView";
import { getTranslation } from "@/locales/server";

const WIDTH = 720;
const HEIGHT = 300;
const MARGIN = { top: 14, right: 18, bottom: 46, left: 54 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

export default function HeelSlideProxyChart({ chart }: { chart: HeelSlideView["chart"] }) {
  const { t, locale } = getTranslation();
  const { points, segments, startMs, endMs, totalPoints } = chart;

  if (!points.length || startMs === null || endMs === null) {
    return <p className="text-base leading-relaxed text-ink-soft">{t("clinician.heelSlide.chart.empty")}</p>;
  }

  const durationS = (endMs - startMs) / 1000;
  const xTicks = niceTicks(0, durationS > 0 ? durationS : 1, 6);
  const xMax = xTicks[xTicks.length - 1];

  let lo = 0;
  let hi = 0;
  for (const { value } of points) {
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  const yTicks = niceTicks(lo, hi, 5);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];

  const x = (tMs: number) => MARGIN.left + ((tMs - startMs) / 1000 / xMax) * PLOT_W;
  const y = (value: number) => MARGIN.top + (1 - (value - yMin) / (yMax - yMin)) * PLOT_H;
  const line = points.map((p) => `${x(p.tMs).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const bottom = MARGIN.top + PLOT_H;

  return (
    <figure className="space-y-3">
      <p className="text-sm font-medium text-ink-soft">{t("clinician.heelSlide.chart.yAxis")}</p>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full min-w-[560px]"
          role="img"
          aria-labelledby="heel-slide-chart-title"
        >
          <title id="heel-slide-chart-title">
            {t("clinician.heelSlide.chart.aria", { points: totalPoints, reps: segments.length })}
          </title>

          {segments.map((segment) => (
            <rect
              key={segment.startMs}
              x={x(segment.startMs)}
              y={MARGIN.top}
              width={Math.max(1, x(segment.endMs) - x(segment.startMs))}
              height={PLOT_H}
              className="fill-signal/15"
            />
          ))}

          {yTicks.map((tick) => (
            <g key={`y${tick}`}>
              <line
                x1={MARGIN.left - 5}
                x2={MARGIN.left}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-ink-faint"
                strokeWidth={1}
              />
              <text
                x={MARGIN.left - 9}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={13}
                className="tnum fill-ink-soft"
              >
                {formatDecimal(tick, locale)}
              </text>
            </g>
          ))}
          {yMin < 0 && yMax > 0 && (
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + PLOT_W}
              y1={y(0)}
              y2={y(0)}
              className="stroke-ink-faint"
              strokeWidth={1}
              strokeDasharray="3 4"
            />
          )}

          {xTicks.map((tick) => (
            <g key={`x${tick}`}>
              <line
                x1={x(startMs + tick * 1000)}
                x2={x(startMs + tick * 1000)}
                y1={bottom}
                y2={bottom + 5}
                className="stroke-ink-faint"
                strokeWidth={1}
              />
              <text
                x={x(startMs + tick * 1000)}
                y={bottom + 20}
                textAnchor="middle"
                fontSize={13}
                className="tnum fill-ink-soft"
              >
                {formatDecimal(tick, locale)}
              </text>
            </g>
          ))}

          <line x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={bottom} className="stroke-ink-faint" strokeWidth={1} />
          <line
            x1={MARGIN.left}
            x2={MARGIN.left + PLOT_W}
            y1={bottom}
            y2={bottom}
            className="stroke-ink-faint"
            strokeWidth={1}
          />

          <polyline
            points={line}
            fill="none"
            className="stroke-signal-deep"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          <text x={MARGIN.left + PLOT_W} y={HEIGHT - 4} textAnchor="end" fontSize={13} className="fill-ink-soft">
            {t("clinician.heelSlide.chart.xAxis")}
          </text>
        </svg>
      </div>
      <figcaption className="space-y-2">
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <span aria-hidden="true" className="inline-block h-3.5 w-5 rounded-sm border border-signal/40 bg-signal/15" />
          {t("clinician.heelSlide.chart.legendReps")}
        </p>
        <p className="text-base font-medium leading-relaxed text-ink">{t("clinician.heelSlide.chart.caption")}</p>
        {points.length < totalPoints && (
          <p className="text-sm text-ink-soft">
            {t("clinician.heelSlide.chart.downsampled", { shown: points.length, total: totalPoints })}
          </p>
        )}
      </figcaption>
    </figure>
  );
}
