import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShowMediaContext, ShowNsfwContext, useMediaReveal } from "./useMediaReveal";

function Probe({
  sensitiveWarningCount,
  hasMedia,
  hasThumbnail,
}: {
  sensitiveWarningCount: number;
  hasMedia: boolean;
  hasThumbnail: boolean;
}) {
  const { revealed, setRevealed, gate, hidden, thumbnailHidden } = useMediaReveal({
    sensitiveWarningCount,
    hasMedia,
    hasThumbnail,
  });
  return (
    <div>
      <output data-testid="state">{`${revealed}|${gate}|${hidden}|${thumbnailHidden}`}</output>
      <button type="button" onClick={() => setRevealed(true)}>
        reveal
      </button>
    </div>
  );
}

function Harness({
  showNsfw,
  showMedia,
  sensitiveWarningCount,
  hasMedia,
  hasThumbnail,
}: {
  showNsfw: boolean;
  showMedia: boolean;
  sensitiveWarningCount: number;
  hasMedia: boolean;
  hasThumbnail: boolean;
}) {
  return (
    <ShowNsfwContext.Provider value={showNsfw}>
      <ShowMediaContext.Provider value={showMedia}>
        <Probe sensitiveWarningCount={sensitiveWarningCount} hasMedia={hasMedia} hasThumbnail={hasThumbnail} />
      </ShowMediaContext.Provider>
    </ShowNsfwContext.Provider>
  );
}

describe("useMediaReveal (media-reveal gating decision)", () => {
  it("gates sensitive media behind the reveal warning when the NSFW preference is off", () => {
    render(<Harness showNsfw={false} showMedia={true} sensitiveWarningCount={1} hasMedia={true} hasThumbnail={false} />);
    expect(screen.getByTestId("state").textContent).toBe("false|true|false|false");
  });

  it("defaults the NSFW preference to hidden so sensitive media gates with no provider", () => {
    render(<Probe sensitiveWarningCount={1} hasMedia={true} hasThumbnail={false} />);
    expect(screen.getByTestId("state").textContent).toBe("false|true|false|false");
  });

  it("ungates sensitive media when the NSFW preference is on", () => {
    render(<Harness showNsfw={true} showMedia={true} sensitiveWarningCount={1} hasMedia={true} hasThumbnail={false} />);
    expect(screen.getByTestId("state").textContent).toBe("false|false|false|false");
  });

  it("never gates when there is no media", () => {
    render(<Harness showNsfw={false} showMedia={true} sensitiveWarningCount={1} hasMedia={false} hasThumbnail={false} />);
    expect(screen.getByTestId("state").textContent).toBe("false|false|false|false");
  });

  it("never gates when there are no sensitive labels", () => {
    render(<Harness showNsfw={false} showMedia={true} sensitiveWarningCount={0} hasMedia={true} hasThumbnail={false} />);
    expect(screen.getByTestId("state").textContent).toBe("false|false|false|false");
  });

  it("lets the sensitive gate take precedence over the show-media hide", () => {
    render(<Harness showNsfw={false} showMedia={false} sensitiveWarningCount={1} hasMedia={true} hasThumbnail={false} />);
    expect(screen.getByTestId("state").textContent).toBe("false|true|false|false");
  });

  it("hides media for the show-media setting when not sensitive", () => {
    render(<Harness showNsfw={false} showMedia={false} sensitiveWarningCount={0} hasMedia={true} hasThumbnail={false} />);
    expect(screen.getByTestId("state").textContent).toBe("false|false|true|false");
  });

  it("revealing clears both the gate and the hide", () => {
    render(<Harness showNsfw={false} showMedia={false} sensitiveWarningCount={1} hasMedia={true} hasThumbnail={false} />);
    fireEvent.click(screen.getByRole("button", { name: "reveal" }));
    expect(screen.getByTestId("state").textContent).toBe("true|false|false|false");
  });

  it("hides a link-card thumbnail for the show-media setting", () => {
    render(<Harness showNsfw={false} showMedia={false} sensitiveWarningCount={0} hasMedia={false} hasThumbnail={true} />);
    expect(screen.getByTestId("state").textContent).toBe("false|false|true|true");
  });

  it("keeps a link-card thumbnail visible when the show-media setting is on", () => {
    render(<Harness showNsfw={false} showMedia={true} sensitiveWarningCount={0} hasMedia={false} hasThumbnail={true} />);
    expect(screen.getByTestId("state").textContent).toBe("false|false|false|false");
  });
});
