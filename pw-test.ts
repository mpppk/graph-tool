import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const SS_DIR = "/home/user/graph-tool/pw-screenshots";
mkdirSync(SS_DIR, { recursive: true });

let stepIdx = 0;
function step(label: string) {
  stepIdx++;
  console.log(`[${stepIdx}] ${label}`);
}
function fail(label: string, err: unknown): never {
  console.error(`✗ FAIL: ${label}`, err);
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

// Capture console errors
const consoleErrors: string[] = [];
page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", err => consoleErrors.push(err.message));

// ── 1. ページ読み込み ────────────────────────────────────────────────────────
step("Load home page");
await page.goto(BASE, { waitUntil: "domcontentloaded" }).catch(e => fail("page load", e));
// React app が完全にレンダリングされるまで待つ（ボタン出現を待機）
await page.waitForSelector("button:has-text('+ New Graph')", { timeout: 15000 }).catch(e => fail("+ New Graph button not found", e));
await page.screenshot({ path: `${SS_DIR}/01-home.png` });
const title = await page.textContent("h1").catch(e => fail("h1 not found", e));
if (title !== "graph-tool") fail("title", `expected 'graph-tool', got '${title}'`);
console.log(`   title: "${title}" ✓`);

// ── 2. グラフ一覧（空） ──────────────────────────────────────────────────────
step("Graph list is empty");
const empty = await page.textContent("p").catch(() => "");
console.log(`   empty text: "${empty}" ✓`);

// ── 3. グラフを作成 ──────────────────────────────────────────────────────────
step("Create graph via dialog");
page.once("dialog", d => { console.log(`   dialog: "${d.message()}"`); d.accept("Test Graph"); });
await page.click("button:has-text('+ New Graph')");
await page.waitForSelector("text=Test Graph", { timeout: 8000 }).catch(e => fail("graph not created", e));
await page.screenshot({ path: `${SS_DIR}/02-graph-created.png` });
console.log(`   graph 'Test Graph' visible ✓`);

// ── 4. GraphView へ遷移 ──────────────────────────────────────────────────────
step("Open GraphView by clicking graph name");
await page.click("text=Test Graph");
await page.waitForSelector(".react-flow", { timeout: 5000 }).catch(e => fail("ReactFlow canvas not found", e));
await page.screenshot({ path: `${SS_DIR}/03-graph-view.png` });
console.log(`   ReactFlow canvas visible ✓`);

// header にグラフ名があることを確認
const header = await page.locator("header").textContent();
if (!header?.includes("Test Graph")) fail("GraphView header", `'Test Graph' not in header: ${header}`);
console.log(`   header shows 'Test Graph' ✓`);

// ── 5. ノードを追加 ──────────────────────────────────────────────────────────
step("Add Node via dialog");
page.once("dialog", d => { console.log(`   dialog: "${d.message()}"`); d.accept("Node A"); });
await page.click("button:has-text('+ Add Node')");
await page.waitForTimeout(1000);
await page.screenshot({ path: `${SS_DIR}/04-node-added.png` });

// React Flow のノードが存在するか
const nodeCount = await page.locator(".react-flow__node").count();
console.log(`   nodes in canvas: ${nodeCount} ✓`);
if (nodeCount === 0) fail("node not rendered", "no .react-flow__node found");

// ── 6. 2つ目のノードを追加 ──────────────────────────────────────────────────
step("Add second node");
page.once("dialog", d => d.accept("Node B"));
await page.click("button:has-text('+ Add Node')");
await page.waitForTimeout(1000);
const nodeCount2 = await page.locator(".react-flow__node").count();
console.log(`   nodes in canvas: ${nodeCount2} ✓`);

// ── 7. Auto Layout ──────────────────────────────────────────────────────────
step("Click Auto Layout");
await page.click("button:has-text('Auto Layout')");
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SS_DIR}/05-auto-layout.png` });
console.log(`   Auto Layout completed ✓`);

// ── 8. Back ボタン ───────────────────────────────────────────────────────────
step("Navigate back to GraphList");
await page.click("button:has-text('← Back')");
await page.waitForSelector("h2:has-text('Graphs')", { timeout: 3000 }).catch(e => fail("back navigation", e));
await page.screenshot({ path: `${SS_DIR}/06-back-to-list.png` });
console.log(`   back to GraphList ✓`);

// ── コンソールエラー確認 ─────────────────────────────────────────────────────
step("Check for console errors");
if (consoleErrors.length > 0) {
  console.warn(`   ⚠ ${consoleErrors.length} console error(s):`);
  for (const e of consoleErrors) console.warn(`     ${e}`);
} else {
  console.log(`   no console errors ✓`);
}

await browser.close();
console.log("\n✅ All checks passed");
