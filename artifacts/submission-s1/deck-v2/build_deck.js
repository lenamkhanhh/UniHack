// MissionPay pitch deck generator (v2).
// Run from repo root:  PPTX_SKILL=<pptx skill dir> NODE_PATH=.cache/deck-node/node_modules node artifacts/submission-s1/deck-v2/build_deck.js
// Deps live in .cache/deck-node (gitignored): pptxgenjs react-icons react react-dom sharp
const path = require("path");
const fs = require("fs");
const ROOT = path.resolve(__dirname, "../../..");
const NM = path.join(ROOT, ".cache/deck-node/node_modules");
const req = (m) => require(path.join(NM, m));
const pptxgen = req("pptxgenjs");
const React = req("react");
const { renderToStaticMarkup } = req("react-dom/server");
const sharp = req("sharp");
const fa = req("react-icons/fa");

const OUT = path.join(ROOT, "artifacts/submission-s1/MissionPay-pitch-deck-v2.pptx");
const SHOTS = path.join(ROOT, "artifacts/submission-s1/deck-shots");
const EVID = path.join(ROOT, "apps/web/evidence");

// ---------- Theme ----------
const THEME = {
  name: "MissionPay Console",
  headFontFace: "Arial",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "0B1220", // page background
    lt1: "F1F5F9", // primary text on dark
    dk2: "131D33", // card fill
    lt2: "94A3B8", // muted text
    accent1: "E84142", // Avalanche red: attacks, danger
    accent2: "10B981", // green: blocked / $0.00 safe
    accent3: "F59E0B", // amber: pending / simulation labels
    accent4: "38BDF8", // sky: links, data
    accent5: "26324D", // card border
    accent6: "64748B", // slate
    hlink: "38BDF8",
    folHlink: "94A3B8",
  },
};
const HEX = THEME.colors;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
pres.title = "MissionPay — LLMs can be fooled. Budgets on Avalanche can't.";
pres.author = "MissionPay team";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;
const TXT = C.background1; // light text on dark slides
const MUTED = C.background2;
const CARD = C.text2;
const BORDER = C.accent5;
const RED = C.accent1, GREEN = C.accent2, AMBER = C.accent3, SKY = C.accent4;

const W = 13.333, H = 7.5, MX = 0.6;

// ---------- Layouts ----------
pres.defineSlideMaster({
  title: "MP_TITLE",
  background: { color: C.text1 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: MX, y: 2.2, w: W - 2 * MX, h: 1.4, fontSize: 60, bold: true, color: TXT, fontFace: "Arial", valign: "middle", align: "left", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: MX, y: 3.7, w: W - 2 * MX, h: 1.0, fontSize: 28, color: TXT, valign: "top", align: "left", margin: 0 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "MP_CONTENT",
  background: { color: C.text1 },
  margin: [0.5, 0.6, 0.6, 0.6],
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: MX, y: 0.4, w: W - 2 * MX, h: 0.85, fontSize: 32, bold: true, color: TXT, fontFace: "Arial", valign: "middle", align: "left", margin: 0 }, text: "" } },
    { text: { text: "MissionPay · Avalanche Team1 Vietnam UniHack 2026", options: { x: MX, y: H - 0.45, w: 7, h: 0.3, fontSize: 10, color: MUTED, margin: 0 } } },
  ],
  slideNumber: { x: W - MX - 0.6, y: H - 0.45, w: 0.6, h: 0.3, fontSize: 10, color: MUTED, align: "right" },
});

// ---------- Helpers ----------
async function icon(Comp, hex, px = 256) {
  const svg = renderToStaticMarkup(React.createElement(Comp, { color: "#" + hex, size: px }));
  const buf = await sharp(Buffer.from(svg)).resize(px, px).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

function card(slide, x, y, w, h, name, fill = CARD) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.12, fill: { color: fill }, line: { color: BORDER, width: 0.75 }, objectName: name,
  });
}

async function iconDot(slide, Comp, hex, x, y, d, name) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: CARD }, line: { color: hex === HEX.accent2 ? GREEN : hex === HEX.accent1 ? RED : hex === HEX.accent3 ? AMBER : SKY, width: 1.25 }, objectName: name + " circle" });
  const pad = d * 0.25;
  slide.addImage({ data: await icon(Comp, hex), x: x + pad, y: y + pad, w: d - 2 * pad, h: d - 2 * pad, altText: name, objectName: name + " icon" });
}

function pickShot(deckName, fallback) {
  const a = path.join(SHOTS, deckName);
  if (fs.existsSync(a)) return a;
  return path.join(EVID, fallback);
}

// Fit an image inside a box, keep aspect ratio, add a thin frame.
// deck-shots are 1920x1080 pages whose content sits in the middle column:
// crop the side gutters and the nav bar so the UI reads larger on the slide.
async function shot(slide, file, x, y, w, h, alt, name) {
  let img = sharp(file);
  const meta = await img.metadata();
  if (file.startsWith(SHOTS) && meta.width === 1920 && meta.height === 1080) {
    img = img.extract({ left: 330, top: 62, width: 1260, height: 1018 });
  }
  const buf = await img.png().toBuffer();
  const m2 = await sharp(buf).metadata();
  const r = m2.width / m2.height;
  let iw = w, ih = w / r;
  if (ih > h) { ih = h; iw = h * r; }
  const ix = x + (w - iw) / 2, iy = y + (h - ih) / 2;
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: ix - 0.06, y: iy - 0.06, w: iw + 0.12, h: ih + 0.12, rectRadius: 0.08, fill: { color: CARD }, line: { color: BORDER, width: 0.75 }, objectName: name + " frame" });
  slide.addImage({ data: "image/png;base64," + buf.toString("base64"), x: ix, y: iy, w: iw, h: ih, altText: alt, objectName: name });
  return { ix, iy, iw, ih };
}

function T(slide, text, opts) {
  slide.addText(text, Object.assign({ isTextBox: true, margin: 0, color: TXT, fontSize: 16, valign: "top" }, opts));
}

async function main() {
  // ===== 1. Title =====
  pres.addSection({ title: "Opening" });
  let s = pres.addSlide({ masterName: "MP_TITLE", sectionTitle: "Opening" });
  await iconDot(s, fa.FaShieldAlt, HEX.accent2, MX, 1.1, 0.85, "MissionPay shield");
  s.addText("MissionPay", { placeholder: "title" });
  s.addText([
    { text: "LLMs can be fooled. ", options: { color: TXT } },
    { text: "Budgets on Avalanche can't.", options: { color: RED, bold: true } },
  ], { placeholder: "body" });
  T(s, "Give your AI agent a mission and a budget. Avalanche makes sure it can't overspend, and shows you every cent.", { x: MX, y: 4.85, w: 9.5, h: 0.8, fontSize: 18, color: MUTED, objectName: "subtitle" });
  T(s, "Avalanche Team1 Vietnam UniHack 2026", { x: MX, y: H - 0.9, w: 8, h: 0.35, fontSize: 14, color: MUTED, objectName: "event" });
  s.addNotes("Mở đầu 10 giây. Nói câu chốt trước: LLM có thể bị lừa, ngân sách trên Avalanche thì không. Không giới thiệu stack ở đây.");

  // ===== 2. Hook: Bankr =====
  pres.addSection({ title: "Problem" });
  s = pres.addSlide({ masterName: "MP_CONTENT", sectionTitle: "Problem" });
  s.addText("May 2026: one line of Morse code moved $174,000", { placeholder: "title" });
  T(s, "$174,000", { x: MX, y: 1.6, w: 6.6, h: 1.5, fontSize: 96, bold: true, color: RED, fontFace: "Arial", objectName: "big stat" });
  T(s, "drained from a Grok-linked Bankr wallet on Base. The attacker hid an instruction in Morse code; the AI decoded it and the wallet obeyed.", { x: MX, y: 3.2, w: 6.2, h: 1.2, fontSize: 18, color: TXT, objectName: "stat caption" });
  const facts = [
    [fa.FaKey, "No private key was stolen"],
    [fa.FaFileContract, "No smart contract was exploited"],
    [fa.FaRobot, "The model was persuaded, and the money followed"],
  ];
  for (let i = 0; i < facts.length; i++) {
    const y = 1.75 + i * 1.05;
    card(s, 7.4, y, 5.33, 0.85, "fact card " + (i + 1));
    await iconDot(s, facts[i][0], HEX.accent1, 7.6, y + 0.14, 0.57, "fact icon " + (i + 1));
    T(s, facts[i][1], { x: 8.35, y: y + 0.12, w: 4.25, h: 0.6, fontSize: 17, bold: true, valign: "middle", objectName: "fact text " + (i + 1) });
  }
  card(s, 7.4, 4.95, 5.33, 1.25, "freysa card");
  T(s, [
    { text: "Not a one-off. ", options: { bold: true, color: AMBER } },
    { text: "Jul 2026: hidden web text made 4 of 26 models pay a scammer (Zscaler). Oct 2026: 9 of 10 models raised their own spending caps (Cornell/Yale).", options: { color: TXT } },
  ], { x: 7.6, y: 5.05, w: 4.95, h: 1.05, fontSize: 14, valign: "middle", objectName: "freysa text" });
  T(s, "Sources: Cointelegraph Magazine (May 13, 2026); OECD.AI incident 2026-05-04; MetaMask Security Report May 2026; Zscaler ThreatLabz (Jul 2026); CoinDesk (Nov 1, 2026). Reported loss ranges from $155k to $204k by source.", { x: MX, y: 6.35, w: W - 2 * MX, h: 0.5, fontSize: 10, color: MUTED, objectName: "sources" });
  s.addNotes("Hook trong 20 giây. Nhấn mạnh: không lộ key, không hack contract. Agent chỉ ĐỌC một bài đăng. Zscaler và Cornell cho thấy đây là quy luật, và còn rất mới: tuần trước 9/10 model tự nâng hạn mức của chính nó.");

  // ===== 3. Why filters fail (ADI research) =====
  s = pres.addSlide({ masterName: "MP_CONTENT", sectionTitle: "Problem" });
  s.addText("The new attacks plant data, not instructions", { placeholder: "title" });
  const adi = [
    ["0 / 108", "attacks flagged by Llama Prompt Guard 2, a prompt-injection filter", RED],
    ["23%", "still succeed against CaMeL, Google DeepMind's design-level defense", AMBER],
    ["22%", "still succeed against Progent's tool-permission policies", AMBER],
  ];
  for (let i = 0; i < 3; i++) {
    const y = 1.55 + i * 1.5;
    card(s, MX, y, 5.6, 1.3, "adi stat card " + (i + 1));
    T(s, adi[i][0], { x: MX + 0.25, y: y + 0.1, w: 2.2, h: 1.1, fontSize: 40, bold: true, color: adi[i][2], valign: "middle", objectName: "adi stat " + (i + 1) });
    T(s, adi[i][1], { x: MX + 2.5, y: y + 0.1, w: 2.95, h: 1.1, fontSize: 14, color: TXT, valign: "middle", objectName: "adi label " + (i + 1) });
  }
  const rx = MX + 6.0, rw = W - MX - rx;
  card(s, rx, 1.55, rw, 4.3, "adi explainer card");
  T(s, [
    { text: "What changed. ", options: { bold: true, color: AMBER } },
    { text: "The attacker no longer tells the agent to do something wrong. A search result just carries a fake \"recipient\" field. The agent reads the wrong address and pays it.", options: { color: TXT, breakLine: true } },
    { text: " ", options: { breakLine: true } },
    { text: "What the researchers say works. ", options: { bold: true, color: AMBER } },
    { text: "A strict policy at the moment of action. For most tools that policy is hard to write.", options: { color: TXT, breakLine: true } },
    { text: " ", options: { breakLine: true } },
    { text: "Payments are the exception. ", options: { bold: true, color: GREEN } },
    { text: "The owner already knows who they pay.", options: { color: TXT } },
  ], { x: rx + 0.3, y: 1.75, w: rw - 0.6, h: 3.95, fontSize: 19, valign: "top", objectName: "adi explainer" });
  T(s, "So MissionPay puts that list on Avalanche and checks where every address came from.", { x: MX, y: 6.05, w: W - 2 * MX, h: 0.45, fontSize: 18, italic: true, color: AMBER, objectName: "adi takeaway" });
  T(s, "Source: Choi et al., \"Agent Data Injection Attacks are Realistic Threats to AI Agents\", arXiv 2607.05120 (Seoul National University / UIUC, Jul 2026). AgentDojo with GPT-5.2; baseline 49.1% attack success.", { x: MX, y: 6.5, w: W - 2 * MX, h: 0.4, fontSize: 10, color: MUTED, objectName: "adi source" });
  s.addNotes("30 giây. Đây là slide 'vì sao giờ'. Nói: đòn mới không ra lệnh, mà cài dữ liệu, ví dụ một trường recipient giả trong kết quả tìm kiếm. Filter bắt được 0 trên 108. Cả CaMeL của DeepMind cũng còn lọt 23%. Chính paper nói: phải có policy chặt ở chỗ hành động, mà policy đó khó viết. Với thanh toán thì dễ: owner biết mình trả cho ai. Chuyển sang slide sau.");

  // ===== 4. Insight =====
  s = pres.addSlide({ masterName: "MP_CONTENT", sectionTitle: "Problem" });
  s.addText("Caps stop how much. They don't stop who", { placeholder: "title" });
  const colW = 5.85, gx = MX, gx2 = MX + colW + 0.43;
  card(s, gx, 1.55, colW, 4.55, "today column");
  card(s, gx2, 1.55, colW, 4.55, "missionpay column");
  await iconDot(s, fa.FaExclamationTriangle, HEX.accent1, gx + 0.35, 1.8, 0.6, "today icon");
  T(s, "Caps-only agent wallets", { x: gx + 1.1, y: 1.85, w: 4.5, h: 0.5, fontSize: 22, bold: true, valign: "middle", objectName: "today title" });
  await iconDot(s, fa.FaShieldAlt, HEX.accent2, gx2 + 0.35, 1.8, 0.6, "mp icon");
  T(s, "MissionPay", { x: gx2 + 1.1, y: 1.85, w: 4.5, h: 0.5, fontSize: 22, bold: true, valign: "middle", objectName: "mp title" });
  const rowsL = [
    ["How much", "Capped, often on-chain. Kite, Polygon, Safe, Coinbase, AgentGuard402 all do this"],
    ["Who", "A static allowlist. Nothing checks where an address came from"],
    ["Rule changes", "Often an app login or emailed code the agent can reach"],
  ];
  const rowsR = [
    ["How much", "Same caps, per mission, enforced in GuardedTreasury.sol"],
    ["Who", "Each payee must trace to the owner's signature (Merkle root on-chain); web or tool-output addresses are blocked"],
    ["Rule changes", "Only the owner's wallet signature. The agent has no path"],
  ];
  for (let i = 0; i < 3; i++) {
    const y = 2.75 + i * 1.08;
    T(s, rowsL[i][0], { x: gx + 0.35, y, w: 1.2, h: 0.9, fontSize: 15, bold: true, color: RED, objectName: "today label " + i });
    T(s, rowsL[i][1], { x: gx + 1.6, y, w: 3.95, h: 0.95, fontSize: 15, color: TXT, objectName: "today row " + i });
    T(s, rowsR[i][0], { x: gx2 + 0.35, y, w: 1.2, h: 0.9, fontSize: 15, bold: true, color: GREEN, objectName: "mp label " + i });
    T(s, rowsR[i][1], { x: gx2 + 1.6, y, w: 3.95, h: 0.95, fontSize: 15, color: TXT, objectName: "mp row " + i });
  }
  T(s, "We don't claim caps. We claim provenance: money goes only where the owner said, never where a web page said.", { x: MX, y: 6.3, w: W - 2 * MX, h: 0.45, fontSize: 18, italic: true, color: AMBER, objectName: "takeaway" });
  s.addNotes("Nói thẳng: cap thì ai cũng có (kể cả Kite, AgentGuard402 trên Avalanche). Điểm khác là nguồn gốc người nhận: địa chỉ phải truy về chữ ký owner, không phải trang web hay model.");

  // ===== 4. How it works =====
  pres.addSection({ title: "Product" });
  s = pres.addSlide({ masterName: "MP_CONTENT", sectionTitle: "Product" });
  s.addText("Mission → Budget → Proof", { placeholder: "title" });
  const steps = [
    [fa.FaFileSignature, "1  Mission", "The owner signs a mission (a goal, a $10 cap, a $5 tool cap, an expiry) with a wallet, or with Face ID / a fingerprint checked on-chain by Avalanche's P-256 precompile. The backend never holds the owner's key."],
    [fa.FaWallet, "2  Budget", "The agent gets its own session wallet for this mission only. It buys tools with gasless USDC over x402. Before money moves, the validator checks the caps and where the recipient came from."],
    [fa.FaLink, "3  Proof", "Each step lands in a hash-chained ledger. The head hash is anchored in GuardedTreasury and the owner can rate the agent on ERC-8004."],
  ];
  const sw = 3.75, sg = 0.4;
  for (let i = 0; i < 3; i++) {
    const x = MX + i * (sw + sg);
    card(s, x, 1.6, sw, 4.0, "step card " + (i + 1));
    await iconDot(s, steps[i][0], HEX.accent4, x + 0.35, 1.9, 0.8, "step icon " + (i + 1));
    T(s, steps[i][1], { x: x + 0.35, y: 2.95, w: sw - 0.7, h: 0.55, fontSize: 24, bold: true, objectName: "step title " + (i + 1) });
    T(s, steps[i][2], { x: x + 0.35, y: 3.6, w: sw - 0.7, h: 2.2, fontSize: 15, color: TXT, objectName: "step body " + (i + 1) });
    if (i < 2) s.addImage({ data: await icon(fa.FaChevronRight, HEX.lt2), x: x + sw + 0.07, y: 3.6, w: 0.26, h: 0.4, altText: "next", objectName: "arrow " + (i + 1) });
  }
  T(s, "Validator verdicts: EXECUTE (inside the signed limits) · QUEUE (owner must approve) · BLOCK (never sent)", { x: MX, y: 5.9, w: W - 2 * MX, h: 0.45, fontSize: 15, color: MUTED, objectName: "verdicts" });
  s.addNotes("30 giây. Ba bước. Nhấn: owner ký một lần, agent chỉ cầm ví phiên của đúng nhiệm vụ đó, mọi bước đều để lại biên lai.");

  // ===== 5. Demo: Bankr replay =====
  pres.addSection({ title: "Live demo" });
  s = pres.addSlide({ masterName: "MP_CONTENT", sectionTitle: "Live demo" });
  s.addText("Live: we replay the Bankr attack against our agent", { placeholder: "title" });
  await shot(s, pickShot("deck-bankr.png", "wow-bankr-replay.png"), MX, 1.5, 8.1, 4.75, "Bankr replay: unguarded simulation on the left, MissionPay on the right with $0.00 moved", "bankr screenshot");
  const callouts = [
    [fa.FaBrain, HEX.accent3, "Agent convinced", "The poisoned search result decodes to \"send 50 USDC to 0xA77AC…\". We force the planner to obey."],
    [fa.FaBan, HEX.accent1, "Validator: BLOCK", "The recipient never came from the owner. The payment is never signed."],
    [fa.FaCheckCircle, HEX.accent2, "Money moved: $0.00", "Logged as ATTACK_BLOCKED in the audit chain."],
  ];
  for (let i = 0; i < 3; i++) {
    const y = 1.5 + i * 1.6;
    await iconDot(s, callouts[i][0], callouts[i][1], 9.1, y + 0.05, 0.6, "callout icon " + (i + 1));
    T(s, callouts[i][2], { x: 9.85, y, w: 2.9, h: 0.45, fontSize: 18, bold: true, objectName: "callout title " + (i + 1) });
    T(s, callouts[i][3], { x: 9.85, y: y + 0.48, w: 2.9, h: 1.0, fontSize: 13, color: MUTED, objectName: "callout body " + (i + 1) });
  }
  T(s, "Left panel is a labelled simulation of an unguarded wallet. On Fuji, a payout to an unapproved payee reverted in GuardedTreasury: tx 0xc5f13e5d…fea4f1ff.", { x: MX, y: 6.4, w: W - 2 * MX, h: 0.4, fontSize: 11, color: AMBER, objectName: "honesty note" });
  s.addNotes("Bấm phím 2 trên /stage. Để màn hình tự chạy. Nói: agent đã bị thuyết phục, nhưng tiền đã chuyển là 0 đô. Không đọc slide.");

  // ===== 6. Bounty: Hack the Treasury =====
  s = pres.addSlide({ masterName: "MP_CONTENT", sectionTitle: "Live demo" });
  s.addText("Your turn: 5 USDC sits on Fuji. Make the agent pay you", { placeholder: "title" });
  await shot(s, path.join(SHOTS, "deck-bounty-tricked.png"), 4.95, 1.5, 7.78, 4.55, "Bounty page: Gemini was fooled into paying vendor 0x3333, the validator blocked it with PAYEE_NOT_IN_MISSION_SET, and the Fuji contract reverted with PayeeNotInMissionSet", "bounty screenshot");
  const layers = [
    [fa.FaBrain, HEX.accent3, "1  The LLM", "Real Gemini 3.5 Flash-Lite reads your invoice, email or web page. It can be fooled, and the page says so when it is."],
    [fa.FaBan, HEX.accent1, "2  The validator", "Blocks any payee outside the owner-signed set: PAYEE_NOT_IN_MISSION_SET."],
    [fa.FaCubes, HEX.accent2, "3  The contract", "We replay the payout against GuardedTreasury on Fuji (eth_call): it reverts PayeeNotInMissionSet."],
  ];
  for (let i = 0; i < 3; i++) {
    const y = 1.5 + i * 1.45;
    card(s, MX, y, 4.1, 1.3, "layer card " + (i + 1));
    await iconDot(s, layers[i][0], layers[i][1], MX + 0.2, y + 0.2, 0.55, "layer icon " + (i + 1));
    T(s, layers[i][2], { x: MX + 0.9, y: y + 0.12, w: 3.1, h: 0.4, fontSize: 16, bold: true, objectName: "layer title " + (i + 1) });
    T(s, layers[i][3], { x: MX + 0.9, y: y + 0.52, w: 3.1, h: 0.75, fontSize: 11.5, color: TXT, objectName: "layer body " + (i + 1) });
  }
  T(s, "Shown: a real run where Gemini was fooled into paying 0x3333 (a company vendor outside this mission). The bounty agent uses a typical accounting prompt; with a stricter prompt it refused all 5 sample attacks. Prize is Fuji testnet USDC; the counters on /bounty read missionSpent from the chain.", { x: MX, y: 6.2, w: W - 2 * MX, h: 0.6, fontSize: 10.5, color: AMBER, objectName: "bounty note" });
  s.addNotes("Mở QR /bounty (QR có sau khi deploy public). Nói: ngân sách 5 USDC thật trên Fuji, ai lừa được agent trả cho ví mình thì lấy. Ba tầng: LLM có thể bị lừa, validator chặn payee ngoài tập owner ký, contract trên Fuji revert. Trung thực: prompt agent là prompt kế toán thông thường; prompt chặt hơn thì Gemini từ chối 5/5. Cuối bài đọc số lượt thử và số tiền ra ngoài trên màn hình (đọc từ chain).");

  // ===== 7. Defense in depth =====
  pres.addSection({ title: "Why it holds" });
  s = pres.addSlide({ masterName: "MP_CONTENT", sectionTitle: "Why it holds" });
  s.addText("Every failure has a ceiling the owner signed", { placeholder: "title" });
  const head = (t) => ({ text: t, options: { bold: true, color: TXT, fill: { color: CARD }, fontSize: 15 } });
  const cell = (t, color = TXT, bold = false) => ({ text: t, options: { color, bold, fontSize: 14 } });
  const rows = [
    [head("What goes wrong"), head("What stops it"), head("Worst case")],
    [cell("Prompt injection: the LLM is fully fooled"), cell("Validator blocks unapproved payees and amounts over the caps"), cell("$0 outside the mission's rules", GREEN, true)],
    [cell("A web page plants a payee inside the budget"), cell("Provenance rule: payees must come from the owner-signed set; web or tool-output addresses are blocked"), cell("$0 to unapproved payees", GREEN, true)],
    [cell("Agent key leaks"), cell("The key only controls this mission's session wallet"), cell("That wallet's balance, at most the $5 tool cap", AMBER, true)],
    [cell("Our server is compromised"), cell("GuardedTreasury.sol needs a Merkle proof for an owner-signed payee and enforces the mission cap; we hold no owner key"), cell("Only owner-approved payees, up to the mission cap", AMBER, true)],
    [cell("Seller charges more than its listed price"), cell("Price guard compares the 402 quote with the catalog before signing"), cell("$0 overcharge", GREEN, true)],
    [cell("A paid x402 request is swapped or replayed"), cell("The payment signature is bound to the exact request, and a nonce settles once (fixes from the ATC '26 x402 study)"), cell("$0 extra", GREEN, true)],
  ];
  s.addTable(rows, { x: MX, y: 1.55, w: W - 2 * MX, colW: [3.6, 5.6, 2.93], fontFace: "Calibri", border: { type: "solid", color: HEX.accent5, pt: 0.75 }, fill: { color: HEX.dk1 }, valign: "middle", rowH: [0.45, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7], margin: 0.08, objectName: "loss table" });
  T(s, "Proved, not just tested: 6 invariants fuzzed over 32,768 calls and 4 Halmos symbolic checks (no payee outside the signed set, no spend over caps); a copy with the Merkle check removed fails at once. 111 Foundry + 301 app tests. Live on Fuji (13/11), same allowlisted vendor, same treasury: allowlist-only mission paid it 0.01 USDC (tx 0x548d…7fc6); mission-set mission reverted PayeeNotInMissionSet (tx 0x0ad5…3e38); the approved payee was still paid (tx 0xcb72…6315).", { x: MX, y: 6.3, w: W - 2 * MX, h: 0.55, fontSize: 10.5, color: MUTED, objectName: "tests note" });
  s.addNotes("Đây là slide giám khảo kỹ thuật thích. Mỗi lỗi đều có trần. Câu hỏi 'nếu lộ key agent?' → mất tối đa số dư ví phiên, không chạm treasury. Nếu hỏi 'chứng minh gì?': Halmos chứng minh symbolic trong phạm vi có giới hạn (proof dài ≤ 2, 4 leaf), không phải formal verification toàn hệ thống; chi tiết FORMAL.md.");

  // ===== 7b. Benchmark (PayBench-ADI) =====
  s = pres.addSlide({ masterName: "MP_CONTENT", sectionTitle: "Why it holds" });
  s.addText("We attacked it 357 times with real LLMs", { placeholder: "title" });
  s.addChart(pres.charts.BAR, [
    { name: "No guard", labels: ["Gemini 3.5 Flash-Lite", "Gemini 3.1 Flash-Lite"], values: [32.1, 44.5] },
    { name: "Caps + allowlist", labels: ["Gemini 3.5 Flash-Lite", "Gemini 3.1 Flash-Lite"], values: [12.1, 13.9] },
    { name: "MissionPay", labels: ["Gemini 3.5 Flash-Lite", "Gemini 3.1 Flash-Lite"], values: [0, 0] },
  ], {
    x: MX, y: 1.45, w: 7.3, h: 4.35, barDir: "col", barGrouping: "clustered",
    chartColors: [HEX.accent1, HEX.accent3, HEX.accent2],
    showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: '0.0"%"', dataLabelColor: HEX.lt1, dataLabelFontSize: 13, dataLabelFontFace: "+mn-lt",
    showLegend: true, legendPos: "b", legendColor: HEX.lt2, legendFontSize: 12, legendFontFace: "+mn-lt",
    showTitle: true, title: "Attacks that moved money (% of attack runs)", titleColor: HEX.lt1, titleFontSize: 14, titleFontFace: "+mn-lt",
    catAxisLabelColor: HEX.lt2, catAxisLabelFontSize: 12, catAxisLabelFontFace: "+mn-lt",
    valAxisHidden: true, valAxisMaxVal: 55, valAxisMinVal: 0, valGridLine: { style: "none" }, catGridLine: { style: "none" },
    objectName: "benchmark chart",
  });
  const bstats = [
    ["17/20 · 19/20", "attacks that named a vendor already on the company list (but not in this mission) got through caps + allowlist. The NOMOS gate reports the same kind of gap (8/288)", AMBER],
    ["0 / 277", "attack runs moved money with MissionPay (95% upper bound 2.7% per model)", GREEN],
    ["40 / 40", "legitimate tasks (payouts and tool buys) still went through, on both models (no false positives)", GREEN],
  ];
  for (let i = 0; i < 3; i++) {
    const y = 1.45 + i * 1.48;
    card(s, 8.25, y, W - MX - 8.25, 1.32, "bench stat card " + (i + 1));
    T(s, bstats[i][0], { x: 8.45, y: y + 0.08, w: W - MX - 8.65, h: 0.52, fontSize: 25, bold: true, color: bstats[i][2], objectName: "bench stat " + (i + 1) });
    T(s, bstats[i][1], { x: 8.45, y: y + 0.60, w: W - MX - 8.65, h: 0.65, fontSize: 11.5, color: TXT, objectName: "bench label " + (i + 1) });
  }
  T(s, [
    { text: "AgentDojo banking, model-free replay: ", options: { bold: true, color: SKY } },
    { text: "120/128 financial injections blocked (all 8 misses: user_task_15, where the user's own prompt names the attacker IBAN); benign false positives 3/16, same as ProvGuard policy v1; Fuji fork: guard and GuardedTreasury agree 169/169; with the attacker on the global allowlist the contract still reverts 150/150 PayeeNotInMissionSet.", options: { color: TXT } }
  ], { x: MX, y: 5.92, w: W - 2 * MX, h: 0.36, fontSize: 9.5, objectName: "bench agentdojo replay" });
  T(s, "PayBench-ADI: 140 attack + 40 benign synthetic cases per model (instruction injection, structural ADI, vendor diversion, Bankr/Zscaler/Cornell/Freysa-style), temperature 0, one fresh agent run per case; N = 180 and 177. The structural ADI cases fooled neither model (0/40 and 0/39). Off-chain provenance guards also reach about 0% on AgentDojo banking (ProvGuard, NOMOS); numbers are not comparable across benchmarks. 10 blocked payouts replayed against GuardedTreasury on Fuji via eth_call: 9 reverted PayeeNotInMissionSet, 1 other revert. Dataset, scorer and leaderboard are public (eval/README.md, CC-BY-4.0) so other teams can plug in their own agent.", { x: MX, y: 6.32, w: W - 2 * MX, h: 0.55, fontSize: 9, color: MUTED, objectName: "bench method" });
  s.addNotes("45 giây. Đây là số đo thật, không phải demo. Không guard: 32 đến 45% đòn làm tiền đi. Cap cộng allowlist chặn được phần lớn, nhưng khi kẻ tấn công chỉ tới một vendor có trong allowlist chung của công ty mà không thuộc mission này thì allowlist để lọt 17/20 và 19/20. MissionPay: 0 trên 277 lượt tấn công, và 40/40 khoản trả hợp lệ vẫn đi. Nếu bị hỏi: case là synthetic dựa trên sự cố thật; ADI phá cấu trúc (40 case) không lừa được hai model này; chưa dùng dataset APort vì cần token Hugging Face.");

  // ===== 8. Verify =====
  s = pres.addSlide({ masterName: "MP_CONTENT", sectionTitle: "Why it holds" });
  s.addText("Don't trust us. Change 1 byte, the chain breaks", { placeholder: "title" });
  const vw = 5.85;
  const v1 = await shot(s, pickShot("deck-verify-ok.png", "wow-verify-original.png"), MX, 1.5, vw, 4.4, "Verifier: hash chain intact", "verify ok screenshot");
  await shot(s, pickShot("deck-verify-tampered.png", "wow-verify-tampered.png"), MX + vw + 0.43, 1.5, vw, 4.4, "Verifier: one byte edited, chain broken from that entry", "verify tampered screenshot");
  const capY = v1.iy + v1.ih + 0.2;
  T(s, [{ text: "Intact: ", options: { bold: true, color: GREEN } }, { text: "your browser recomputes every Keccak-256 link", options: { color: TXT } }], { x: MX, y: capY, w: vw, h: 0.4, fontSize: 15, objectName: "ok caption" });
  T(s, [{ text: "Tampered: ", options: { bold: true, color: RED } }, { text: "the edited entry and everything after it turn red", options: { color: TXT } }], { x: MX + vw + 0.43, y: capY, w: vw, h: 0.4, fontSize: 15, objectName: "tampered caption" });
  T(s, "This is the \"legibility layer\" Team1's own blog calls the missing piece of agentic payments: anyone can read and check every payment.", { x: MX, y: capY + 0.45, w: W - 2 * MX, h: 0.35, fontSize: 12, color: MUTED, objectName: "legibility note" });
  s.addNotes("Đưa QR verify cho khán giả tự mở. Câu chốt: không cần tin server của chúng tôi. Đây là câu trả lời cho 'khác gì một audit log thường?'. Blog Team1 (Danilo Giudice, 20/07/2026, Agentic Payments on Avalanche) nói lớp legibility quyết định agentic payments có thành hạ tầng lâu dài hay không.");

  // ===== 9. Built on Avalanche =====
  pres.addSection({ title: "Avalanche" });
  s = pres.addSlide({ masterName: "MP_CONTENT", sectionTitle: "Avalanche" });
  s.addText("Built on Avalanche, not just deployed there", { placeholder: "title" });
  const tiles = [
    [fa.FaBolt, "x402 on Fuji", "Gasless USDC tool payments (EIP-3009). A facilitator settles and pays the gas, so the mission's session wallet needs no AVAX."],
    [fa.FaCubes, "GuardedTreasury", "Per-mission caps, session wallets funded and swept by the owner, BLOCK / QUEUE / EXECUTE on-chain."],
    [fa.FaIdBadge, "ERC-8004 trust", "Agent #294 on the official Identity registry, owner feedback on Reputation, and our Validation registry: an independent validator re-checks a mission from the chain and posts 100/100."],
    [fa.FaFingerprint, "Passkey approval", "The owner can approve a mission with Face ID or a fingerprint. Avalanche's P-256 precompile verifies it on-chain, with RP ID, origin and user-verification checks (400k gas)."],
    [fa.FaAnchor, "Proof anchoring", "The audit head hash is written to the chain (MissionProofAnchored) so receipts can't be rewritten later."],
  ];
  const tw = 2.26, tg = 0.207;
  for (let i = 0; i < 5; i++) {
    const x = MX + i * (tw + tg);
    card(s, x, 1.55, tw, 4.2, "tile " + (i + 1));
    await iconDot(s, tiles[i][0], HEX.accent1, x + 0.3, 1.8, 0.7, "tile icon " + (i + 1));
    T(s, tiles[i][1], { x: x + 0.2, y: 2.65, w: tw - 0.4, h: 0.5, fontSize: 16, bold: true, objectName: "tile title " + (i + 1) });
    T(s, tiles[i][2], { x: x + 0.2, y: 3.2, w: tw - 0.4, h: 2.45, fontSize: 12.5, color: TXT, objectName: "tile body " + (i + 1) });
  }
  card(s, MX, 5.88, W - 2 * MX, 0.85, "status card");
  T(s, [
    { text: "Live on Fuji: ", options: { bold: true, color: GREEN } },
    { text: "GuardedTreasury 0x2045…d545 (verified) · x402 settle 0x8c89…8208 · payee root set 0x2a4c…90a4 · payout with proof 0x7694…6c9a · unapproved payout reverted 0xc5f1…f1ff · Twin Treasury: allowlisted vendor paid 0x548d…7fc6, then blocked by mission set 0x0ad5…3e38 · anchor 0x43bd…0547 · ERC-8004 feedback 0xeddd…9105 · validation 100/100 0xb641…d059 · passkey approval 0x494b…a929. Median finality measured: 4.2 s. Every link: FUJI_EVIDENCE.md.", options: { color: TXT } },
  ], { x: MX + 0.3, y: 5.92, w: W - 2 * MX - 0.6, h: 0.77, fontSize: 11, valign: "middle", objectName: "status text" });
  s.addNotes("Avalanche là 25 điểm. Mọi hash trên slide là tx thật trên Fuji, reviewer đã kiểm bằng cast (ngày 07/11). Nếu được hỏi: mở FUJI_EVIDENCE.md hoặc Snowtrace. Câu chốt: tx 0xc5f1 là lúc chính contract từ chối trả tiền cho người nhận không có trong danh sách owner ký. Twin Treasury (13/11): cùng một vendor có trong allowlist chung, mission chỉ dùng allowlist trả tiền (0x548d), mission có tập người nhận revert PayeeNotInMissionSet (0x0ad5), người nhận đúng vẫn được trả (0xcb72). Vendor là ví relayer của đội, đã gỡ khỏi allowlist sau demo. ValidationRegistry là bản port từ ava-labs/8004-boilerplate (Fuji chưa có registry chính thức), validator là ví riêng, chỉ đọc chain. Passkey: bản trên Fuji là demo instance riêng, khóa demo là khóa phần mềm; passkey thật của owner đăng ký khi quay video. Finality 4.2 s là đo từ lúc gửi tới lúc có receipt qua RPC công khai, gồm cả thời gian polling.");

  // ===== 10. Competition =====
  pres.addSection({ title: "Market" });
  s = pres.addSlide({ masterName: "MP_CONTENT", sectionTitle: "Market" });
  s.addText("Others stop strangers. We stop off-mission payees too", { placeholder: "title" });
  const ch = (t, hl = false) => ({ text: t, options: { bold: true, fontSize: 13, color: hl ? C.text1 : TXT, fill: { color: hl ? HEX.accent2 : HEX.dk2 } } });
  const cc = (t, hl = false, col = null) => ({ text: t, options: { fontSize: 12, color: col || (hl ? GREEN : TXT), bold: hl } });
  const comp = [
    [ch(""), ch("Provenance guards (ProvGuard, NOMOS, SPILLWAY)"), ch("allowance-ai (NEAR)"), ch("AgentGuard402 (Fuji)"), ch("Smart-account kits*"), ch("MissionPay", true)],
    [cc("Enforced on-chain"), cc("No, in the agent's runtime"), cc("Yes"), cc("Yes"), cc("Yes"), cc("Yes, Avalanche C-Chain", true)],
    [cc("Who may be paid"), cc("Payees the user named or the account already paid"), cc("One allowlist for the wallet"), cc("Owner allowlist"), cc("Allowlist via roles / caveats"), cc("Owner-signed set per mission (Merkle root)", true)],
    [cc("Payee planted in a web page or tool output"), cc("Blocked"), cc("Held for Face ID if not listed"), cc("Blocked if not listed"), cc("Blocked if not listed"), cc("Blocked, by provenance and on-chain", true)],
    [cc("Payee already known, but not part of this task"), cc("Paid (NOMOS: 8/288 slip)", false, AMBER), cc("Paid", false, AMBER), cc("Paid", false, AMBER), cc("Paid", false, AMBER), cc("Blocked (0/40 slip)", true)],
    [cc("Receipts anyone can check"), cc("Server logs"), cc("On-chain counters"), cc("Snowtrace txs"), cc("No"), cc("Anchored hash chain + ERC-8004 Validation", true)],
  ];
  s.addTable(comp, { x: MX, y: 1.5, w: W - 2 * MX, colW: [2.35, 2.2, 1.85, 1.75, 1.75, 2.23], fontFace: "Calibri", border: { type: "solid", color: HEX.accent5, pt: 0.75 }, fill: { color: HEX.dk1 }, valign: "middle", rowH: [0.75, 0.55, 0.75, 0.75, 0.75, 0.6], margin: 0.08, objectName: "competition table" });
  T(s, "*Safe/Zodiac Roles, MetaMask ERC-7715, Coinbase Spend Permissions, Polygon OMS. \"Paid\" for allowlist designs follows from their documented rules (a listed payee is sent), not from our test of their code. Sources: ProvGuard repo (Oct 2026), NOMOS arXiv 2610.11030, SPILLWAY arXiv 2611.07222, allowance-ai repo (Nov 2026), AgentGuard402 repo.", { x: MX, y: 5.75, w: W - 2 * MX, h: 0.5, fontSize: 10, color: MUTED, objectName: "comp note" });
  T(s, "Everyone can stop a stranger. MissionPay also stops a familiar payee who isn't part of this mission, and the chain enforces it.", { x: MX, y: 6.3, w: W - 2 * MX, h: 0.5, fontSize: 16, italic: true, color: AMBER, objectName: "comp takeaway" });
  s.addNotes("Q&A: 'ProvGuard, NOMOS, SPILLWAY đạt 0% rồi?' -> đúng, họ mạnh trên AgentDojo; nhưng chạy trong runtime của agent nên server bị chiếm là mất, và họ cho trả tới người đã biết: NOMOS tự ghi 8/288 lượt chuyển hướng sang payee quen. Đó đúng là bộ E10 của mình: allowlist lọt 17/20 và 19/20, MissionPay 0. Không nói ASR mình tốt hơn họ, vì benchmark khác nhau. 'allowance-ai trên NEAR?' -> giống ở cap, allowlist, Face ID, arena; khác ở payee theo mission (vendor trong allowlist được trả ngay), provenance, x402 trên Avalanche, neo proof + ERC-8004 Validation, benchmark LLM thật. 'AgentGuard402?' -> allowlist chung + cap, không có mission, provenance, proof. 'Kite?' -> Kite là cả L1; MissionPay là lớp chính sách + proof chạy trên C-Chain. 'Freysa làm bounty từ 2024?' -> Freysa mất tiền vì guard nằm trong prompt; bounty của mình để contract quyết định. 'CaMeL/Progent?' -> paper ADI đo vẫn lọt 22-23%. 'AP2 mandate?' -> paper whisper: AP2 ký giao dịch, không ký quyết định.");

  // ===== 11. Impact =====
  s = pres.addSlide({ masterName: "MP_CONTENT", sectionTitle: "Market" });
  s.addText("Agents already pay each other, mostly unguarded", { placeholder: "title" });
  const stats = [["27,499", "paid x402 endpoints tracked (Sep 30, 2026)", SKY], ["1,495", "of them charge more than their own listed price", RED], ["1,600+", "agents registered with ERC-8004 on Avalanche (Feb 2026)", GREEN]];
  for (let i = 0; i < 3; i++) {
    const x = MX + i * (3.75 + 0.4);
    card(s, x, 1.55, 3.75, 2.2, "stat card " + (i + 1));
    T(s, stats[i][0], { x: x + 0.3, y: 1.7, w: 3.15, h: 1.0, fontSize: 48, bold: true, color: stats[i][2], fontFace: "Arial", objectName: "stat value " + (i + 1) });
    T(s, stats[i][1], { x: x + 0.3, y: 2.75, w: 3.15, h: 0.85, fontSize: 14, color: TXT, objectName: "stat label " + (i + 1) });
  }
  card(s, MX, 4.05, 5.85, 2.15, "users card");
  await iconDot(s, fa.FaUsers, HEX.accent4, MX + 0.3, 4.3, 0.6, "users icon");
  T(s, "Who pays", { x: MX + 1.05, y: 4.35, w: 4.5, h: 0.5, fontSize: 19, bold: true, valign: "middle", objectName: "users title" });
  T(s, "Teams that let agents spend real money: AI labs buying data and tools, DAOs running treasury agents, small businesses automating purchases. Planned model: a small fee on mission budgets settled through MissionPay.", { x: MX + 0.3, y: 5.0, w: 5.3, h: 1.15, fontSize: 13, color: TXT, objectName: "users body" });
  card(s, MX + 6.28, 4.05, 5.85, 2.15, "roadmap card");
  await iconDot(s, fa.FaRoute, HEX.accent4, MX + 6.58, 4.3, 0.6, "roadmap icon");
  T(s, "Next", { x: MX + 7.33, y: 4.35, w: 4.5, h: 0.5, fontSize: 19, bold: true, valign: "middle", objectName: "roadmap title" });
  T(s, [
    { text: "PayBench-ADI leaderboard open to other agents (+ APort set)", options: { bullet: true, breakLine: true } },
    { text: "C-Chain mainnet with audited contracts", options: { bullet: true, breakLine: true } },
    { text: "MCP plugin so any agent framework can use it", options: { bullet: true, breakLine: true } },
    { text: "A dedicated Avalanche L1 for agent payments", options: { bullet: true } },
  ], { x: MX + 6.58, y: 4.95, w: 5.3, h: 1.2, fontSize: 13, color: TXT, paraSpaceAfter: 2, objectName: "roadmap list" });
  T(s, "Sources: x402 endpoint monitor cited on DEV Community (Sep 30, 2026); Avalanche ERC-8004 announcement (Feb 2026).", { x: MX, y: 6.4, w: W - 2 * MX, h: 0.35, fontSize: 10, color: MUTED, objectName: "impact sources" });
  s.addNotes("Số 1.495 endpoint thu cao hơn giá niêm yết là lý do có price guard. Mô hình phí là kế hoạch, nói rõ là 'planned'.");

  // ===== 12. Close =====
  pres.addSection({ title: "Close" });
  s = pres.addSlide({ masterName: "MP_TITLE", sectionTitle: "Close" });
  await iconDot(s, fa.FaShieldAlt, HEX.accent2, MX, 1.1, 0.85, "closing shield");
  s.addText([{ text: "LLMs can be fooled.", options: { color: TXT } }], { placeholder: "title" });
  s.addText([{ text: "Budgets on Avalanche can't.", options: { color: RED, bold: true, fontSize: 60, fontFace: "Arial" } }], { placeholder: "body" });
  T(s, "MissionPay: sign the mission once. The chain decides who gets paid.", { x: MX, y: 5.0, w: 10, h: 0.6, fontSize: 20, color: MUTED, objectName: "closing line" });
  T(s, "Avalanche Team1 Vietnam UniHack 2026", { x: MX, y: H - 0.9, w: 8, h: 0.35, fontSize: 14, color: MUTED, objectName: "closing event" });
  s.addNotes("Quay lại trang /bounty trước khi sang slide này: đọc N lượt thử, M lần LLM bị lừa, 0 đô ra ngoài (số đọc từ chain). Rồi nói câu chốt và dừng.");

  await pres.writeFile({ fileName: OUT });
  const themeScript = (process.env.PPTX_SKILL ? process.env.PPTX_SKILL.replace(/\\/g, "/") : "") + "/scripts/apply_theme.js";
  if (!process.env.PPTX_SKILL || !fs.existsSync(themeScript)) {
    throw new Error(`PPTX_SKILL invalid or apply_theme.js not found at: ${themeScript}`);
  }
  const { applyTheme } = require(themeScript);
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
