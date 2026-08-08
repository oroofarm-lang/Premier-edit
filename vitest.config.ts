import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // Sibling worktrees are whole checkouts of other branches. Without this
      // vitest walks into them, runs a second copy of every test under a
      // *different* branch's source, and reports the total as this branch's
      // result — 449 tests where there are 220. It also fails on whatever that
      // branch happens to have half-finished, which is not a fact about this
      // one. Each worktree runs its own suite from its own root.
      "**/.worktrees/**",
    ],
  },
});
