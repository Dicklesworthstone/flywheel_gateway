/**
 * Page-level Skeleton Components for lazy route loading.
 *
 * These skeletons match the layout of their respective pages to prevent
 * layout shift during route transitions.
 */

import { Skeleton, SkeletonCard, SkeletonText } from "../ui/Skeleton";

// ============================================================================
// Shared Skeleton Components
// ============================================================================

function SkeletonTableHeader({ columns }: { columns: number }) {
  return (
    <div className="table__row table__row--header">
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} variant="text" style={{ width: "60%" }} />
      ))}
    </div>
  );
}

function SkeletonTableRow({ columns }: { columns: number }) {
  return (
    <div className="table__row">
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          style={{ width: i === 0 ? "80%" : "60%" }}
        />
      ))}
    </div>
  );
}

function SkeletonTable({
  rows = 5,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="table">
      <SkeletonTableHeader columns={columns} />
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonTableRow key={i} columns={columns} />
      ))}
    </div>
  );
}

// ============================================================================
// Dashboard Page Skeleton
// ============================================================================

export function DashboardSkeleton() {
  return (
    <div
      className="page"
      role="region"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      {/* Top stats grid */}
      <section className="grid grid--2">
        <div className="card">
          <div className="card__header">
            <Skeleton variant="text" style={{ width: 100 }} />
            <Skeleton variant="button" style={{ width: 80 }} />
          </div>
          <Skeleton
            variant="text"
            style={{ width: 60, height: 48, marginBottom: 8 }}
          />
          <Skeleton variant="text-sm" style={{ width: "70%" }} />
        </div>
        <div className="card">
          <div className="card__header">
            <Skeleton variant="text" style={{ width: 100 }} />
            <Skeleton variant="button" style={{ width: 80 }} />
          </div>
          <Skeleton
            variant="text"
            style={{ width: 60, height: 48, marginBottom: 8 }}
          />
          <Skeleton variant="text-sm" style={{ width: "70%" }} />
        </div>
      </section>

      {/* Metrics grid */}
      <section className="grid grid--3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card card--compact">
            <Skeleton
              variant="text-sm"
              style={{ width: 80, marginBottom: 8 }}
            />
            <Skeleton
              variant="text"
              style={{ width: 60, height: 32, marginBottom: 4 }}
            />
            <Skeleton variant="text-sm" style={{ width: "60%" }} />
          </div>
        ))}
      </section>
    </div>
  );
}

// ============================================================================
// Agents Page Skeleton
// ============================================================================

export function AgentsSkeleton() {
  return (
    <div
      className="page"
      role="region"
      aria-busy="true"
      aria-label="Loading agents"
    >
      <div className="card">
        <div className="card__header">
          <Skeleton variant="text" style={{ width: 80 }} />
          <Skeleton variant="button" style={{ width: 70 }} />
        </div>
        <SkeletonTable rows={6} columns={4} />
      </div>
    </div>
  );
}

// ============================================================================
// Fleet Page Skeleton
// ============================================================================

export function FleetSkeleton() {
  return (
    <div
      className="page"
      role="region"
      aria-busy="true"
      aria-label="Loading fleet"
    >
      {/* Stats row */}
      <section className="grid grid--4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card card--compact">
            <Skeleton
              variant="text-sm"
              style={{ width: 60, marginBottom: 8 }}
            />
            <Skeleton variant="text" style={{ width: 40, height: 32 }} />
          </div>
        ))}
      </section>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Skeleton variant="button" style={{ width: 80 }} />
        <Skeleton variant="button" style={{ width: 80 }} />
        <Skeleton variant="button" style={{ width: 80 }} />
      </div>

      {/* Table */}
      <div className="card">
        <SkeletonTable rows={8} columns={5} />
      </div>
    </div>
  );
}

// ============================================================================
// Beads Page Skeleton
// ============================================================================

export function BeadsSkeleton() {
  return (
    <div
      className="page"
      role="region"
      aria-busy="true"
      aria-label="Loading beads"
    >
      <div className="card">
        <div className="card__header">
          <Skeleton variant="text" style={{ width: 80 }} />
          <Skeleton variant="button" style={{ width: 90 }} />
        </div>
        <SkeletonTable rows={10} columns={5} />
      </div>
    </div>
  );
}

// ============================================================================
// Accounts Page Skeleton
// ============================================================================

export function AccountsSkeleton() {
  return (
    <div
      className="page"
      role="region"
      aria-busy="true"
      aria-label="Loading accounts"
    >
      {/* Account cards */}
      <section className="grid grid--2">
        {[1, 2, 3, 4].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </section>
    </div>
  );
}

// ============================================================================
// Settings Page Skeleton
// ============================================================================

export function SettingsSkeleton() {
  return (
    <div
      className="page"
      role="region"
      aria-busy="true"
      aria-label="Loading settings"
    >
      <div className="card">
        <div className="card__header">
          <Skeleton variant="text" style={{ width: 100 }} />
        </div>
        {/* Form fields */}
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{ marginBottom: 24 }}>
            <Skeleton
              variant="text-sm"
              style={{ width: 120, marginBottom: 8 }}
            />
            <Skeleton variant="text" style={{ width: "100%", height: 40 }} />
          </div>
        ))}
        <Skeleton variant="button" style={{ width: 100 }} />
      </div>
    </div>
  );
}

// ============================================================================
// Dashboards Page Skeleton
// ============================================================================

export function DashboardsSkeleton() {
  return (
    <div
      className="page"
      role="region"
      aria-busy="true"
      aria-label="Loading dashboards"
    >
      {/* Dashboard grid */}
      <section className="grid grid--3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </section>
    </div>
  );
}

// ============================================================================
// DCG Page Skeleton
// ============================================================================

export function DCGSkeleton() {
  return (
    <div
      className="page"
      role="region"
      aria-busy="true"
      aria-label="Loading DCG"
    >
      {/* Stats */}
      <section className="grid grid--3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card card--compact">
            <Skeleton
              variant="text-sm"
              style={{ width: 80, marginBottom: 8 }}
            />
            <Skeleton variant="text" style={{ width: 50, height: 36 }} />
          </div>
        ))}
      </section>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Skeleton variant="button" style={{ width: 100 }} />
        <Skeleton variant="button" style={{ width: 100 }} />
        <Skeleton variant="button" style={{ width: 100 }} />
      </div>

      {/* Content */}
      <div className="card">
        <SkeletonTable rows={6} columns={4} />
      </div>
    </div>
  );
}

// ============================================================================
// Pipelines Page Skeleton
// ============================================================================

export function PipelinesSkeleton() {
  return (
    <div
      className="page"
      role="region"
      aria-busy="true"
      aria-label="Loading pipelines"
    >
      <div className="card">
        <div className="card__header">
          <Skeleton variant="text" style={{ width: 100 }} />
          <Skeleton variant="button" style={{ width: 100 }} />
        </div>
        <SkeletonTable rows={8} columns={5} />
      </div>
    </div>
  );
}

// ============================================================================
// Velocity Page Skeleton
// ============================================================================

export function VelocitySkeleton() {
  return (
    <div
      className="page"
      role="region"
      aria-busy="true"
      aria-label="Loading velocity"
    >
      {/* Chart area */}
      <div className="card" style={{ minHeight: 300 }}>
        <div className="card__header">
          <Skeleton variant="text" style={{ width: 120 }} />
          <Skeleton variant="button" style={{ width: 80 }} />
        </div>
        <Skeleton style={{ width: "100%", height: 250, borderRadius: 8 }} />
      </div>

      {/* Stats */}
      <section className="grid grid--4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card card--compact">
            <Skeleton
              variant="text-sm"
              style={{ width: 80, marginBottom: 8 }}
            />
            <Skeleton variant="text" style={{ width: 50, height: 32 }} />
          </div>
        ))}
      </section>
    </div>
  );
}

// ============================================================================
// Collaboration Graph Page Skeleton
// ============================================================================

export function CollaborationGraphSkeleton() {
  return (
    <div
      className="page"
      role="region"
      aria-busy="true"
      aria-label="Loading collaboration graph"
    >
      {/* Graph area */}
      <div className="card" style={{ minHeight: 400 }}>
        <div className="card__header">
          <Skeleton variant="text" style={{ width: 150 }} />
          <Skeleton variant="button" style={{ width: 80 }} />
        </div>
        <Skeleton style={{ width: "100%", height: 350, borderRadius: 8 }} />
      </div>
    </div>
  );
}

// ============================================================================
// Cost Analytics Page Skeleton
// ============================================================================

export function CostAnalyticsSkeleton() {
  return (
    <div
      className="page"
      role="region"
      aria-busy="true"
      aria-label="Loading cost analytics"
    >
      {/* Summary cards */}
      <section className="grid grid--4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card card--compact">
            <Skeleton
              variant="text-sm"
              style={{ width: 80, marginBottom: 8 }}
            />
            <Skeleton variant="text" style={{ width: 70, height: 36 }} />
          </div>
        ))}
      </section>

      {/* Chart */}
      <div className="card" style={{ minHeight: 300 }}>
        <div className="card__header">
          <Skeleton variant="text" style={{ width: 100 }} />
        </div>
        <Skeleton style={{ width: "100%", height: 250, borderRadius: 8 }} />
      </div>

      {/* Breakdown table */}
      <div className="card">
        <div className="card__header">
          <Skeleton variant="text" style={{ width: 120 }} />
        </div>
        <SkeletonTable rows={5} columns={4} />
      </div>
    </div>
  );
}

// ============================================================================
// Setup Page Skeleton
// ============================================================================

export function SetupSkeleton() {
  return (
    <div
      className="page"
      role="region"
      aria-busy="true"
      aria-label="Loading setup"
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <Skeleton variant="text" style={{ width: 200, height: 32, marginBottom: 8 }} />
          <Skeleton variant="text-sm" style={{ width: 300 }} />
        </div>
        <Skeleton variant="button" style={{ width: 100 }} />
      </div>

      {/* Steps */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <Skeleton variant="button" style={{ flex: 1, height: 40 }} />
        <Skeleton variant="button" style={{ flex: 1, height: 40 }} />
        <Skeleton variant="button" style={{ flex: 1, height: 40 }} />
      </div>

      {/* Status cards */}
      <section className="grid grid--2">
        <div className="card">
          <Skeleton variant="text" style={{ width: 120, marginBottom: 16 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <Skeleton style={{ width: 100, height: 100, borderRadius: "50%" }} />
            <div>
              <Skeleton variant="text-sm" style={{ width: 150, marginBottom: 8 }} />
              <Skeleton variant="text-sm" style={{ width: 120 }} />
            </div>
          </div>
        </div>
        <SkeletonCard />
      </section>

      {/* Tools grid */}
      <section style={{ marginTop: 24 }}>
        <Skeleton variant="text" style={{ width: 150, marginBottom: 12 }} />
        <div className="grid grid--2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card card--compact">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Skeleton style={{ width: 36, height: 36, borderRadius: 8 }} />
                <div>
                  <Skeleton variant="text" style={{ width: 100, marginBottom: 4 }} />
                  <Skeleton variant="text-sm" style={{ width: 60 }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ============================================================================
// Generic Page Skeleton (fallback)
// ============================================================================

export function PageSkeleton() {
  return (
    <div className="page" role="region" aria-busy="true" aria-label="Loading">
      <SkeletonCard />
      <div style={{ marginTop: 16 }}>
        <SkeletonText lines={3} />
      </div>
    </div>
  );
}
