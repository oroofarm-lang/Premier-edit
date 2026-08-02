/**
 * Builds the browser harness for the UXP panel into public/_panel/.
 *
 * The panel's own index.html is copied **verbatim** and the UXP stub
 * (_stub.js) is injected ahead of index.js, so the harness renders the real
 * markup rather than a description of it.
 *
 * This replaced a hand-maintained _harness.html that carried its own copy of
 * the whole body. Its comment claimed it was built from index.html so it
 * "cannot drift out of date" — it was not, and it had drifted: an element
 * added to index.html was simply absent, and inspecting the harness reported
 * that the element did not exist. A verification tool that can disagree with
 * the thing it verifies is worse than none.
 *
 * Run: npm run panel:preview
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SRC = "premiere-panel";
const OUT = path.join("public", "_panel");
/** Copied as-is; index.html is transformed, _stub.js is harness-only. */
const ASSETS = ["styles.css", "index.js", "state.js", "build-sequence.js", "_stub.js"];

const INJECT_BEFORE = '<script src="index.js"></script>';

async function main() {
  await mkdir(OUT, { recursive: true });

  const html = await readFile(path.join(SRC, "index.html"), "utf8");
  if (!html.includes(INJECT_BEFORE)) {
    throw new Error(
      `Could not find ${INJECT_BEFORE} in ${SRC}/index.html — the harness ` +
        `injects the UXP stub immediately before it. Update this script if ` +
        `the panel's script tag changed.`,
    );
  }

  // Before index.js, not after: index.js calls require("premierepro") while
  // it is being evaluated, so the stub has to already be installed.
  const harness = html.replace(
    INJECT_BEFORE,
    `<script src="_stub.js"></script>\n    ${INJECT_BEFORE}`,
  );

  await writeFile(path.join(OUT, "index.html"), harness);
  for (const asset of ASSETS) {
    await copyFile(path.join(SRC, asset), path.join(OUT, asset));
  }

  console.log(`Harness built from the real ${SRC}/index.html.`);
  console.log("open http://localhost:3002/_panel/index.html");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
