import { Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { cn } from "@/lib/cn";

export type NavigationTab = "inicio" | "historial" | "chat" | "ajustes";

const items: { key: NavigationTab; label: string; icon: string }[] = [
  { key: "inicio", label: "Inicio", icon: "home" },
  { key: "historial", label: "Historial", icon: "history" },
  { key: "chat", label: "Asistente", icon: "chat" },
  { key: "ajustes", label: "Ajustes", icon: "settings" },
];

function NavIcon({ name, active }: { name: string; active: boolean }) {
  const color = active ? "#FFFFFF" : "#080808";
  const common = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      {name === "home" ? <Path {...common} d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Zm6 11v-7h6v7" /> : null}
      {name === "history" ? <Path {...common} d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2" /> : null}
      {name === "chat" ? <Path {...common} d="M20 15a4 4 0 0 1-4 4H8l-4 3v-7a4 4 0 0 1-1-3V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v8ZM8 10h.01M12 10h.01M16 10h.01" /> : null}
      {name === "settings" ? <Path {...common} d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-12.5v2M12 19v2M21 12h-2M5 12H3m15.4-6.4-1.4 1.4M7 17l-1.4 1.4m12.8 0L17 17M7 7 5.6 5.6" /> : null}
    </Svg>
  );
}

export function BottomNavigation({ value, onChange }: { value: NavigationTab; onChange: (tab: NavigationTab) => void }) {
  return (
    <View className="border-t border-mist bg-paper px-5 pb-4 pt-3">
      <View className="flex-row rounded-3xl border border-ink bg-paper p-1">
        {items.map((item) => {
          const active = item.key === value;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              onPress={() => onChange(item.key)}
              className={cn("flex-1 items-center rounded-2xl py-2", active && "bg-ink")}
            >
              <NavIcon name={item.icon} active={active} />
              <Text className={cn("mt-1 text-[10px] font-semibold", active ? "text-paper" : "text-graphite")}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
