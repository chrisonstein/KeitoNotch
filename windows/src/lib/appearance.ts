import { loadPrefs } from "./prefs";

/** Light / dark / system, set on <html> so the CSS tokens follow. */
export function applyAppearance() {
  const a = loadPrefs().appearance;
  if (a === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", a);
}
