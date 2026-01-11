/**
 * Dropdown component.
 *
 * Accessible dropdown menu with keyboard navigation.
 */

import { AnimatePresence, motion } from "framer-motion";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { dropdownVariants } from "../../lib/animations";

export interface DropdownItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "danger";
  divider?: boolean;
}

interface DropdownProps {
  /** Trigger element */
  trigger: ReactNode;
  /** Menu items */
  items: DropdownItem[];
  /** Position of the menu */
  position?: "bottom-left" | "bottom-right" | "top-left" | "top-right";
  /** Whether to close on item click */
  closeOnClick?: boolean;
  /** Whether dropdown is disabled */
  disabled?: boolean;
  /** Additional CSS class */
  className?: string;
}

/**
 * Dropdown component with keyboard navigation.
 */
export function Dropdown({
  trigger,
  items,
  position = "bottom-left",
  closeOnClick = true,
  disabled = false,
  className = "",
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Filter out divider items for keyboard navigation
  const navigableItems = items.filter(
    (item) => !item.divider && !item.disabled,
  );

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!isOpen) {
        if (
          event.key === "Enter" ||
          event.key === " " ||
          event.key === "ArrowDown"
        ) {
          event.preventDefault();
          setIsOpen(true);
          setFocusedIndex(0);
        }
        return;
      }

      switch (event.key) {
        case "Escape":
          event.preventDefault();
          setIsOpen(false);
          setFocusedIndex(-1);
          break;
        case "ArrowDown":
          event.preventDefault();
          setFocusedIndex((prev) =>
            prev < navigableItems.length - 1 ? prev + 1 : 0,
          );
          break;
        case "ArrowUp":
          event.preventDefault();
          setFocusedIndex((prev) =>
            prev > 0 ? prev - 1 : navigableItems.length - 1,
          );
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < navigableItems.length) {
            const item = navigableItems[focusedIndex];
            if (item?.onClick) {
              item.onClick();
            }
            if (closeOnClick) {
              setIsOpen(false);
              setFocusedIndex(-1);
            }
          }
          break;
        case "Tab":
          setIsOpen(false);
          setFocusedIndex(-1);
          break;
      }
    },
    [isOpen, focusedIndex, navigableItems, closeOnClick],
  );

  const handleItemClick = (item: DropdownItem) => {
    if (item.disabled) return;
    item.onClick?.();
    if (closeOnClick) {
      setIsOpen(false);
      setFocusedIndex(-1);
    }
  };

  const toggleOpen = () => {
    if (disabled) return;
    setIsOpen(!isOpen);
    if (!isOpen) {
      setFocusedIndex(0);
    }
  };

  // Position classes
  const positionClasses = {
    "bottom-left": "dropdown__menu--bottom dropdown__menu--left",
    "bottom-right": "dropdown__menu--bottom dropdown__menu--right",
    "top-left": "dropdown__menu--top dropdown__menu--left",
    "top-right": "dropdown__menu--top dropdown__menu--right",
  };

  return (
    <div
      ref={containerRef}
      className={`dropdown ${isOpen ? "dropdown--open" : ""} ${className}`}
      onKeyDown={handleKeyDown}
    >
      <div
        className="dropdown__trigger"
        onClick={toggleOpen}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-disabled={disabled}
      >
        {trigger}
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={menuRef}
            className={`dropdown__menu ${positionClasses[position]}`}
            variants={dropdownVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="menu"
          >
            {items.map((item, index) => {
              if (item.divider) {
                return <div key={item.id} className="dropdown__divider" />;
              }

              const navigableIndex = navigableItems.findIndex(
                (ni) => ni.id === item.id,
              );
              const isFocused = navigableIndex === focusedIndex;

              return (
                <button
                  key={item.id}
                  className={`dropdown__item ${
                    item.variant === "danger" ? "dropdown__item--danger" : ""
                  } ${isFocused ? "dropdown__item--focused" : ""}`}
                  onClick={() => handleItemClick(item)}
                  disabled={item.disabled}
                  role="menuitem"
                  tabIndex={-1}
                  data-focused={isFocused}
                >
                  {item.icon}
                  {item.label}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
