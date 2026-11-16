// The UI themes (data-theme on <html>, scope §18.2), kept per browser in localStorage.
// Only the enabled ones can be picked for now; the others keep their styles for later.
export const THEMES = [
  { id: "orbitalia", label: "Orbitalia", enabled: true },
  { id: "dark", label: "Dark", enabled: true },
  { id: "light", label: "Light", enabled: true },
  { id: "green-edition", label: "Green edition", enabled: false },
  { id: "eva01", label: "EVA-01", enabled: false },
  { id: "ror2", label: "Rogue", enabled: false },
  { id: "win98", label: "Vintage", enabled: false },
] as const;
export type Theme = (typeof THEMES)[number]["id"];
export const ENABLED_THEMES = THEMES.filter((t) => t.enabled);
const isEnabled = (t: string | undefined): t is Theme => ENABLED_THEMES.some((x) => x.id === t);

/** themes on a light background (the code editor picks its colors from this) */
export const LIGHT_THEMES: readonly Theme[] = ["light", "win98"];

export const currentTheme = (): Theme => {
  const t = document.documentElement.dataset.theme;
  return isEnabled(t) ? t : "orbitalia";
};

export function setTheme(t: Theme) {
  if (!isEnabled(t)) t = "orbitalia";
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("theme", t);
  } catch {
    /* private mode: the theme lasts until the tab closes */
  }
  window.dispatchEvent(new CustomEvent("miniasys:theme", { detail: t }));
}
