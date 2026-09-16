// The stored Heel Slide proxy over time, as a plain server-rendered SVG: hairline axes, the recounted lines, and the
// reps the recount accepted shaded behind them. The value is the change in a relative orientation difference between
// two uncalibrated sensors from the resting pose the count was zeroed on, bend direction positive, so the y axis says
// exactly that and the caption says what it is not. Every stored pair is drawn. Pairs the recount did not count are a
// grey dashed line: those before the first press of «Начать» (on that start's zero), and those of a start whose zero
// window holds no stored frame (on their own first half second, since there is no zero to use). With more than one
// start, a vertical dashed line marks where each start's zero was taken. The figure is already capped at
// MAX_CHART_POINTS by the view; this component only maps it to pixels. For a simulated session the caption says first
// that the lines come from the program and not from sensors.

import { formatDecimal, niceTicks, type HeelSlideView } from "@/lib/clinic/heelSlideView";
import { getTranslation } from "@/locales/server";

const WIDTH = 720;
const HEIGHT = 300;
const MARGIN = { top: 14, right: 18, bottom: 46, left: 54 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

type Line = HeelSlideView["chart"]["counted"][number];

export default function HeelSlideProxyChart({
  chart,
  simulated = false,
}: {
  chart: HeelSlideView["chart"];
  simulated?: boolean;
}) {
  const { t, locale } = getTranslation();
  const { counted, uncounted, segments, startMarksMs, startMs, endMs, totalPoints } = chart;
  const lines = [...counted, ...uncounted];

  // Only when nothing was paired at all; stored pairs that could not be recounted are still drawn below.
  if (!lines.length || startMs === null || endMs === null) {
    return (
      <div className="space-y-2">
        {simulated && (
          <p className="text-base font-semibold leading-relaxed text-ink">{t("clinician.heelSlide.simulated.chart")}</p>
        )}
        <p className="text-base leading-relaxed text-ink-soft">{t("clinician.heelSlide.chart.empty")}</p>
      </div>
    );
  }

  const durationS = (endMs - startMs) / 1000;
  const xTicks = niceTicks(0, durationS > 0 ? durationS : 1, 6);
  const xMax = xTicks[xTicks.length - 1];

  let lo = 0;
  let hi = 0;
  for (const line of lines) {
    for (const { value } of line) {
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
  }
  const yTicks = niceTicks(lo, hi, 5);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];

  const x = (tMs: number) => MARGIN.left + ((tMs - startMs) / 1000 / xMax) * PLOT_W;
  const y = (value: number) => MARGIN.top + (1 - (value - yMin) / (yMax - yMin)) * PLOT_H;
  const polyline = (samples: Line) => samples.map((p) => `${x(p.tMs).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const drawnPoints = lines.reduce((sum, line) => sum + line.length, 0);
  const bottom = MARGIN.top + PLOT_H;
  const plotRight = MARGIN.left + PLOT_W;
  const ariaTitle = t("clinician.heelSlide.chart.aria", { points: totalPoints, reps: segments.length });

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
            {simulated ? `${t("clinician.heelSlide.simulated.chart")} ${ariaTitle}` : ariaTitle}
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
              x2={plotRight}
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
          <line x1={MARGIN.left} x2={plotRight} y1={bottom} y2={bottom} className="stroke-ink-faint" strokeWidth={1} />

          {startMarksMs.map((markMs) => {
            const markX = Math.min(plotRight, Math.max(MARGIN.left, x(markMs)));
            return (
              <line
                key={`start${markMs}`}
                x1={markX}
                x2={markX}
                y1={MARGIN.top}
                y2={bottom}
                className="stroke-ink-soft"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
            );
          })}

          {uncounted.map((line) => (
            <polyline
              key={`uncounted${line[0].tMs}`}
              points={polyline(line)}
              fill="none"
              className="stroke-ink-faint"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {counted.map((line) => (
            <polyline
              key={`counted${line[0].tMs}`}
              points={polyline(line)}
              fill="none"
              className="stroke-signal-deep"
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          <text x={plotRight} y={HEIGHT - 4} textAnchor="end" fontSize={13} className="fill-ink-soft">
            {t("clinician.heelSlide.chart.xAxis")}
          </text>
        </svg>
      </div>
      <figcaption className="space-y-2">
        {simulated && (
          <p className="text-base font-semibold leading-relaxed text-ink">{t("clinician.heelSlide.simulated.chart")}</p>
        )}
        {counted.length > 0 && (
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <span aria-hidden="true" className="inline-block h-3.5 w-5 shrink-0 rounded-sm border border-signal/40 bg-signal/15" />
            {t("clinician.heelSlide.chart.legendReps")}
          </p>
        )}
        {chart.beforeStart && (
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <DashSwatch />
            {t("clinician.heelSlide.chart.legendBeforeStart")}
          </p>
        )}
        {chart.ownZero && (
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <DashSwatch />
            {t("clinician.heelSlide.chart.legendNoZero")}
          </p>
        )}
        {startMarksMs.length > 0 && (
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <svg aria-hidden="true" width="20" height="14" className="shrink-0">
              <line x1="10" x2="10" y1="0" y2="14" className="stroke-ink-soft" strokeWidth={1} strokeDasharray="2 3" />
            </svg>
            {t("clinician.heelSlide.chart.legendStarts")}
          </p>
        )}
        <p className="text-base font-medium leading-relaxed text-ink">{t("clinician.heelSlide.chart.caption")}</p>
        {drawnPoints < totalPoints && (
          <p className="text-sm text-ink-soft">
            {t("clinician.heelSlide.chart.downsampled", { shown: drawnPoints, total: totalPoints })}
          </p>
        )}
      </figcaption>
    </figure>
  );
}

function DashSwatch() {
  return (
    <svg aria-hidden="true" width="20" height="14" className="shrink-0">
      <line x1="0" x2="20" y1="7" y2="7" className="stroke-ink-faint" strokeWidth={1.5} strokeDasharray="4 3" />
    </svg>
  );
}
