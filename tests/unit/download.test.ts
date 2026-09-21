import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadTextFile } from "../../src/infrastructure/browser/download";

const nativeCreateObjectURL = URL.createObjectURL;
const nativeRevokeObjectURL = URL.revokeObjectURL;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
  if (nativeCreateObjectURL === undefined) {
    Reflect.deleteProperty(URL, "createObjectURL");
  } else {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: nativeCreateObjectURL
    });
  }
  if (nativeRevokeObjectURL === undefined) {
    Reflect.deleteProperty(URL, "revokeObjectURL");
  } else {
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: nativeRevokeObjectURL
    });
  }
});

describe("browser downloads", () => {
  it("clicks the download link before revoking its object URL", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:orcaboros");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL
    });
    let clickedDownload = "";
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(document.body.contains(this)).toBe(true);
        clickedDownload = this.download;
      });

    downloadTextFile("<osm/>", "orcaboros.osm", "application/xml");

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(clickedDownload).toBe("orcaboros.osm");
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:orcaboros");
  });
});
