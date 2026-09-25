"use client";

import { ResponsiveLine, type LineCustomSvgLayerProps, type LineSeries } from "@nivo/line";
import { DateTime } from "luxon";
import { useExtracted } from "next-intl";
import { useMemo } from "react";

import type { ExperimentTimeseries } from "@/api/analytics/endpoints";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { useNivoTheme } from "@/lib/nivo";

// Control is the neutral reference (gray, dashed); variants take a fixed,
// validated categorical order by their position in the flag, never by rank.
const CONTROL_COLOR = "hsl(var(--neutral-500))";
const VARIANT_COLORS = [
  "hsl(var(--indigo-500))",
  "hsl(var(--teal-600))",
  "hsl(var(--amber-600))",
  "hsl(var(--pink-600))",
];

type SeriesDatum = { x: string; y: number; units: number; conversions: number };
type Series = LineSeries & { id: string; color: string; isControl: boolean; data: SeriesDatum[] };

export function getVariantColor(variant: string, variants: string[], controlVariant: string | undefined) {
  if (variant === controlVariant) return CONTROL_COLOR;
  const index = variants.filter(key => key !== controlVariant).indexOf(variant);
  return VARIANT_COLORS[Math.max(index, 0) % VARIANT_COLORS.length];
}

// Lines drawn by hand so the control reference can be dashed: identity is then
// carried by stroke style as well as hue.
function LinesLayer({ series, lineGenerator }: LineCustomSvgLayerProps<Series>) {
  return (
    <g>
      {series.map(line => (
        <path
          key={line.id}
          d={lineGenerator(line.data.map(point => point.position)) ?? undefined}
          fill="none"
          stroke={line.color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={(line as unknown as Series).isControl ? "5 4" : undefined}
        />
      ))}
    </g>
  );
}

const LABEL_GAP = 13;

// Direct labels at each line's end, in text ink with a colored tick for
// identity, nudged apart when lines end close together. A one-day line has no
// segment to draw, so it gets an end dot.
function EndLabelsLayer({ series }: LineCustomSvgLayerProps<Series>) {
  const ends = series
    .map(line => ({ line, last: line.data[line.data.length - 1] }))
    .filter(end => end.last)
    .sort((a, b) => a.last.position.y - b.last.position.y);

  let previousY = -Infinity;
  const placed = ends.map(end => {
    const labelY = Math.max(end.last.position.y, previousY + LABEL_GAP);
    previousY = labelY;
    return { ...end, labelY };
  });

  return (
    <g>
      {placed.map(({ line, last, labelY }) => (
        <g key={line.id}>
          {line.data.length === 1 && (
            <circle cx={last.position.x} cy={last.position.y} r={4} fill={line.color} className="stroke-white dark:stroke-neutral-900" strokeWidth={2} />
          )}
          <g transform={`translate(${last.position.x + 8}, ${labelY})`}>
            <rect x={0} y={-1} width={6} height={2} rx={1} fill={line.color} />
            <text x={10} dominantBaseline="central" className="fill-neutral-600 font-mono text-[11px] dark:fill-neutral-300">
              {line.id}
            </text>
          </g>
        </g>
      ))}
    </g>
  );
}

export function ExperimentConversionChart({
  data,
  variants,
  controlVariant,
}: {
  data: ExperimentTimeseries;
  variants: string[];
  controlVariant: string | undefined;
}) {
  const t = useExtracted();
  const nivoTheme = useNivoTheme();

  const series = useMemo<Series[]>(
    () =>
      data.variants.map(({ variant, points }) => ({
        id: variant,
        color: getVariantColor(variant, variants, controlVariant),
        isControl: variant === controlVariant,
        // Days before the arm's first unit have no rate to plot.
        data: points
          .filter(point => point.units > 0)
          .map(point => ({
            x: point.date,
            y: point.conversionRate * 100,
            units: point.units,
            conversions: point.conversions,
          })),
      })),
    [data, variants, controlVariant]
  );

  const days = data.variants[0]?.points.map(point => point.date) ?? [];
  if (days.length === 0 || series.every(line => line.data.length === 0)) return null;

  const maxY = Math.max(1, ...series.flatMap(line => line.data.map(point => Number(point.y)))) * 1.15;
  const tickEvery = Math.max(1, Math.ceil(days.length / 6));
  const labelWidth = Math.max(...series.map(line => String(line.id).length)) * 7 + 24;

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          {t("Cumulative conversion rate")}
        </span>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-500 dark:text-neutral-400">
          {series.map(line => (
            <span key={line.id} className="inline-flex items-center gap-1.5 font-mono">
              <svg width="14" height="4" aria-hidden="true">
                <line
                  x1="1"
                  y1="2"
                  x2="13"
                  y2="2"
                  stroke={line.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={line.isControl ? "3 3" : undefined}
                />
              </svg>
              {line.id}
            </span>
          ))}
        </div>
      </div>
      <div className="h-44">
        <ResponsiveLine<Series>
          data={series}
          theme={nivoTheme}
          margin={{ top: 8, right: labelWidth, bottom: 24, left: 40 }}
          xScale={{ type: "point" }}
          yScale={{ type: "linear", min: 0, max: maxY }}
          colors={line => line.color}
          axisBottom={{
            tickSize: 0,
            tickPadding: 8,
            tickValues: days.filter((_, index) => index % tickEvery === 0),
            format: value => DateTime.fromISO(String(value)).toFormat("MMM d"),
          }}
          axisLeft={{ tickSize: 0, tickPadding: 8, tickValues: 4, format: value => `${Number(value).toFixed(0)}%` }}
          gridYValues={4}
          enableGridX={false}
          pointSize={0}
          enableSlices="x"
          layers={["grid", "axes", LinesLayer, "crosshair", "slices", EndLabelsLayer]}
          sliceTooltip={({ slice }) => (
            <ChartTooltip>
              <div className="p-2 text-xs">
                <div className="mb-1.5 font-medium text-neutral-700 dark:text-neutral-200">
                  {DateTime.fromISO(String(slice.points[0]?.data.x)).toFormat("EEE, MMM d")}
                </div>
                <div className="grid gap-1">
                  {slice.points.map(point => {
                    const datum = point.data as unknown as SeriesDatum;
                    return (
                      <div key={point.id} className="flex items-center justify-between gap-4 tabular-nums">
                        <span className="flex items-center gap-1.5 font-mono text-neutral-600 dark:text-neutral-300">
                          <span className="h-3 w-1 rounded-[3px]" style={{ backgroundColor: point.seriesColor }} />
                          {point.seriesId}
                        </span>
                        <span className="text-neutral-700 dark:text-neutral-200">
                          {datum.y.toFixed(2)}%{" "}
                          <span className="text-neutral-400 dark:text-neutral-500">
                            ({datum.conversions}/{datum.units})
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </ChartTooltip>
          )}
        />
      </div>
    </div>
  );
}
