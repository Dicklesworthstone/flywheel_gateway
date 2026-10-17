/**
 * TextWidget markdown safety tests.
 */

import { describe, expect, it } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { render, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { Widget, WidgetData } from "@flywheel/shared";
import { TextWidget } from "../TextWidget";

try {
  GlobalRegistrator.register();
} catch {
  // Already registered by another test file
}

const widget: Widget = {
  id: "widget-1",
  type: "text",
  title: "Text",
  position: { x: 0, y: 0, w: 1, h: 1 },
  config: { dataSource: { type: "static" } },
};

function renderWithContent(content: string) {
  const data: WidgetData = {
    widgetId: widget.id,
    data: { content },
    fetchedAt: new Date().toISOString(),
  };
  return render(<TextWidget widget={widget} data={data} />);
}

describe("TextWidget", () => {
  it("blocks javascript: href links", () => {
    const { container } = renderWithContent("[click](javascript:owned)");
    const scoped = within(container);

    expect(scoped.getByText("click")).toBeInTheDocument();
    expect(scoped.queryByRole("link", { name: "click" })).toBeNull();
  });

  it("blocks data: href links", () => {
    const { container } = renderWithContent(
      "[click](data:text/html,<h1>owned</h1>)",
    );
    const scoped = within(container);

    expect(scoped.getByText("click")).toBeInTheDocument();
    expect(scoped.queryByRole("link", { name: "click" })).toBeNull();
  });

  it("allows https: links", () => {
    const { container } = renderWithContent(
      "[safe](https://example.com/path?x=1&y=2)",
    );
    const scoped = within(container);

    const link = scoped.getByRole("link", { name: "safe" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    const href = link.getAttribute("href");
    expect(href).toContain("https://example.com/path?x=1");
    expect(href).toContain("y=2");
  });

  it("wraps ordered lists in <ol>", () => {
    const { container } = renderWithContent("1. One\n2. Two");

    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol!.querySelectorAll("li")).toHaveLength(2);

    const scoped = within(ol as HTMLElement);
    expect(scoped.getByText("One")).toBeInTheDocument();
    expect(scoped.getByText("Two")).toBeInTheDocument();
  });
});
