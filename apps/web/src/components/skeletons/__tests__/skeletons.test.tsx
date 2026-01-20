/**
 * Tests for page-level skeleton components.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  AccountsSkeleton,
  AgentsSkeleton,
  BeadsSkeleton,
  CollaborationGraphSkeleton,
  CostAnalyticsSkeleton,
  DashboardSkeleton,
  DashboardsSkeleton,
  DCGSkeleton,
  FleetSkeleton,
  PageSkeleton,
  PipelinesSkeleton,
  SettingsSkeleton,
  VelocitySkeleton,
} from "../index";

GlobalRegistrator.register();

const skeletons = [
  {
    name: "DashboardSkeleton",
    Component: DashboardSkeleton,
    label: "Loading dashboard",
  },
  {
    name: "AgentsSkeleton",
    Component: AgentsSkeleton,
    label: "Loading agents",
  },
  { name: "FleetSkeleton", Component: FleetSkeleton, label: "Loading fleet" },
  { name: "BeadsSkeleton", Component: BeadsSkeleton, label: "Loading beads" },
  {
    name: "AccountsSkeleton",
    Component: AccountsSkeleton,
    label: "Loading accounts",
  },
  {
    name: "SettingsSkeleton",
    Component: SettingsSkeleton,
    label: "Loading settings",
  },
  {
    name: "DashboardsSkeleton",
    Component: DashboardsSkeleton,
    label: "Loading dashboards",
  },
  { name: "DCGSkeleton", Component: DCGSkeleton, label: "Loading DCG" },
  {
    name: "PipelinesSkeleton",
    Component: PipelinesSkeleton,
    label: "Loading pipelines",
  },
  {
    name: "VelocitySkeleton",
    Component: VelocitySkeleton,
    label: "Loading velocity",
  },
  {
    name: "CollaborationGraphSkeleton",
    Component: CollaborationGraphSkeleton,
    label: "Loading collaboration graph",
  },
  {
    name: "CostAnalyticsSkeleton",
    Component: CostAnalyticsSkeleton,
    label: "Loading cost analytics",
  },
  { name: "PageSkeleton", Component: PageSkeleton, label: "Loading" },
];

describe("Skeleton Components", () => {
  describe.each(skeletons)("$name", ({ name, Component, label }) => {
    it("should render without errors", () => {
      expect(() => render(<Component />)).not.toThrow();
    });

    it("should have aria-busy attribute", () => {
      const { getByRole } = render(<Component />);
      const region = getByRole("region");
      expect(region).toHaveAttribute("aria-busy", "true");
    });

    it("should have aria-label for screen readers", () => {
      const { getByLabelText } = render(<Component />);
      expect(getByLabelText(label)).toBeInTheDocument();
    });

    it("should have page class for layout consistency", () => {
      const { container } = render(<Component />);
      expect(container.querySelector(".page")).toBeInTheDocument();
    });

    it("should contain skeleton elements", () => {
      const { container } = render(<Component />);
      const skeletonElements = container.querySelectorAll(".skeleton");
      expect(skeletonElements.length).toBeGreaterThan(0);
    });
  });
});

describe("Skeleton Accessibility", () => {
  it("all skeletons should be hidden from assistive technology except for loading announcement", () => {
    skeletons.forEach(({ Component, label }) => {
      const { container, getByLabelText, getByRole, unmount } =
        render(<Component />);

      // The container should be aria-busy and have an accessible name
      const region = getByRole("region");
      expect(region).toHaveAttribute("aria-busy", "true");
      expect(region).toHaveAttribute("aria-label", label);

      // Individual skeleton elements should be aria-hidden
      const skeletonElements = container.querySelectorAll(".skeleton");
      skeletonElements.forEach((skeleton) => {
        expect(skeleton).toHaveAttribute("aria-hidden", "true");
      });

      expect(getByLabelText(label)).toBeInTheDocument();
      unmount();
    });
  });
});
