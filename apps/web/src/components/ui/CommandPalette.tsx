import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Command } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useUiStore } from "../../stores/ui";

interface PaletteAction {
  id: string;
  label: string;
  group: "Navigation" | "Actions";
  shortcut?: string;
  run: () => void;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const open = useUiStore((state) => state.paletteOpen);
  const setOpen = useUiStore((state) => state.setPaletteOpen);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const actions: PaletteAction[] = useMemo(
    () => [
      {
        id: "nav-dashboard",
        label: "Go to Dashboard",
        group: "Navigation",
        run: () => navigate({ to: "/" }),
      },
      {
        id: "nav-agents",
        label: "Open Agents",
        group: "Navigation",
        run: () => navigate({ to: "/agents" }),
      },
      {
        id: "nav-beads",
        label: "Open Beads",
        group: "Navigation",
        run: () => navigate({ to: "/beads" }),
      },
      {
        id: "nav-settings",
        label: "Open Settings",
        group: "Navigation",
        run: () => navigate({ to: "/settings" }),
      },
    ],
    [navigate],
  );

  const filtered = actions.filter((action) =>
    action.label.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(!open);
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="palette-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            className="palette"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="palette__input">
              <Command size={16} />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Jump to..."
                aria-label="Command palette"
              />
              <kbd>ESC</kbd>
            </div>
            <div className="palette__list">
              {filtered.length === 0 ? (
                <div className="palette__empty">No matches</div>
              ) : (
                filtered.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className="palette__item"
                    onClick={() => {
                      action.run();
                      setOpen(false);
                    }}
                  >
                    <span>{action.label}</span>
                    {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
