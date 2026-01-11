import { useEffect } from "react";

import { useUiStore } from "../stores/ui";

export function useThemeEffect() {
  const theme = useUiStore((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset["theme"] = theme;
  }, [theme]);
}
