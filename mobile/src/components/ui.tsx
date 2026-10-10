import type { PropsWithChildren } from "react";
import { Pressable, Text, View, type PressableProps } from "react-native";

import { cn } from "@/lib/cn";

export function Card({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <View className={cn("rounded-[26px] border border-line bg-paper p-5 shadow-sm", className)}>{children}</View>;
}

export function Button({ children, className, disabled, ...props }: PropsWithChildren<PressableProps & { className?: string }>) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      className={cn("items-center rounded-full bg-ink px-5 py-3.5 active:opacity-70", disabled && "opacity-40", className)}
      {...props}
    >
      <Text className="font-semibold text-paper">{children}</Text>
    </Pressable>
  );
}

export function OutlineButton({ children, className, disabled, ...props }: PropsWithChildren<PressableProps & { className?: string }>) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      className={cn("items-center rounded-full border border-line bg-paper px-5 py-3.5 active:bg-mist", disabled && "opacity-40", className)}
      {...props}
    >
      <Text className="font-semibold text-ink">{children}</Text>
    </Pressable>
  );
}

export function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <View className="min-h-32 flex-1 rounded-[22px] border border-line bg-paper p-4">
      <Text className="text-xs font-medium uppercase tracking-wider text-graphite">{label}</Text>
      <Text className="mt-4 text-2xl font-bold text-ink">{value}</Text>
      {detail ? <Text className="mt-2 text-xs text-graphite">{detail}</Text> : null}
    </View>
  );
}
