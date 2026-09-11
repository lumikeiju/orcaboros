import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourcePicker } from "../../src/components/SourcePicker";
import { STOCK_SOURCE_FEED_DEFINITIONS } from "../../src/domain/source-feed";

describe("SourcePicker", () => {
  it("shows derived IDs before import and does not make a network request", () => {
    const onSelected = vi.fn();
    render(
      <SourcePicker
        definitions={STOCK_SOURCE_FEED_DEFINITIONS}
        selected={[]}
        onSelected={onSelected}
      />
    );
    const file = new File(["not a real archive"], "US-WA-KCM.zip", {
      type: "application/zip"
    });
    fireEvent.change(screen.getByLabelText("Select one or more ZIP archives"), {
      target: { files: [file] }
    });
    expect(onSelected).toHaveBeenCalledWith(
      [{ file, sourceFeedId: "US-WA-KCM" }],
      []
    );
  });
});
