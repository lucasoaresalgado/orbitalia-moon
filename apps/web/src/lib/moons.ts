// Every agent is a moon: a look derived from its slug (stable across sessions and
// machines), so an agent is recognized at a glance in lists, chats and the board.
// Luna, the manager, wears the brand mark's colors.

export interface MoonLook {
  /** surface base, shadow and highlight */
  base: string;
  dark: string;
  light: string;
  /** craters, bands (a gas giant) or speckles */
  pattern: "craters" | "bands" | "speckles";
  ring: boolean;
  /** an eclipse disc like the logo's (Luna only) */
  eclipse: boolean;
  /** seconds per turn on its own axis */
  period: number;
  /** a seed for the surface details */
  seed: number;
}

const PALETTES: [string, string, string][] = [
  ["#5b3fd0", "#1c1150", "#a48cff"], // violet
  ["#1f9e94", "#073a3a", "#7ae8dc"], // teal
  ["#d0892b", "#4a2a06", "#ffd08a"], // amber
  ["#c8456d", "#460c22", "#ff9bb9"], // rose
  ["#3a7fd9", "#0b2552", "#9cc6ff"], // sky
  ["#77a92b", "#233b07", "#c8f08a"], // moss
  ["#d4643f", "#4d1708", "#ffb196"], // coral
  ["#8a94b8", "#262b42", "#dfe5ff"], // ice
  ["#a65ad6", "#35104d", "#e2b3ff"], // orchid
  ["#c9a23a", "#3f2f05", "#f6e19a"], // gold
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function moonFor(slug: string): MoonLook {
  if (slug === "luna") return { base: "#5b3fd0", dark: "#1c1150", light: "#a48cff", pattern: "craters", ring: false, eclipse: true, period: 24, seed: 7 };
  const h = hash(slug);
  const [base, dark, light] = PALETTES[h % PALETTES.length]!;
  const patterns = ["craters", "bands", "speckles"] as const;
  return { base, dark, light, pattern: patterns[(h >>> 4) % 3]!, ring: ((h >>> 7) & 3) === 0, eclipse: false, period: 14 + ((h >>> 9) % 16), seed: h };
}

/** a small deterministic random generator for the surface details */
export function rng(seed: number) {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 10_000) / 10_000;
  };
}
