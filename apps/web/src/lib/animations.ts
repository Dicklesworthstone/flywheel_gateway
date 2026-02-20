/**
 * Framer Motion animation variants for consistent UI animations.
 *
 * Usage:
 * ```tsx
 * import { modalVariants, fadeVariants } from '@/lib/animations';
 *
 * <motion.div variants={modalVariants} initial="hidden" animate="visible" exit="exit">
 *   ...
 * </motion.div>
 * ```
 */

import type { Transition, Variants } from "framer-motion";

// ============================================
// TIMING CONSTANTS (match CSS variables)
// ============================================

export const DURATION = {
  fast: 0.15,
  normal: 0.2,
  slow: 0.3,
} as const;

export const EASE = {
  out: [0.16, 1, 0.3, 1] as const,
  inOut: [0.4, 0, 0.2, 1] as const,
  spring: { type: "spring", stiffness: 400, damping: 30 } as const,
  bounce: { type: "spring", stiffness: 300, damping: 20 } as const,
};

// ============================================
// FADE VARIANTS
// ============================================

export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: DURATION.normal, ease: EASE.out },
  },
  exit: {
    opacity: 0,
    transition: { duration: DURATION.fast, ease: EASE.out },
  },
};

// ============================================
// MODAL VARIANTS
// ============================================

export const modalBackdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: DURATION.normal },
  },
  exit: {
    opacity: 0,
    transition: { duration: DURATION.fast },
  },
};

export const modalVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
    y: 8,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: DURATION.normal,
      ease: EASE.out,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 8,
    transition: {
      duration: DURATION.fast,
      ease: EASE.out,
    },
  },
};

// ============================================
// DRAWER VARIANTS
// ============================================

export const drawerLeftVariants: Variants = {
  hidden: { x: "-100%" },
  visible: {
    x: 0,
    transition: {
      duration: DURATION.slow,
      ease: EASE.out,
    },
  },
  exit: {
    x: "-100%",
    transition: {
      duration: DURATION.normal,
      ease: EASE.out,
    },
  },
};

export const drawerRightVariants: Variants = {
  hidden: { x: "100%" },
  visible: {
    x: 0,
    transition: {
      duration: DURATION.slow,
      ease: EASE.out,
    },
  },
  exit: {
    x: "100%",
    transition: {
      duration: DURATION.normal,
      ease: EASE.out,
    },
  },
};

// ============================================
// BOTTOM SHEET VARIANTS
// ============================================

export const bottomSheetVariants: Variants = {
  hidden: { y: "100%" },
  visible: {
    y: 0,
    transition: {
      duration: DURATION.slow,
      ease: EASE.out,
    },
  },
  exit: {
    y: "100%",
    transition: {
      duration: DURATION.normal,
      ease: EASE.out,
    },
  },
};

// ============================================
// DROPDOWN VARIANTS
// ============================================

export const dropdownVariants: Variants = {
  hidden: {
    opacity: 0,
    y: -8,
    scale: 0.96,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: DURATION.normal,
      ease: EASE.out,
    },
  },
  exit: {
    opacity: 0,
    y: -8,
    scale: 0.96,
    transition: {
      duration: DURATION.fast,
      ease: EASE.out,
    },
  },
};

// ============================================
// TOOLTIP VARIANTS
// ============================================

export const tooltipVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.96,
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: DURATION.fast,
      ease: EASE.out,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    transition: {
      duration: DURATION.fast,
      ease: EASE.out,
    },
  },
};

// ============================================
// PAGE TRANSITION VARIANTS
// ============================================

export const pageVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 12,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: DURATION.normal,
      ease: EASE.out,
    },
  },
  exit: {
    opacity: 0,
    y: -12,
    transition: {
      duration: DURATION.fast,
      ease: EASE.out,
    },
  },
};

export const pageSlideVariants: Variants = {
  hidden: {
    opacity: 0,
    x: 20,
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: DURATION.normal,
      ease: EASE.out,
    },
  },
  exit: {
    opacity: 0,
    x: -20,
    transition: {
      duration: DURATION.fast,
      ease: EASE.out,
    },
  },
};

// ============================================
// LIST ITEM VARIANTS (staggered)
// ============================================

export const listContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.02,
      staggerDirection: -1,
    },
  },
};

export const listItemVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 8,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: DURATION.normal,
      ease: EASE.out,
    },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: {
      duration: DURATION.fast,
      ease: EASE.out,
    },
  },
};

// ============================================
// SCALE VARIANTS
// ============================================

export const scaleVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.9,
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: DURATION.normal,
      ease: EASE.out,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    transition: {
      duration: DURATION.fast,
      ease: EASE.out,
    },
  },
};

export const popInVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.8,
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: EASE.bounce,
  },
  exit: {
    opacity: 0,
    scale: 0.8,
    transition: {
      duration: DURATION.fast,
      ease: EASE.out,
    },
  },
};

// ============================================
// EXPAND/COLLAPSE VARIANTS
// ============================================

export const expandVariants: Variants = {
  hidden: {
    height: 0,
    opacity: 0,
    overflow: "hidden",
  },
  visible: {
    height: "auto",
    opacity: 1,
    overflow: "visible",
    transition: {
      height: { duration: DURATION.normal, ease: EASE.out },
      opacity: { duration: DURATION.normal, ease: EASE.out },
    },
  },
  exit: {
    height: 0,
    opacity: 0,
    overflow: "hidden",
    transition: {
      height: { duration: DURATION.fast, ease: EASE.out },
      opacity: { duration: DURATION.fast, ease: EASE.out },
    },
  },
};

// ============================================
// TOAST VARIANTS
// ============================================

export const toastVariants: Variants = {
  hidden: {
    opacity: 0,
    x: 24,
    scale: 0.95,
  },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      duration: DURATION.normal,
      ease: EASE.out,
    },
  },
  exit: {
    opacity: 0,
    x: 24,
    scale: 0.95,
    transition: {
      duration: DURATION.fast,
      ease: EASE.out,
    },
  },
};

// ============================================
// BUTTON VARIANTS (hover/tap states)
// ============================================

export const buttonHoverVariants = {
  rest: {
    scale: 1,
    y: 0,
  },
  hover: {
    y: -1,
    transition: { duration: DURATION.fast, ease: EASE.out },
  },
  tap: {
    y: 0,
    scale: 0.98,
    transition: { duration: 0.05 },
  },
};

// ============================================
// SKELETON PULSE
// ============================================

export const skeletonPulse: Transition = {
  repeat: Infinity,
  repeatType: "reverse",
  duration: 1,
  ease: "easeInOut",
};

// ============================================
// UTILITY: Create stagger delay
// ============================================

export function createStaggerDelay(index: number, baseDelay = 0.05): number {
  return index * baseDelay;
}

// ============================================
// UTILITY: Create custom transition
// ============================================

export function createTransition(
  duration: keyof typeof DURATION = "normal",
  ease: "out" | "inOut" = "out",
): Transition {
  return {
    duration: DURATION[duration],
    ease: EASE[ease],
  };
}

// ============================================
// REDUCED MOTION HOOK HELPER
// ============================================

export function getReducedMotionVariants(_variants: Variants): Variants {
  return {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0 } },
    exit: { opacity: 0, transition: { duration: 0 } },
  };
}
