// The UI themes (data-theme on <html>, scope §18.2), kept per browser in localStorage.
export const THEMES = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "green-edition", label: "Green edition" },
  { id: "eva01", label: "EVA-01" },
  { id: "win98", label: "Windows 98" },
] as const;
export type Theme = (typeof THEMES)[number]["id"];

/** themes on a light background (the code editor picks its colors from this) */
export const LIGHT_THEMES: readonly Theme[] = ["light", "win98"];

export const currentTheme = (): Theme => (document.documentElement.dataset.theme as Theme) || "dark";

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("theme", t);
  } catch {
    /* private mode: the theme lasts until the tab closes */
  }
  window.dispatchEvent(new CustomEvent("miniasys:theme", { detail: t }));
}
