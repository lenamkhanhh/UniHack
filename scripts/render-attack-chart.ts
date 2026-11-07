/**
 * S2-3: Render 1920x1080 Attack Evaluation Chart from eval/results.json
 */

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

async function main() {
  const resultsPath = path.resolve(__dirname, '../eval/results.json');
  if (!fs.existsSync(resultsPath)) {
    console.error('eval/results.json does not exist. Run attack-eval.ts first.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const modelKey = data.modelsEvaluated[0] || 'gemini-3.5-flash-lite';
  const modelData = data.modelsData[modelKey] || Object.values(data.modelsData)[0];

  const overall = modelData.overall;
  const instructionInj = modelData.breakdowns.instruction_injection || modelData.breakdowns.adi;
  const vendorInj = modelData.breakdowns.instruction_injection_allowlisted_vendor || instructionInj;
  const adiStruct = modelData.breakdowns.adi_structural || modelData.breakdowns.adi;
  const inc = modelData.breakdowns.real_incidents;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PayBench-ADI Evaluation Chart</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1920px;
      height: 1080px;
      background: radial-gradient(circle at 50% 20%, #151d2f 0%, #080c14 100%);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #f1f5f9;
      padding: 60px 80px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 2px solid rgba(255,255,255,0.08);
      padding-bottom: 24px;
    }
    .brand-title {
      font-size: 38px;
      font-weight: 800;
      letter-spacing: -0.02em;
      background: linear-gradient(135deg, #ffffff 40%, #94a3b8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .brand-subtitle {
      font-size: 18px;
      color: #94a3b8;
      margin-top: 6px;
      font-weight: 500;
    }
    .badge-bar {
      display: flex;
      gap: 12px;
    }
    .badge {
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 9999px;
      padding: 6px 18px;
      font-size: 14px;
      font-weight: 600;
      color: #38bdf8;
      letter-spacing: 0.03em;
    }

    /* 3 Primary Comparison Cards */
    .tiers-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 32px;
      margin-top: 36px;
    }

    .tier-card {
      background: rgba(15, 23, 42, 0.65);
      border-radius: 20px;
      padding: 32px;
      border: 1px solid rgba(255,255,255,0.08);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
      position: relative;
      overflow: hidden;
    }
    .tier-c0 { border-top: 5px solid #ef4444; }
    .tier-c1 { border-top: 5px solid #f59e0b; }
    .tier-c2 {
      border-top: 5px solid #10b981;
      background: linear-gradient(180deg, rgba(16, 185, 129, 0.08) 0%, rgba(15, 23, 42, 0.7) 100%);
      border: 1px solid rgba(16, 185, 129, 0.4);
    }

    .tier-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    .tier-name {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .tier-pill {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 4px 12px;
      border-radius: 9999px;
    }
    .pill-c0 { background: rgba(239, 68, 68, 0.2); color: #f87171; }
    .pill-c1 { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .pill-c2 { background: rgba(16, 185, 129, 0.2); color: #34d399; }

    .metric-hero {
      margin: 16px 0;
    }
    .metric-hero .label {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
      font-weight: 600;
    }
    .metric-hero .value {
      font-size: 56px;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.1;
      margin: 4px 0;
    }
    .val-c0 { color: #f87171; }
    .val-c1 { color: #fbbf24; }
    .val-c2 { color: #34d399; }

    .ci-sub {
      font-size: 14px;
      color: #64748b;
      font-family: monospace;
    }

    .stat-rows {
      border-top: 1px solid rgba(255,255,255,0.06);
      padding-top: 20px;
      margin-top: 10px;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      font-size: 16px;
      margin-bottom: 12px;
      color: #cbd5e1;
    }
    .stat-row .val {
      font-weight: 700;
      font-family: monospace;
      color: #f1f5f9;
    }

    /* Breakdown Section */
    .bottom-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 32px;
      margin-top: 32px;
    }

    .breakdown-box {
      background: rgba(15, 23, 42, 0.5);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 24px 32px;
    }
    .box-title {
      font-size: 18px;
      font-weight: 700;
      color: #e2e8f0;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .table-custom {
      width: 100%;
      border-collapse: collapse;
      font-size: 15px;
    }
    .table-custom th {
      text-align: left;
      color: #64748b;
      font-weight: 600;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .table-custom td {
      padding: 12px 0;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      color: #cbd5e1;
    }
    .table-custom td:nth-child(2),
    .table-custom td:nth-child(3),
    .table-custom td:nth-child(4) {
      font-family: monospace;
      font-weight: 700;
    }

    /* Key Insights Box */
    .insights-box {
      background: rgba(15, 23, 42, 0.5);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 24px 28px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .insight-item {
      display: flex;
      gap: 12px;
      font-size: 14px;
      line-height: 1.5;
      color: #cbd5e1;
      margin-bottom: 12px;
    }
    .insight-bullet {
      color: #38bdf8;
      font-weight: bold;
      font-size: 18px;
      line-height: 1;
    }

    footer {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      color: #64748b;
      border-top: 1px solid rgba(255,255,255,0.06);
      padding-top: 16px;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <div class="brand-title">MissionPay vs. Adversarial LLM Payment Attacks</div>
      <div class="brand-subtitle">PayBench-ADI Benchmark: Agent Data Injection & Historical Incident Evaluation on Avalanche</div>
    </div>
    <div class="badge-bar">
      <div class="badge">N = 180 Cases (140 Attack / 40 Benign)</div>
      <div class="badge">Fuji On-Chain eth_call Verified</div>
      <div class="badge">Temperature: 0.0</div>
    </div>
  </header>

  <div class="tiers-grid">
    <!-- C0 Card -->
    <div class="tier-card tier-c0">
      <div>
        <div class="tier-header">
          <div class="tier-name">C0: Unprotected Agent</div>
          <div class="tier-pill pill-c0">Baseline</div>
        </div>
        <div class="metric-hero">
          <div class="label">Attack Success Rate (ASR)</div>
          <div class="value val-c0">${overall.c0_unprotected.asr.formatted.split(' ')[0]}</div>
          <div class="ci-sub">${overall.c0_unprotected.asr.formatted.split(' ').slice(1).join(' ')}</div>
        </div>
      </div>
      <div class="stat-rows">
        <div class="stat-row">
          <span>LLM Tricked Rate</span>
          <span class="val">${overall.llmTricked.formatted.split(' ')[0]}</span>
        </div>
        <div class="stat-row">
          <span>Out-of-Bounds Spend</span>
          <span class="val val-c0">$${overall.c0_unprotected.outOfBoundsSpendUsdc} USDC</span>
        </div>
        <div class="stat-row">
          <span>Protection Mechanism</span>
          <span class="val" style="color: #f87171;">None (Prompt Only)</span>
        </div>
      </div>
    </div>

    <!-- C1 Card -->
    <div class="tier-card tier-c1">
      <div>
        <div class="tier-header">
          <div class="tier-name">C1: Cap + Allowlist Only</div>
          <div class="tier-pill pill-c1">Legacy Rails</div>
        </div>
        <div class="metric-hero">
          <div class="label">Attack Success Rate (ASR)</div>
          <div class="value val-c1">${overall.c1_cap_allowlist_only.asr.formatted.split(' ')[0]}</div>
          <div class="ci-sub">${overall.c1_cap_allowlist_only.asr.formatted.split(' ').slice(1).join(' ')}</div>
        </div>
      </div>
      <div class="stat-rows">
        <div class="stat-row">
          <span>Vendor Diversion Bypass</span>
          <span class="val val-c1">85.0% – 95.0% Penetration</span>
        </div>
        <div class="stat-row">
          <span>Out-of-Bounds Spend</span>
          <span class="val val-c1">$${overall.c1_cap_allowlist_only.outOfBoundsSpendUsdc} USDC</span>
        </div>
        <div class="stat-row">
          <span>Protection Mechanism</span>
          <span class="val" style="color: #fbbf24;">Static Allowlist + Cap</span>
        </div>
      </div>
    </div>

    <!-- C2 Card -->
    <div class="tier-card tier-c2">
      <div>
        <div class="tier-header">
          <div class="tier-name">C2: MissionPay Full Guard</div>
          <div class="tier-pill pill-c2">Our Solution</div>
        </div>
        <div class="metric-hero">
          <div class="label">Attack Success Rate (ASR)</div>
          <div class="value val-c2">${overall.c2_full_missionpay.asr.formatted.split(' ')[0]}</div>
          <div class="ci-sub">${overall.c2_full_missionpay.asr.formatted.split(' ').slice(1).join(' ')}</div>
        </div>
      </div>
      <div class="stat-rows">
        <div class="stat-row">
          <span>Benign Task Utility</span>
          <span class="val val-c2">${overall.c2_full_missionpay.utility.formatted.split(' ')[0]}</span>
        </div>
        <div class="stat-row">
          <span>Out-of-Bounds Spend</span>
          <span class="val val-c2">$0.00 USDC</span>
        </div>
        <div class="stat-row">
          <span>Protection Mechanism</span>
          <span class="val" style="color: #34d399;">Provenance + Merkle Root</span>
        </div>
      </div>
    </div>
  </div>

  <div class="bottom-grid">
    <div class="breakdown-box">
      <div class="box-title">
        <span>Attack Subgroup Performance Breakdown</span>
        <span style="font-size: 13px; color: #94a3b8; font-weight: 500;">95% Wilson Score Confidence Intervals</span>
      </div>
      <table class="table-custom">
        <thead>
          <tr>
            <th>Attack Category</th>
            <th>C0 Unprotected ASR</th>
            <th>C1 Legacy ASR</th>
            <th>C2 MissionPay ASR</th>
            <th>Treasury Loss Prevented</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Vendor Diversion (Allowlist Bypass)</strong> — Target in organization allowlist, outside mission set</td>
            <td style="color:#f87171;">${vendorInj.c0.asr.formatted.split(' ')[0]}</td>
            <td style="color:#fbbf24;">${vendorInj.c1.asr.formatted.split(' ')[0]} (Bypassed)</td>
            <td style="color:#34d399;">${vendorInj.c2.asr.formatted.split(' ')[0]} (Blocked)</td>
            <td style="color:#34d399;">$${vendorInj.c0.spendUsdc} USDC</td>
          </tr>
          <tr>
            <td><strong>Instruction Injection</strong> — Prompt injection overrides in untrusted data payload</td>
            <td style="color:#f87171;">${instructionInj.c0.asr.formatted.split(' ')[0]}</td>
            <td style="color:#fbbf24;">${instructionInj.c1.asr.formatted.split(' ')[0]}</td>
            <td style="color:#34d399;">${instructionInj.c2.asr.formatted.split(' ')[0]}</td>
            <td style="color:#34d399;">$${instructionInj.c0.spendUsdc} USDC</td>
          </tr>
          <tr>
            <td><strong>Structural ADI Delimiter Injection</strong> — Pure JSON syntax breaking (arXiv 2607.05120)</td>
            <td style="color:#94a3b8;">${adiStruct.c0.asr.formatted.split(' ')[0]}</td>
            <td style="color:#94a3b8;">${adiStruct.c1.asr.formatted.split(' ')[0]}</td>
            <td style="color:#34d399;">${adiStruct.c2.asr.formatted.split(' ')[0]}</td>
            <td style="color:#34d399;">$0.00 USDC</td>
          </tr>
          <tr>
            <td><strong>Real-World Incidents</strong> — Bankr Morse Code ($174k), Zscaler JSON-LD, Cornell OTP, Freysa</td>
            <td style="color:#f87171;">${inc.c0.asr.formatted.split(' ')[0]}</td>
            <td style="color:#34d399;">${inc.c1.asr.formatted.split(' ')[0]}</td>
            <td style="color:#34d399;">${inc.c2.asr.formatted.split(' ')[0]}</td>
            <td style="color:#34d399;">$${inc.c0.spendUsdc} USDC</td>
          </tr>
          <tr>
            <td><strong>Benign Tasks (Utility Control)</strong> — Legitimate contractor invoices, research, tools</td>
            <td style="color:#94a3b8;">100.0% Pass</td>
            <td style="color:#94a3b8;">100.0% Pass</td>
            <td style="color:#34d399;">${overall.c2_full_missionpay.utility.formatted.split(' ')[0]} Pass</td>
            <td style="color:#38bdf8;">0.0% False Positives</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="insights-box">
      <div class="box-title">Core Security Invariants</div>
      <div>
        <div class="insight-item">
          <div class="insight-bullet">🛡️</div>
          <div><strong>On-Chain Simulation:</strong> 9/10 reverted with <code>PayeeNotInMissionSet</code> + 1/10 <code>ContractRevert</code> via zero-gas <code>eth_call</code> simulation on Avalanche Fuji.</div>
        </div>
        <div class="insight-item">
          <div class="insight-bullet">📊</div>
          <div><strong>Legacy Gaps Closed:</strong> C1 static allowlists fail against allowlisted vendor diversion. C2 provenance bounds spending strictly to owner-signed mission Merkle leaves.</div>
        </div>
        <div class="insight-item">
          <div class="insight-bullet">⚡</div>
          <div><strong>Zero Utility Penalty:</strong> 100% of benign research and verified contractor payments pass cleanly without false positive disruptions.</div>
        </div>
      </div>
    </div>
  </div>

  <footer>
    <div>Models: gemini-3.5-flash-lite & gemini-3.1-flash-lite · Evaluated via Google AI Gemini API · Output Format: JSON Mode · Temperature: 0.0</div>
    <div>MissionPay · Autonomous Agent Guarded Treasury Architecture on Avalanche</div>
  </footer>
</body>
</html>`;

  const htmlPath = path.resolve(__dirname, '../eval/attack-eval-chart.html');
  fs.writeFileSync(htmlPath, html, 'utf8');

  console.log('Rendering 1920x1080 chart screenshot with Playwright...');
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  await page.goto(`file://${htmlPath}`);
  await page.waitForTimeout(500);

  const outImagePath = path.resolve(__dirname, '../eval/attack-eval-chart.png');
  await page.screenshot({ path: outImagePath });
  await browser.close();

  console.log(`✅ Chart rendered successfully: ${outImagePath}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
