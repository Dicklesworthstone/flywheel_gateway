import { Link } from "@tanstack/react-router";

export function NotFoundPage() {
  return (
    <div className="page">
      <div className="card card--wide">
        <h2>Page not found</h2>
        <p className="muted">
          The route you requested is not available yet. Return to the dashboard.
        </p>
        <Link to="/" className="primary-button">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
