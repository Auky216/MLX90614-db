import Svg, { Circle, Path, Rect } from "react-native-svg";

type IllustrationProps = { size?: number };

// Ilustraciones monocromáticas locales: evitan depender de red durante una captura.
export function SensorIllustration({ size = 112 }: IllustrationProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 112 112" fill="none">
      <Rect x="18" y="27" width="76" height="57" rx="12" stroke="#080808" strokeWidth="3" />
      <Circle cx="56" cy="55" r="18" stroke="#080808" strokeWidth="3" />
      <Circle cx="56" cy="55" r="7" fill="#080808" />
      <Path d="M28 18V27M42 18V27M56 18V27M70 18V27M84 18V27M28 84V94M42 84V94M56 84V94M70 84V94M84 84V94" stroke="#080808" strokeWidth="3" strokeLinecap="round" />
    </Svg>
  );
}

export function BluetoothIllustration({ size = 112 }: IllustrationProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 112 112" fill="none">
      <Rect x="14" y="14" width="84" height="84" rx="42" stroke="#080808" strokeWidth="3" />
      <Path d="M56 25V87M56 25L76 44L56 56L76 68L56 87M36 44L56 56L36 68" stroke="#080808" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

export function ArchiveIllustration({ size = 112 }: IllustrationProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 112 112" fill="none">
      <Rect x="19" y="31" width="74" height="57" rx="8" stroke="#080808" strokeWidth="3" />
      <Path d="M25 31V20H87V31M41 50H71M41 65H64" stroke="#080808" strokeWidth="3" strokeLinecap="round" />
      <Circle cx="82" cy="81" r="14" fill="#080808" />
      <Path d="M82 73V82L88 86" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChatIllustration({ size = 112 }: IllustrationProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 112 112" fill="none">
      <Rect x="14" y="19" width="84" height="66" rx="16" stroke="#080808" strokeWidth="3" />
      <Path d="M38 85 31 96V85M39 47h.01M56 47h.01M73 47h.01" stroke="#080808" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M29 66h54" stroke="#080808" strokeWidth="3" strokeLinecap="round" />
    </Svg>
  );
}
