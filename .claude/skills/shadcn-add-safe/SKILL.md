---
name: shadcn-add-safe
description: Use this whenever adding, regenerating, or upgrading a shadcn/ui component in the Premier Edit project (running "npx shadcn add" for a component, or the user asks to "add a shadcn component" / "add a UI component" / mentions a specific shadcn component by name like button, dialog, or dropdown-menu). This project pins Tailwind v3 + Radix UI, but the shadcn CLI's current defaults assume Tailwind v4 + Base UI — running "add" naively has broken the build three separate times already. Always use this skill instead of running the bare command and hoping.
---

# Adding a shadcn/ui component safely

## Why this exists

Premier Edit is intentionally pinned to **Tailwind v3** (`tailwind.config.ts` + `@tailwind` directives) and **Radix UI** primitives (`components.json` → `"style": "radix-nova"`). The `npx shadcn@latest` CLI's newest component templates assume Tailwind v4 and the newer Base UI library instead. That mismatch has caused three real build failures already in this project (see [CLAUDE.md](../../../CLAUDE.md) and `Volt/Tech Stack.md`):

1. Generated classes referencing colors that don't exist in this project's palette (e.g. `border-border`)
2. Opacity-modifier classes (e.g. `outline-ring/50`) silently failing because a CSS variable isn't wrapped correctly for Tailwind v3
3. Imports from `@base-ui/react` instead of `radix-ui`

`components.json` already has `"style": "radix-nova"` set, so a plain `npx shadcn@latest add <component>` *should* inherit the Radix base without needing extra flags — but always verify the output rather than assuming, since CLI defaults have changed before.

## Steps

1. **Run the add command** for the requested component(s):
   ```
   npx shadcn@latest add <component>
   ```

2. **Check for Base UI leakage.** Grep the newly added/changed file(s) in `components/ui/`:
   ```
   grep -rn "@base-ui" components/ui/<new-file>.tsx
   ```
   If this matches anything, the CLI ignored the Radix base — re-run with `npx shadcn@latest add <component> --base radix` instead, or fix the import to use `radix-ui` directly if it's a small change.

3. **Check every color/CSS-variable class the new component uses** against the palette already defined in [tailwind.config.ts](../../../tailwind.config.ts). The known-good set is: `background`, `foreground`, `card`(+foreground), `popover`(+foreground), `primary`(+foreground), `secondary`(+foreground), `muted`(+foreground), `accent`(+foreground), `destructive`(+foreground), `border`, `input`, `ring`, `chart-1..5`, `sidebar` (+foreground/primary/accent/border/ring variants).

   If the component references a color class **not** in that list (e.g. a new `--radius-md`-style variable, or a color shadcn just introduced upstream):
   - Add the raw decomposed OKLCH triple to both the `:root` and `.dark` blocks in [app/globals.css](../../../app/globals.css), matching the existing style (e.g. `--new-color: 0.708 0 0;` — **no** `oklch(...)` wrapper, just the three components).
   - Add the matching entry to `tailwind.config.ts`'s `theme.extend.colors`, wrapped with the existing `oklchVar("--new-color")` helper — never a plain `var(--x)` mapping, or `/NN` opacity modifiers on that class will silently break.

4. **Check for other Tailwind v4-only syntax** that has no effect under v3 (usually harmless visually but worth knowing about): `size-*` utilities, `in-data-*` variants, `--radius-md`/`--radius-lg`/`--radius-xl` scale tokens (this project only defines `--radius` → `lg`/`md`/`sm`). These won't break the build, but flag them to the user rather than silently ignoring — they mean the component may not look exactly like its shadcn demo.

5. **Verify the build.** Run `npm run build` (or start the dev server and load a page using the new component) before calling the task done. A missing color class is a silent visual bug, not a build error — actually opening the component in the browser is the only reliable check for that class of problem.

6. **Report back** — which component(s) were added, whether anything needed fixing (new CSS variables added, Base UI swapped to Radix), and confirmation the build/dev-server is clean.
