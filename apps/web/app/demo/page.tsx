'use client';

import { useState, useEffect } from 'react';

interface PolicyData {
  stage: string;
  chainId: number;
  paymentMode: string;
  systemPaused: boolean;
  maintenance: boolean;
  deploymentId: string;
  configuredOwner: string;
  agentAddress?: string;
}

export default function DemoPage() {
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [policy, setPolicy] = useState<PolicyData | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [stepStatus, setStepStatus] = useState<Record<string, 'IDLE' | 'RUNNING' | 'PENDING' | 'SUCCESS' | 'ERROR'>>({});
  const [currentSpendToken, setCurrentSpendToken] = useState<string | null>(null);

  // Autonomous AI Agent State (AGENT-01)
  const [agentGoal, setAgentGoal] = useState('Tóm tắt 3 nguồn về Avalanche blockchain architecture và transaction fees');
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentSteps, setAgentSteps] = useState<any[]>([]);
  const [agentDeliverable, setAgentDeliverable] = useState<any>(null);
  const [agentDeliverableHash, setAgentDeliverableHash] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState<string | null>(null);
  const [agentModel, setAgentModel] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/policy')
      .then((res) => res.json())
      .then((data) => setPolicy(data))
      .catch((err) => addLog(`Failed to fetch policy: ${err.message}`));
  }, []);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const connectWallet = async () => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          addLog(`Connected owner wallet: ${accounts[0]}`);
        }
      } catch (err: any) {
        addLog(`Wallet connection failed: ${err.message}`);
      }
    } else {
      addLog('No injected Web3 provider (MetaMask) found in this browser window.');
    }
  };

  const setStatus = (step: string, status: 'IDLE' | 'RUNNING' | 'PENDING' | 'SUCCESS' | 'ERROR') => {
    setStepStatus((prev) => ({ ...prev, [step]: status }));
  };

  const runLiveInteractiveDemo = async () => {
    setRunning(true);
    setLogs([]);
    addLog('Starting real Stage S1 vertical demo across production service boundaries...');

    try {
      // Step 1: Policy validation
      setStatus('policy', 'RUNNING');
      addLog('Step 1: Reading active policy and runtime configuration...');
      const policyRes = await fetch('/api/policy');
      if (!policyRes.ok) throw new Error(`Failed to read policy: HTTP ${policyRes.status}`);
      const policyData: PolicyData = await policyRes.json();
      setPolicy(policyData);
      addLog(`Policy active: Stage=${policyData.stage}, PaymentMode=${policyData.paymentMode}, ChainID=${policyData.chainId}`);
      setStatus('policy', 'SUCCESS');

      // Step 2: Request CREATE_MISSION Challenge
      setStatus('challenge', 'RUNNING');
      const slug = `demo-${Date.now().toString().slice(-6)}`;
      const targetOwner = account || policyData.configuredOwner;
      if (!targetOwner) {
        throw new Error('Owner address not configured or connected. Connect MetaMask or configure OWNER_ADDRESS.');
      }
      const agentAddress = policyData.agentAddress || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
      const treasuryCap = '10000000'; // 10 USDC
      const toolCap = '5000000'; // 5 USDC
      const durationSeconds = 86400;

      const createPayload = {
        slug,
        agentAddress,
        treasuryCap,
        toolCap,
        durationSeconds,
      };

      addLog(`Step 2: Requesting CREATE_MISSION challenge for slug '${slug}'...`);
      const challengeRes = await fetch('/api/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CREATE_MISSION',
          payload: createPayload,
          expectedSigner: targetOwner,
          targetMissionSlug: slug,
        }),
      });

      if (!challengeRes.ok) {
        const errJson = await challengeRes.json().catch(() => ({}));
        throw new Error(`Challenge request failed: HTTP ${challengeRes.status} ${errJson.error || ''}`);
      }
      const challengeData = await challengeRes.json();
      addLog(`Challenge issued. Nonce: ${challengeData.nonce.slice(0, 16)}...`);

      // Wallet signing
      let signature: string;
      if (typeof window !== 'undefined' && (window as any).ethereum && account) {
        addLog('Requesting EIP-191 signature from connected MetaMask wallet...');
        try {
          signature = await (window as any).ethereum.request({
            method: 'personal_sign',
            params: [challengeData.message, account],
          });
          addLog('Signature received from owner wallet.');
        } catch (sigErr: any) {
          throw new Error(`Owner wallet rejected challenge signing: ${sigErr.message}`);
        }
      } else {
        throw new Error(
          'Owner wallet connection (MetaMask) is required to sign challenges. Connect wallet before running live demo.'
        );
      }
      setStatus('challenge', 'SUCCESS');

      // Step 3: Create Mission
      setStatus('create', 'RUNNING');
      addLog(`Step 3: Creating mission '${slug}' via POST /api/missions...`);
      const createRes = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nonce: challengeData.nonce,
          signature,
          payload: createPayload,
        }),
      });

      if (!createRes.ok) {
        const errJson = await createRes.json().catch(() => ({}));
        throw new Error(`Mission creation failed: HTTP ${createRes.status} ${errJson.error || ''}`);
      }
      const missionData = await createRes.json();
      addLog(`Mission created successfully. Status: ${missionData.mission.status}, ToolCap: 5.00 USDC.`);
      setStatus('create', 'SUCCESS');

      // Step 4: Activate Mission to obtain Spend JWT
      setStatus('activate', 'RUNNING');
      addLog('Step 4: Activating mission to mint authorized spend JWT token...');
      const activatePayload = {
        missionId: missionData.mission.missionId,
        ownerAddress: targetOwner,
        agentAddress,
        treasuryCap,
        toolCap,
        configVersion: 1,
        policyHash: missionData.mission.policyHash,
      };

      const activateChallengeRes = await fetch('/api/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ACTIVATE',
          payload: activatePayload,
          expectedSigner: targetOwner,
          targetMissionSlug: slug,
        }),
      });

      if (!activateChallengeRes.ok) {
        const errJson = await activateChallengeRes.json().catch(() => ({}));
        throw new Error(`Activate challenge failed: HTTP ${activateChallengeRes.status} ${errJson.error || ''}`);
      }
      const actChallenge = await activateChallengeRes.json();

      let actSig: string;
      try {
        actSig = await (window as any).ethereum.request({
          method: 'personal_sign',
          params: [actChallenge.message, account],
        });
      } catch (sigErr: any) {
        throw new Error(`Owner wallet rejected activate signing: ${sigErr.message}`);
      }

      const activateRes = await fetch(`/api/missions/${slug}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nonce: actChallenge.nonce,
          signature: actSig,
          payload: activatePayload,
        }),
      });

      if (!activateRes.ok) {
        const errJson = await activateRes.json().catch(() => ({}));
        throw new Error(`Activation failed: HTTP ${activateRes.status} ${errJson.error || ''}`);
      }
      const actResult = await activateRes.json();
      const spendToken = actResult.spendToken;
      if (!spendToken) {
        throw new Error(`Activation did not return spendToken. Response keys: ${Object.keys(actResult).join(', ')}`);
      }
      setCurrentSpendToken(spendToken);
      addLog(`Mission activated. Received spend token (expires: ${actResult.expiresAt}).`);
      setStatus('activate', 'SUCCESS');

      // Step 5: Execute Search Tool via Server Orchestrator with Idempotency Key (V4-06)
      setStatus('search', 'RUNNING');
      const searchOpId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `search-op-${Date.now()}`;
      addLog(`Step 5: Submitting authorized search intent (opId: ${searchOpId.slice(0, 16)}...) to /api/tools/orchestrate...`);
      const searchRes = await fetch('/api/tools/orchestrate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${spendToken}`,
        },
        body: JSON.stringify({
          operationId: searchOpId,
          toolId: 'tool:search',
          arguments: { query: 'Avalanche Fuji settlement architecture' },
        }),
      });

      if (!searchRes.ok) {
        const errJson = await searchRes.json().catch(() => ({}));
        throw new Error(`Search tool execution failed: HTTP ${searchRes.status} ${errJson.error || ''}`);
      }
      let searchData = await searchRes.json();
      const opId = searchData.operationId || searchOpId;

      // Handle pending settlement with bounded polling (V4-06)
      if (searchData.state !== 'SETTLED') {
        addLog(`Search operation pending (HTTP ${searchRes.status}, state: ${searchData.state}). Polling GET /api/tools/operations/${opId}...`);
        for (let poll = 1; poll <= 5; poll++) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const pollRes = await fetch(`/api/tools/operations/${opId}`, {
            headers: { Authorization: `Bearer ${spendToken}` },
          });
          if (!pollRes.ok) {
            throw new Error(`Failed to poll operation status: HTTP ${pollRes.status}`);
          }
          const polled = await pollRes.json();
          if (polled.state === 'SETTLED') {
            searchData = polled;
            addLog(`Operation confirmed SETTLED on poll ${poll}.`);
            break;
          }
        }
      }

      if (searchData.state !== 'SETTLED' || !searchData.result) {
        throw new Error(`Tool execution remained in state '${searchData.state}'. Cannot advance to next step without settled result.`);
      }

      addLog(`Search settled. OpId: ${opId}, State: ${searchData.state}, Mode: ${searchData.paymentMode || searchData.mode}.`);
      if (searchData.result?.points) {
        addLog(`Discovered ${searchData.result.points.length} search findings from upstream provider.`);
      }
      setStatus('search', 'SUCCESS');

      // Step 6: TalkMeter Session Billing & Server Elapsed Guard Verification
      setStatus('talkmeter', 'RUNNING');
      addLog('Step 6: Initializing TalkMeter session (0.05 USDC / min, 2.00 USDC cap)...');
      const tmStartRes = await fetch('/api/tools/talkmeter/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${spendToken}`,
        },
        body: JSON.stringify({}),
      });

      if (!tmStartRes.ok) {
        const errJson = await tmStartRes.json().catch(() => ({}));
        throw new Error(`TalkMeter start failed: HTTP ${tmStartRes.status} ${errJson.error || ''}`);
      }
      const tmSession = await tmStartRes.json();
      addLog(`TalkMeter session started. Session ID: ${tmSession.session.id}`);

      addLog('Verifying server billing policy: Submitting immediate tick before 60s elapsed...');
      const tmTickRes = await fetch('/api/tools/talkmeter/tick', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${spendToken}`,
        },
        body: JSON.stringify({ sessionId: tmSession.session.id }),
      });

      if (!tmTickRes.ok) {
        const errJson = await tmTickRes.json().catch(() => ({}));
        if (tmTickRes.status === 400 && errJson.error?.includes('elapsed')) {
          addLog(`Server billing guard verified: Premature tick before 60s rejected as expected (HTTP 400: ${errJson.error}). Server prevents billing unearned minutes.`);
          // Attempt to stop session cleanly
          if (typeof tmSession !== 'undefined' && tmSession?.session?.id) {
            const stopRes = await fetch('/api/tools/talkmeter/stop', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${typeof spendToken !== 'undefined' ? spendToken : ''}`,
              },
              body: JSON.stringify({ sessionId: tmSession.session.id }),
            }).catch(() => null);

            if (stopRes && stopRes.ok) {
              addLog('TalkMeter session stopped cleanly after billing guard check.');
            } else {
              addLog(`Warning: TalkMeter stop returned HTTP ${stopRes ? stopRes.status : 'network error'}; guard verified but stop requires retry.`);
            }
          }
          setStatus('talkmeter', 'SUCCESS');
        } else {
          setStatus('talkmeter', 'ERROR');
          throw new Error(`TalkMeter tick unexpected error: HTTP ${tmTickRes.status} ${errJson.error || ''}`);
        }
      } else {
        const tmTickData = await tmTickRes.json().catch(() => ({}));
        const op = tmTickData?.operation;
        const opState = op?.state;

        // 1. Explicit terminal failure check
        if (opState === 'FAILED') {
          addLog(`TalkMeter tick operation failed (state: FAILED, error: ${op?.failureReason || tmTickData?.error || 'Unknown failure'}).`);
          setStatus('talkmeter', 'ERROR');
          addLog('Halted before Step 7: Mission completion aborted due to failed tool operation.');
          return;
        }

        // 2. Settlement verification: Only SETTLED is a valid payment success!
        if (opState === 'SETTLED') {
          addLog(`TalkMeter tick settled. Op state: SETTLED, amount: ${op?.reservedAmount || op?.amount || '50000'}`);
          if (typeof tmSession !== 'undefined' && tmSession?.session?.id) {
            const stopRes = await fetch('/api/tools/talkmeter/stop', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${typeof spendToken !== 'undefined' ? spendToken : ''}`,
              },
              body: JSON.stringify({ sessionId: tmSession.session.id }),
            }).catch(() => null);

            if (stopRes && stopRes.ok) {
              addLog('TalkMeter session stopped cleanly.');
            } else {
              addLog(`Warning: TalkMeter stop returned HTTP ${stopRes ? stopRes.status : 'network error'}; session ID ${tmSession.session.id} preserved for retry.`);
            }
          }
          setStatus('talkmeter', 'SUCCESS');
        } else {
          // 3. Nonterminal pending states (SUBMITTING, UNKNOWN, RESERVED, SIGNED, CREATED) or malformed responses
          addLog(`TalkMeter minute pending settlement (HTTP ${tmTickRes.status}, state: ${opState || 'PENDING'}). Awaiting recovery.`);
          setStatus('talkmeter', 'PENDING');
          addLog('Halted before Step 7: Mission completion requires all operations to be settled.');
          return;
        }
      }

      // Step 7: Complete Mission with dynamic deliverableHash (V4-06)
      setStatus('complete', 'RUNNING');
      if (!searchData?.result) {
        throw new Error('Prerequisite search result missing; cannot complete mission without real deliverable.');
      }
      const deliverableData = {
        missionSlug: slug,
        completedAt: new Date().toISOString(),
        searchResults: searchData?.result || null,
      };
      const enc = new TextEncoder().encode(JSON.stringify(deliverableData));
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', enc);
      const deliverableHash = '0x' + Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
      addLog(`Step 7: Computed dynamic deliverableHash from search results: ${deliverableHash.slice(0, 18)}...`);

      const compPayload = { slug, deliverableHash };
      const compChallengeRes = await fetch('/api/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'COMPLETE_MISSION',
          payload: compPayload,
          expectedSigner: targetOwner,
          targetMissionSlug: slug,
        }),
      });

      if (!compChallengeRes.ok) {
        const errJson = await compChallengeRes.json().catch(() => ({}));
        throw new Error(`Complete challenge failed: HTTP ${compChallengeRes.status} ${errJson.error || ''}`);
      }
      const compChallenge = await compChallengeRes.json();

      let compSig: string;
      try {
        compSig = await (window as any).ethereum.request({
          method: 'personal_sign',
          params: [compChallenge.message, account],
        });
      } catch (sigErr: any) {
        throw new Error(`Owner wallet rejected complete signing: ${sigErr.message}`);
      }

      const completeRes = await fetch(`/api/missions/${slug}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nonce: compChallenge.nonce,
          signature: compSig,
          payload: compPayload,
        }),
      });

      if (!completeRes.ok) {
        const errJson = await completeRes.json().catch(() => ({}));
        throw new Error(`Complete mission failed: HTTP ${completeRes.status} ${errJson.error || ''}`);
      }
      addLog('Mission marked COMPLETED with verified deliverableHash.');
      setStatus('complete', 'SUCCESS');

      // Step 8: Download & Verify Scoped Proof and Public Audit
      setStatus('proof', 'RUNNING');
      addLog('Step 8: Fetching scoped mission proof from /api/missions/[slug]/proof...');
      const proofRes = await fetch(`/api/missions/${slug}/proof`, {
        headers: { Authorization: `Bearer ${spendToken}` },
      });

      if (!proofRes.ok) {
        const errJson = await proofRes.json().catch(() => ({}));
        throw new Error(`Proof fetch failed: HTTP ${proofRes.status} ${errJson.error || ''}`);
      }
      const proofData = await proofRes.json();
      addLog(`Proof retrieved: scope='${proofData.ledgerScope}', entries=${proofData.audit.entries.length}, headHash=${proofData.audit.checkpoint.headHash.slice(0, 16)}...`);

      // Verify public audit bundle
      addLog('Verifying public audit bundles via /api/audit...');
      const auditRes = await fetch('/api/audit');
      if (auditRes.ok) {
        const auditData = await auditRes.json();
        addLog(`Public audit accessible: bundles=${auditData.bundles?.length ?? 0}, unprojectedLegacyEntries=${auditData.unprojectedLegacyEntries ?? 0}.`);
      }
      setStatus('proof', 'SUCCESS');

      addLog('SUCCESS: Complete vertical S1 mission lifecycle executed and verified against live API routes.');
    } catch (err: any) {
      addLog(`ERROR: Flow aborted: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  const runAutonomousAgentMission = async () => {
    setAgentRunning(true);
    setAgentSteps([]);
    setAgentDeliverable(null);
    setAgentDeliverableHash(null);
    addLog(`[AGENT-01] Initializing autonomous AI Agent with goal: "${agentGoal}"...`);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (currentSpendToken) {
        headers['Authorization'] = `Bearer ${currentSpendToken}`;
      }

      const res = await fetch('/api/agent/run', {
        method: 'POST',
        headers,
        body: JSON.stringify({ goal: agentGoal }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 401) {
          throw new Error('Missing spend token. Please execute Steps 1–4 to activate a mission before running the autonomous agent.');
        }
        throw new Error(`Agent execution failed: HTTP ${res.status} ${errJson.error || ''}`);
      }

      const data = await res.json();
      setAgentMode(data.plannerMode);
      setAgentModel(data.plannerModel);
      setAgentSteps(data.steps || []);
      setAgentDeliverable(data.deliverable);
      setAgentDeliverableHash(data.deliverableHash);

      addLog(`[AGENT-01] Autonomous run completed. Mode: ${data.plannerMode}, Turns: ${data.turnCount}, DeliverableHash: ${data.deliverableHash?.slice(0, 18) || 'N/A'}...`);
      data.steps?.forEach((st: any) => {
        addLog(`[AGENT-01] Turn ${st.turn} [${st.action}]: ${st.thought}`);
      });
    } catch (err: any) {
      addLog(`[AGENT-01] Error: ${err.message}`);
    } finally {
      setAgentRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Interactive S1 Production Demo</h1>
          <p className="text-slate-400 text-sm">
            Executes real API requests against production route handlers: mission lifecycle, x402 quotes, reservations, execution, TalkMeter, and scoped audit proofs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="bg-amber-950 text-amber-400 border border-amber-800 text-xs px-2.5 py-1 rounded font-mono">
            Payment Mode: {policy?.paymentMode || 'LOADING'}
          </span>
          <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 text-xs px-2.5 py-1 rounded font-mono">
            Stage: {policy?.stage || 'S1'}
          </span>
          <span className="bg-indigo-950 text-indigo-400 border border-indigo-800 text-xs px-2.5 py-1 rounded font-mono">
            Chain ID: {policy?.chainId || 43113}
          </span>
        </div>
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded-lg p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={connectWallet}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-2 rounded border border-slate-700 transition"
            >
              {account ? `Connected: ${account.slice(0, 6)}...${account.slice(-4)}` : 'Connect MetaMask'}
            </button>
            <span className="text-xs text-slate-500">
              {account ? 'Signing via personal_sign' : 'MetaMask required for browser owner signing'}
            </span>
          </div>

          <button
            onClick={runLiveInteractiveDemo}
            disabled={running}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded transition"
          >
            {running ? 'Executing Live Flow...' : 'Execute Live S1 Flow'}
          </button>
        </div>

        {/* Step indicator pills */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { id: 'policy', label: '1. Policy' },
            { id: 'challenge', label: '2. Challenge' },
            { id: 'create', label: '3. Create' },
            { id: 'activate', label: '4. Activate' },
            { id: 'search', label: '5. Search' },
            { id: 'talkmeter', label: '6. TalkMeter' },
            { id: 'complete', label: '7. Complete' },
            { id: 'proof', label: '8. Scoped Proof' },
          ].map((s) => {
            const status = stepStatus[s.id] || 'IDLE';
            let color = 'bg-slate-900 border-slate-800 text-slate-400';
            if (status === 'RUNNING') color = 'bg-blue-950 border-blue-700 text-blue-300 animate-pulse';
            if (status === 'PENDING') color = 'bg-amber-950 border-amber-700 text-amber-300 animate-pulse';
            if (status === 'SUCCESS') color = 'bg-emerald-950 border-emerald-700 text-emerald-300';
            if (status === 'ERROR') color = 'bg-rose-950 border-rose-700 text-rose-300';

            return (
              <div
                key={s.id}
                data-testid={`step-${s.id}`}
                data-status={status}
                className={`border rounded p-3 text-xs flex items-center justify-between ${color}`}
              >
                <span className="font-semibold">{s.label}</span>
                <span className="font-mono text-[10px] uppercase">{status}</span>
              </div>
            );
          })}
        </div>

        {/* AGENT-01: Autonomous AI Agent Section */}
        <div className="bg-slate-900/90 border border-indigo-900/60 rounded-lg p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-white">Autonomous AI Agent Planner (AGENT-01)</h2>
                {agentMode && (
                  <span
                    className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded border ${
                      agentMode === 'LIVE_LLM'
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                        : 'bg-amber-950 text-amber-300 border-amber-700'
                    }`}
                  >
                    {agentMode}
                  </span>
                )}
                {agentModel && (
                  <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                    {agentModel} (v1.0)
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Autonomous multi-turn planner: LLM reasons dynamically, proposes tool purchases or payouts, complies with strict code validators, and synthesizes cited deliverable.
              </p>
            </div>

            <button
              onClick={runAutonomousAgentMission}
              disabled={agentRunning}
              data-testid="execute-agent-btn"
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded transition whitespace-nowrap"
            >
              {agentRunning ? 'Agent Planning & Executing...' : 'Execute Autonomous Agent Mission'}
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-300">Mission Goal / Objective:</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={agentGoal}
                onChange={(e) => setAgentGoal(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() => setAgentGoal('Tóm tắt 3 nguồn về Avalanche blockchain architecture và transaction fees')}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] px-2.5 py-1.5 rounded border border-slate-700"
              >
                Preset: Avalanche
              </button>
            </div>
          </div>

          {/* Agent Step Execution Timeline */}
          {agentSteps.length > 0 && (
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Agent Reasoning & Step Ledger</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {agentSteps.map((st) => (
                  <div key={st.turn} className="bg-slate-950/80 border border-slate-800 rounded p-3 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-indigo-400">Turn {st.turn}: {st.action}</span>
                      {st.amountAtomic && (
                        <span className="text-[10px] font-mono bg-indigo-950 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-800">
                          {Number(st.amountAtomic) / 1000000} USDC
                        </span>
                      )}
                    </div>
                    <p className="text-slate-300 text-[11px] italic font-sans leading-relaxed">
                      &ldquo;{st.thought}&rdquo;
                    </p>
                    {st.verdict && (
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span className="text-emerald-400 font-semibold">Verdict:</span>
                        <span className="font-mono text-emerald-300">{st.verdict.outcome} ({st.verdict.rule})</span>
                      </div>
                    )}
                    {st.sources && st.sources.length > 0 && (
                      <div className="text-[10px] space-y-1">
                        <span className="text-slate-400 font-medium">Sources:</span>
                        <div className="space-y-0.5">
                          {st.sources.map((src: string, i: number) => (
                            <a
                              key={i}
                              href={src}
                              target="_blank"
                              rel="noreferrer"
                              className="text-indigo-400 hover:underline block truncate"
                            >
                              {src}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Verified Deliverable Output */}
          {agentDeliverable && (
            <div className="bg-emerald-950/40 border border-emerald-700/60 rounded p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                  Verified Deliverable Output
                </span>
                {agentDeliverableHash && (
                  <span className="font-mono text-[10px] bg-emerald-900/80 text-emerald-200 px-2 py-0.5 rounded border border-emerald-700">
                    Hash: {agentDeliverableHash.slice(0, 18)}...
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-200 leading-relaxed">
                {agentDeliverable.summary}
              </p>
              {agentDeliverable.sources && agentDeliverable.sources.length > 0 && (
                <div className="pt-2 border-t border-emerald-900/50 space-y-1">
                  <span className="text-[11px] font-medium text-emerald-300">Cited Real Reference Sources:</span>
                  <div className="flex flex-wrap gap-2">
                    {agentDeliverable.sources.map((src: string, i: number) => (
                      <a
                        key={i}
                        href={src}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] font-mono text-indigo-300 hover:text-indigo-200 underline bg-slate-950 px-2 py-0.5 rounded border border-slate-800 truncate max-w-xs"
                      >
                        {src}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Output console log */}
        <div className="bg-black/60 border border-slate-800 rounded p-4 font-mono text-xs text-slate-300 max-h-96 overflow-y-auto space-y-1">
          {logs.length === 0 ? (
            <div className="text-slate-600 italic">Logs will appear here when the live demo is executed...</div>
          ) : (
            logs.map((log, i) => <div key={i}>{log}</div>)
          )}
        </div>
      </div>
    </div>
  );
}
