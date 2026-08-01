import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DevInspector } from "./DevInspector";

const activeSource = {
  id: "following",
  label: "Following",
  uri: "at://app.bsky.feed.generator/following",
  group: "Core",
  description: "Posts from people you follow.",
} as const;

const renderInspector = (overrides?: Partial<Parameters<typeof DevInspector>[0]>) =>
  render(
    <DevInspector
      activeSource={activeSource}
      apiRequests={12}
      cacheHits={7}
      loadedPages={3}
      renderedRows={42}
      route={{ kind: "feed" }}
      runtimeWarnings={[]}
      sameOriginRequests={5}
      serviceWorkerState="active"
      {...overrides}
    />,
  );

describe("DevInspector", () => {
  it("renders the panel title and metric rows", () => {
    renderInspector();
    expect(screen.getByRole("heading", { name: "Dev Inspector" })).toBeTruthy();
    expect(screen.getByText("Source")).toBeTruthy();
    expect(screen.getByText("Pages")).toBeTruthy();
    expect(screen.getByText("Rows")).toBeTruthy();
    expect(screen.getByText("API requests")).toBeTruthy();
    expect(screen.getByText("Cache hits")).toBeTruthy();
    expect(screen.getByText("Static assets")).toBeTruthy();
    expect(screen.getByText("Service worker")).toBeTruthy();
    expect(screen.getByText("Runtime routes")).toBeTruthy();
  });

  it("labels the source from the active feed's label when on a feed route", () => {
    renderInspector({ route: { kind: "feed" } });
    expect(screen.getByText("Following")).toBeTruthy();
  });

  it("uses the route kind as the source label on non-feed routes", () => {
    renderInspector({ route: { kind: "search", query: "x" } });
    expect(screen.getByText("search")).toBeTruthy();
  });

  it("formats the numeric metrics and joins runtime warnings", () => {
    renderInspector({ runtimeWarnings: ["/api/route", "_worker.js"] });
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("/api/route, _worker.js")).toBeTruthy();
  });

  it("shows 'None detected' when there are no runtime warnings", () => {
    renderInspector();
    expect(screen.getByText("None detected")).toBeTruthy();
  });
});
