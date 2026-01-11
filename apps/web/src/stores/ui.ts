import { create } from "zustand";

export type ThemeName = "dawn" | "dusk";

const DEFAULT_MOCK = import.meta.env.VITE_MOCK_DATA === "true";

const readTheme = (): ThemeName => {
  if (typeof window === "undefined") return "dawn";
  const stored = window.localStorage.getItem("fw-theme");
  return stored === "dusk" || stored === "dawn" ? stored : "dawn";
};

const readMockMode = (): boolean => {
  if (typeof window === "undefined") return DEFAULT_MOCK;
  const stored = window.localStorage.getItem("fw-mock-mode");
  if (stored === "true") return true;
  if (stored === "false") return false;
  return DEFAULT_MOCK;
};

const readSidebarCollapsed = (): boolean => {
  if (typeof window === "undefined") return false;
  const stored = window.localStorage.getItem("fw-sidebar-collapsed");
  return stored === "true";
};

interface UiState {
  // Theme
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;

  // Mock mode
  mockMode: boolean;
  setMockMode: (value: boolean) => void;
  toggleMockMode: () => void;

  // Command palette
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  // Sidebar (desktop)
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;

  // Mobile drawer
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;

  // Modal tracking (for escape key handling)
  activeModals: string[];
  pushModal: (id: string) => void;
  popModal: () => void;
  closeAllModals: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  // Theme
  theme: readTheme(),
  setTheme: (theme) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("fw-theme", theme);
    }
    set({ theme });
  },
  toggleTheme: () => {
    const next = get().theme === "dusk" ? "dawn" : "dusk";
    if (typeof window !== "undefined") {
      window.localStorage.setItem("fw-theme", next);
    }
    set({ theme: next });
  },

  // Mock mode
  mockMode: readMockMode(),
  setMockMode: (value) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("fw-mock-mode", String(value));
    }
    set({ mockMode: value });
  },
  toggleMockMode: () => {
    const next = !get().mockMode;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("fw-mock-mode", String(next));
    }
    set({ mockMode: next });
  },

  // Command palette
  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  // Sidebar
  sidebarCollapsed: readSidebarCollapsed(),
  setSidebarCollapsed: (collapsed) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("fw-sidebar-collapsed", String(collapsed));
    }
    set({ sidebarCollapsed: collapsed });
  },
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    if (typeof window !== "undefined") {
      window.localStorage.setItem("fw-sidebar-collapsed", String(next));
    }
    set({ sidebarCollapsed: next });
  },

  // Mobile drawer
  drawerOpen: false,
  setDrawerOpen: (open) => set({ drawerOpen: open }),
  toggleDrawer: () => set({ drawerOpen: !get().drawerOpen }),

  // Modal tracking
  activeModals: [],
  pushModal: (id) => set({ activeModals: [...get().activeModals, id] }),
  popModal: () => set({ activeModals: get().activeModals.slice(0, -1) }),
  closeAllModals: () =>
    set({ activeModals: [], paletteOpen: false, drawerOpen: false }),
}));
