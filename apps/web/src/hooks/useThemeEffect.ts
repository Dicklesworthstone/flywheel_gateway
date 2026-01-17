import { useEffect } from "react";

import { useUiStore } from "../stores/ui";

export function useThemeEffect() {
  const theme = useUiStore((state) => state.theme);
  const themePreference = useUiStore((state) => state.themePreference);
  const syncWithSystem = useUiStore((state) => state.syncWithSystem);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    root.dataset["theme"] = theme;
  }, [theme]);

  // Listen for system preference changes when in auto mode
  useEffect(() => {
    if (themePreference !== "auto") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = () => {
      syncWithSystem();
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, [themePreference, syncWithSystem]);
}
