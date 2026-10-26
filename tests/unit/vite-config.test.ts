import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import viteConfig from "../../vite.config";
import packageMetadata from "../../package.json";

describe("deployment base path", () => {
  it("keeps workflow Bun versions synchronized with package-manager metadata", () => {
    const expectedVersion = packageMetadata.packageManager.replace(
      /^bun@/u,
      ""
    );
    for (const workflow of ["ci", "promote"]) {
      const text = readFileSync(
        resolve(".github", "workflows", `${workflow}.yml`),
        "utf8"
      );
      expect(text.match(/bun-version: "([^"]+)"/u)?.[1]).toBe(expectedVersion);
    }
  });

  it("serves production previews under the same subpath as the build", async () => {
    if (typeof viteConfig !== "function") {
      throw new Error("Expected an environment-aware Vite configuration");
    }
    const build = await viteConfig({ command: "build", mode: "production" });
    const preview = await viteConfig({
      command: "serve",
      mode: "production",
      isPreview: true
    });
    const development = await viteConfig({
      command: "serve",
      mode: "development"
    });
    expect(build.base).toBe("/orcaboros/");
    expect(preview.base).toBe(build.base);
    expect(development.base).toBe("/");
  });
});
