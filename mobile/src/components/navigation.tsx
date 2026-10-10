import { Pressable, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { cn } from "@/lib/cn";

export type NavigationTab = "inicio" | "historial" | "chat" | "ajustes";

export type IconName = "home" | "history" | "chat" | "settings" | "bluetooth" | "upload" | "thermometer";

const items: { key: NavigationTab; label: string; icon: IconName }[] = [
  { key: "inicio", label: "Inicio", icon: "home" },
  { key: "historial", label: "Historial", icon: "history" },
  { key: "chat", label: "Asistente", icon: "chat" },
  { key: "ajustes", label: "Ajustes", icon: "settings" },
];

export function AppIcon({ name, active = false, size = 22 }: { name: IconName; active?: boolean; size?: number }) {
  const color = active ? "#FFFFFF" : "#171716";
  const common = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === "home" ? <Path {...common} d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Zm6 11v-7h6v7" /> : null}
      {name === "history" ? <Path {...common} d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2" /> : null}
      {name === "chat" ? <Path {...common} d="M20 15a4 4 0 0 1-4 4H8l-4 3v-7a4 4 0 0 1-1-3V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v8ZM8 10h.01M12 10h.01M16 10h.01" /> : null}
      {name === "settings" ? <Path {...common} d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-12.5v2M12 19v2M21 12h-2M5 12H3m15.4-6.4-1.4 1.4M7 17l-1.4 1.4m12.8 0L17 17M7 7 5.6 5.6" /> : null}
      {name === "bluetooth" ? <Path {...common} d="M12 3v18m0-18 5 5-5 4 5 4-5 5M7 7l5 5-5 5" /> : null}
      {name === "upload" ? <><Path {...common} d="M12 16V3m0 0L7 8m5-5 5 5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></> : null}
      {name === "thermometer" ? <><Path {...common} d="M14 14.8V5a3 3 0 0 0-6 0v9.8a5 5 0 1 0 6 0Z" /><Path {...common} d="M11 8v8" /><Circle cx="11" cy="18" r="1" fill={color} /></> : null}
    </Svg>
  );
}

export function BottomNavigation({ value, onChange }: { value: NavigationTab; onChange: (tab: NavigationTab) => void }) {
  return (
    <View className="border-t border-line bg-canvas px-4 pb-3 pt-2">
      <View className="flex-row rounded-[22px] border border-line bg-paper p-1 shadow-sm">
        {items.map((item) => {
          const active = item.key === value;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              onPress={() => onChange(item.key)}
              className={cn("flex-1 items-center rounded-[18px] py-2.5", active && "bg-ink")}
            >
              <AppIcon name={item.icon} active={active} size={20} />
              <Text className={cn("mt-1 text-[10px] font-semibold", active ? "text-paper" : "text-graphite")}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
