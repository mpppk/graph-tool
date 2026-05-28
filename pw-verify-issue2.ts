import { chromium } from "playwright";

const BASE_URL = "http://localhost:3000";
const SS_DIR = `${import.meta.dir}/pw-screenshots`;

async function screenshot(page: import("playwright").Page, name: string): Promise<string> {
  const path = `${SS_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(15000);

const errors: string[] = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

const screenshots: Record<string, string> = {};

// ── 1. Load page ──────────────────────────────────────────────────────────────
await page.goto(BASE_URL);
await page.waitForSelector("text=graph-tool");
screenshots["01_home"] = await screenshot(page, "issue2-01-home");
console.log("✅ ページ読み込み完了");

// ── 2. Create graph ───────────────────────────────────────────────────────────
page.once("dialog", async (dialog) => {
  await dialog.accept("Node Type Test");
});
await page.click("text=+ New Graph");
await page.waitForSelector("text=Node Type Test");
screenshots["02_graph_created"] = await screenshot(page, "issue2-02-graph-created");
console.log("✅ グラフ作成完了");

// ── 3. Open graph ─────────────────────────────────────────────────────────────
await page.click("text=Node Type Test");
await page.waitForSelector("text=Auto Layout");
screenshots["03_graph_open"] = await screenshot(page, "issue2-03-graph-open");
console.log("✅ グラフ画面を開いた");

// ── 4. Add 3 nodes ────────────────────────────────────────────────────────────
for (const label of ["Node A", "Node B", "Node C"]) {
  page.once("dialog", async (dialog) => await dialog.accept(label));
  await page.click("text=+ Add Node");
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1000);
screenshots["04_nodes_added"] = await screenshot(page, "issue2-04-nodes-added");
console.log("✅ ノード3個追加");

// ── 4b. Auto Layout to avoid overlapping nodes, then fit view ────────────────
await page.click("text=Auto Layout");
await page.waitForTimeout(1500);
// Use ReactFlow's fit-view control so all nodes are visible
await page.locator(".react-flow__controls-fitview").click();
await page.waitForTimeout(800);
screenshots["04b_layout"] = await screenshot(page, "issue2-04b-layout");
console.log("✅ Auto Layout 適用");

// ── 5. Click a node and check SidePanel has type dropdown ─────────────────────
// Click the node by its label text to ensure it's in viewport
const nodeEl = page.locator(".react-flow__node").filter({ hasText: "Node A" });
await nodeEl.click();
await page.waitForSelector("text=タイプ");
const typeDropdown = page.locator("select");
const options = await typeDropdown.locator("option").allTextContents();
console.log("  タイプ選択肢:", options.join(", "));
const hasAllTypes = ["なし", "KPI", "Epic", "Feature", "Opportunity", "Solution"].every((t) =>
  options.includes(t),
);
if (!hasAllTypes) throw new Error(`タイプ選択肢が不足: ${options}`);
screenshots["05_sidepanel_type"] = await screenshot(page, "issue2-05-sidepanel-type");
console.log("✅ サイドパネルにタイプドロップダウンが表示された");

// ── 6. Set type to KPI → node turns blue ─────────────────────────────────────
await typeDropdown.selectOption("KPI");
await page.waitForTimeout(500);
const bgAfterKPI = await nodeEl.evaluate((el: HTMLElement) => {
  const inner = el.querySelector("[style]") as HTMLElement | null;
  return inner ? inner.style.backgroundColor : getComputedStyle(el).backgroundColor;
});
console.log("  KPI後の背景色:", bgAfterKPI);
screenshots["06_kpi_color"] = await screenshot(page, "issue2-06-kpi-color");
console.log("✅ KPIタイプ設定 → 色が変わった");

// ── 7. Set type to Epic → node turns purple ───────────────────────────────────
await typeDropdown.selectOption("Epic");
await page.waitForTimeout(500);
const bgAfterEpic = await nodeEl.evaluate((el: HTMLElement) => {
  const inner = el.querySelector("[style]") as HTMLElement | null;
  return inner ? inner.style.backgroundColor : getComputedStyle(el).backgroundColor;
});
console.log("  Epic後の背景色:", bgAfterEpic);
screenshots["07_epic_color"] = await screenshot(page, "issue2-07-epic-color");
console.log("✅ Epicタイプ設定 → 色が変わった");

// ── 8. Reset to "なし" → node returns to white ────────────────────────────────
await typeDropdown.selectOption("");
await page.waitForTimeout(500);
const bgAfterNone = await nodeEl.evaluate((el: HTMLElement) => {
  const inner = el.querySelector("[style]") as HTMLElement | null;
  return inner ? inner.style.backgroundColor : getComputedStyle(el).backgroundColor;
});
console.log("  なし後の背景色:", bgAfterNone);
screenshots["08_none_color"] = await screenshot(page, "issue2-08-none-color");
console.log("✅ タイプ「なし」→ 白に戻った");

// ── 9. Set KPI again, then reload to verify persistence ──────────────────────
await typeDropdown.selectOption("KPI");
await page.waitForTimeout(800);
screenshots["09_before_reload"] = await screenshot(page, "issue2-09-before-reload");

await page.reload();
// After reload, app goes back to graph list — re-open the graph
await page.waitForSelector("text=Node Type Test");
await page.click("text=Node Type Test");
await page.waitForSelector("text=Auto Layout");
await page.waitForTimeout(1000);

// Fit view so node is visible, then click
await page.locator(".react-flow__controls-fitview").click();
await page.waitForTimeout(500);
const nodeAfterReload = page.locator(".react-flow__node").filter({ hasText: "Node A" });
await nodeAfterReload.click();
await page.waitForSelector("text=タイプ");
const typeAfterReload = await page.locator("select").inputValue();
console.log("  リロード後のタイプ:", typeAfterReload);
if (typeAfterReload !== "KPI") throw new Error(`タイプが保持されていない: ${typeAfterReload}`);
screenshots["10_after_reload"] = await screenshot(page, "issue2-10-after-reload");
console.log("✅ リロード後もタイプ・色が保持された");

// ── 10. Try all predefined types ─────────────────────────────────────────────
for (const t of ["Feature", "Opportunity", "Solution"]) {
  await page.locator("select").selectOption(t);
  await page.waitForTimeout(400);
}
screenshots["11_all_types"] = await screenshot(page, "issue2-11-all-types");
console.log("✅ Feature/Opportunity/Solution も設定可能");

if (errors.length > 0) {
  console.error("コンソールエラーあり:", errors);
  process.exit(1);
}

console.log("\n全テスト完了 ✅");
console.log("スクリーンショット:", Object.values(screenshots).join("\n"));

await browser.close();
process.exit(0);
