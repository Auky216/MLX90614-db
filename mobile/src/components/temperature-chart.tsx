import { Text, View } from "react-native";
import Svg, { Line, Path, Rect } from "react-native-svg";

import type { MinuteSummary } from "@/types";

type ChartMode = "average" | "range";

const WIDTH = 336;
const HEIGHT = 190;
const LEFT = 10;
const RIGHT = 10;
const TOP = 16;
const BOTTOM = 24;

function timestamp(summary: MinuteSummary) {
  return new Date(`${summary.minuteUtc}:00.000Z`).getTime();
}

function chartPath(values: number[], low: number, high: number): string {
  if (!values.length) return "";
  const span = high - low || 1;
  const usableWidth = WIDTH - LEFT - RIGHT;
  const usableHeight = HEIGHT - TOP - BOTTOM;
  return values.map((value, index) => {
    const x = LEFT + (values.length === 1 ? usableWidth / 2 : (index / (values.length - 1)) * usableWidth);
    const y = TOP + ((high - value) / span) * usableHeight;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function chartLabel(summaries: MinuteSummary[]) {
  if (!summaries.length) return "";
  const formatter = new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit" });
  return `${formatter.format(new Date(timestamp(summaries[0])))} — ${formatter.format(new Date(timestamp(summaries.at(-1)!)))}`;
}

export function TemperatureChart({ summaries, mode = "average" }: { summaries: MinuteSummary[]; mode?: ChartMode }) {
  const chronological = [...summaries].sort((a, b) => timestamp(a) - timestamp(b));
  const values = mode === "average"
    ? chronological.flatMap((summary) => [summary.ambientAvg, summary.objectAvg])
    : chronological.flatMap((summary) => [summary.ambientMin, summary.ambientMax, summary.objectMin, summary.objectMax]);

  if (!chronological.length) {
    return <View className="h-48 items-center justify-center rounded-[22px] bg-mist"><Text className="text-sm text-graphite">Aún no hay minutos para graficar.</Text></View>;
  }

  const low = Math.floor((Math.min(...values) - 0.3) * 10) / 10;
  const high = Math.ceil((Math.max(...values) + 0.3) * 10) / 10;
  const series = mode === "average"
    ? [
        { label: "Ambiente", color: "#171716", values: chronological.map((item) => item.ambientAvg) },
        { label: "Objeto", color: "#8A8A84", values: chronological.map((item) => item.objectAvg) },
      ]
    : [
        { label: "Amb. min", color: "#171716", values: chronological.map((item) => item.ambientMin) },
        { label: "Amb. max", color: "#61615D", values: chronological.map((item) => item.ambientMax) },
        { label: "Obj. min", color: "#A3A39D", values: chronological.map((item) => item.objectMin) },
        { label: "Obj. max", color: "#C5C5BF", values: chronological.map((item) => item.objectMax) },
      ];

  return (
    <View>
      <View className="mb-3 flex-row flex-wrap gap-x-4 gap-y-2">
        {series.map((item) => <View key={item.label} className="flex-row items-center"><View style={{ backgroundColor: item.color }} className="mr-1.5 h-2 w-2 rounded-full" /><Text className="text-xs text-graphite">{item.label}</Text></View>)}
      </View>
      <Svg width="100%" height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <Rect x="0" y="0" width={WIDTH} height={HEIGHT} rx="18" fill="#F6F6F4" />
        {[0, 0.5, 1].map((ratio) => {
          const y = TOP + ratio * (HEIGHT - TOP - BOTTOM);
          return <Line key={ratio} x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} stroke="#DFDFD9" strokeDasharray="3 4" />;
        })}
        {series.map((item) => <Path key={item.label} d={chartPath(item.values, low, high)} fill="none" stroke={item.color} strokeWidth={mode === "average" ? 3 : 2} strokeLinecap="round" strokeLinejoin="round" />)}
      </Svg>
      <View className="mt-2 flex-row items-center justify-between px-1"><Text className="text-xs text-graphite">{low.toFixed(1)} °C</Text><Text className="text-xs text-graphite">{chartLabel(chronological)}</Text><Text className="text-xs text-graphite">{high.toFixed(1)} °C</Text></View>
    </View>
  );
}
