/**
 * Keyboard shortcuts hook.
 *
 * Provides global keyboard shortcut handling.
 */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import { useUiStore } from "../stores/ui";

interface ShortcutHandler {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: () => void;
  description: string;
}

/**
 * Check if the current platform is Mac.
 */
function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.platform.toLowerCase().includes("mac");
}

/**
 * Format shortcut for display.
 */
export function formatShortcut(shortcut: ShortcutHandler): string {
  const parts: string[] = [];
  const mac = isMac();

  if (shortcut.ctrl || shortcut.meta) {
    parts.push(mac ? "⌘" : "Ctrl");
  }
  if (shortcut.shift) {
    parts.push(mac ? "⇧" : "Shift");
  }
  if (shortcut.alt) {
    parts.push(mac ? "⌥" : "Alt");
  }
  parts.push(shortcut.key.toUpperCase());

  return parts.join(mac ? "" : "+");
}

/**
 * Default shortcuts.
 */
function useDefaultShortcuts(): ShortcutHandler[] {
  const navigate = useNavigate();
  const { toggleTheme, setPaletteOpen, toggleSidebar } = useUiStore();

  return useMemo(
    () => [
      {
        key: "k",
        meta: true,
        ctrl: true,
        handler: () => setPaletteOpen(true),
        description: "Open command palette",
      },
      {
        key: "\\",
        meta: true,
        ctrl: true,
        handler: toggleSidebar,
        description: "Toggle sidebar",
      },
      {
        key: "1",
        meta: true,
        ctrl: true,
        handler: () => navigate({ to: "/" }),
        description: "Go to Dashboard",
      },
      {
        key: "2",
        meta: true,
        ctrl: true,
        handler: () => navigate({ to: "/agents" }),
        description: "Go to Agents",
      },
      {
        key: "3",
        meta: true,
        ctrl: true,
        handler: () => navigate({ to: "/beads" }),
        description: "Go to Beads",
      },
      {
        key: "4",
        meta: true,
        ctrl: true,
        handler: () => navigate({ to: "/settings" }),
        description: "Go to Settings",
      },
      {
        key: ",",
        meta: true,
        ctrl: true,
        handler: () => navigate({ to: "/settings" }),
        description: "Open Settings",
      },
      {
        key: "d",
        meta: true,
        ctrl: true,
        shift: true,
        handler: toggleTheme,
        description: "Toggle dark mode",
      },
    ],
    [navigate, setPaletteOpen, toggleSidebar, toggleTheme],
  );
}

/**
 * Keyboard shortcuts hook.
 *
 * @param additionalShortcuts - Additional shortcuts to register
 * @param enabled - Whether shortcuts are enabled
 */
export function useKeyboardShortcuts(
  additionalShortcuts: ShortcutHandler[] = [],
  enabled = true,
) {
  const defaultShortcuts = useDefaultShortcuts();
  const allShortcuts = useMemo(
    () => [...defaultShortcuts, ...additionalShortcuts],
    [defaultShortcuts, additionalShortcuts],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Ignore if typing in an input
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      for (const shortcut of allShortcuts) {
        const ctrlOrMeta = shortcut.ctrl || shortcut.meta;
        // Match modifiers exactly: if required, must be pressed; if not, must NOT be pressed
        const modifierMatch =
          (ctrlOrMeta
            ? event.ctrlKey || event.metaKey
            : !event.ctrlKey && !event.metaKey) &&
          (shortcut.shift ? event.shiftKey : !event.shiftKey) &&
          (shortcut.alt ? event.altKey : !event.altKey);

        if (
          modifierMatch &&
          event.key.toLowerCase() === shortcut.key.toLowerCase()
        ) {
          event.preventDefault();
          shortcut.handler();
          return;
        }
      }
    },
    [allShortcuts],
  );

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, handleKeyDown]);

  return {
    shortcuts: allShortcuts,
    formatShortcut,
  };
}
