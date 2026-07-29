import { Agent, getAgentByName } from 'agents';
import { AgentWorkflow } from 'agents/workflows';
import { analyzeProject, applyProposal } from './analysis.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(value, status) {
  return new Response(JSON.stringify(value), { status: status || 200, headers: JSON_HEADERS });
}

async function sessionFor(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const raw = await env.RIDGELINE_KV.get('session:' + token);
  if (!raw) return null;
  if (raw === '1') return { role: 'admin', name: 'Ridgeline', owner: true };
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function loadJson(env, key, fallback) {
  const raw = await env.RIDGELINE_KV.get(key);
  try { return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
}

async function saveJob(env, job) {
  job.version = Math.max(1, Number(job.version) || 1) + 1;
  job.updatedAt = Date.now();
  await env.RIDGELINE_KV.put('job:' + job.id, JSON.stringify(job));
  const index = await loadJson(env, 'jobs:index', []);
  const meta = index.find(x => x.id === job.id);
  const next = {
    id: job.id,
    name: job.name,
    status: job.status || 'active',
    version: job.version,
    updatedAt: job.updatedAt,
    editCount: Object.keys(job.edits || {}).length
  };
  if (meta) Object.assign(meta, next); else index.push(next);
  await env.RIDGELINE_KV.put('jobs:index', JSON.stringify(index));
}

export class ProjectAgent extends Agent {
  initialState = {
    generatedAt: null,
    jobId: null,
    jobName: null,
    brief: null,
    proposals: [],
    lastError: null
  };

  async refresh(requestedBy) {
    const job = await loadJson(this.env, 'job:' + this.name, null);
    if (!job) throw new Error('job not found');
    const board = await loadJson(this.env, 'board', { notes: [] });
    const result = analyzeProject(job, board);
    const previous = new Map((this.state.proposals || []).map(p => [p.kind + '|' + p.title + '|' + JSON.stringify(p.source || null), p]));
    const proposals = [];
    const newProposals = [];
    for (const candidate of result.proposals) {
      const key = candidate.kind + '|' + candidate.title + '|' + JSON.stringify(candidate.source || null);
      const old = previous.get(key);
      if (old) {
        proposals.push(old);
        continue;
      }
      proposals.push(candidate);
      newProposals.push(candidate);
    }

    // Persist proposals before starting workflows. A workflow can begin immediately,
    // and its first step reads this state to build the approval request.
    this.setState({
      generatedAt: result.generatedAt,
      jobId: job.id,
      jobName: job.name,
      brief: result.brief,
      proposals,
      lastError: null
    });
    for (const candidate of newProposals) {
      candidate.workflowId = await this.runWorkflow(
        'PROPOSAL_WORKFLOW',
        { proposalId: candidate.id },
        { metadata: { jobId: job.id, proposalId: candidate.id, kind: candidate.kind } }
      );
      candidate.requestedBy = requestedBy || 'Sitely agent';
    }
    if (newProposals.length) this.setState({ ...this.state, proposals: [...proposals] });
    let brief = result.brief;
    try {
      const ai = await this.env.AI.run('@cf/zai-org/glm-4.7-flash', {
        messages: [
          { role: 'system', content: 'You are a construction operations assistant. Rewrite the supplied factual brief into one concise, direct paragraph. Do not invent facts, dates, costs, or commitments.' },
          { role: 'user', content: JSON.stringify({ job: job.name, brief }) }
        ],
        max_tokens: 260
      });
      const text = ai && (ai.response || ai.result || ai.text);
      if (typeof text === 'string' && text.trim()) brief = { ...brief, narrative: text.trim() };
    } catch (e) {
      // Deterministic brief remains fully usable if Workers AI is unavailable.
    }
    this.setState({
      generatedAt: result.generatedAt,
      jobId: job.id,
      jobName: job.name,
      brief,
      proposals,
      lastError: null
    });
    return this.state;
  }

  async getSnapshot() {
    return this.state;
  }

  async getProposalContext(proposalId) {
    return (this.state.proposals || []).find(p => p.id === proposalId) || null;
  }

  async decide(proposalId, decision, actor, reason) {
    const item = (this.state.proposals || []).find(p => p.id === proposalId);
    if (!item) throw new Error('proposal not found');
    if (item.status !== 'pending' && item.status !== 'approval-sent') return this.state;
    if (decision === 'approve') {
      item.status = 'approval-sent';
      this.setState({ ...this.state, proposals: [...this.state.proposals] });
      try {
        await this.approveWorkflow(item.workflowId, {
          reason: reason || 'Approved in Sitely',
          metadata: { approvedBy: actor || 'admin', approvedAt: Date.now() }
        });
      } catch (error) {
        item.status = 'pending';
        this.setState({ ...this.state, proposals: [...this.state.proposals] });
        throw error;
      }
    } else {
      item.status = 'rejected';
      item.decidedBy = actor || 'admin';
      item.decidedAt = Date.now();
      this.setState({ ...this.state, proposals: [...this.state.proposals] });
      try {
        await this.rejectWorkflow(item.workflowId, { reason: reason || 'Rejected in Sitely' });
      } catch (error) {
        item.status = 'pending';
        delete item.decidedBy;
        delete item.decidedAt;
        this.setState({ ...this.state, proposals: [...this.state.proposals] });
        throw error;
      }
    }
    return this.state;
  }

  async applyApprovedProposal(proposalId, approval) {
    const item = (this.state.proposals || []).find(p => p.id === proposalId);
    if (!item) throw new Error('proposal not found');
    const job = await loadJson(this.env, 'job:' + this.name, null);
    if (!job) throw new Error('job not found');
    if (Math.max(1, Number(job.version) || 1) !== Number(item.baseVersion)) {
      item.status = 'conflict';
      item.error = 'The job changed after this proposal was created. Refresh the agent before approving it.';
      this.setState({ ...this.state, proposals: [...this.state.proposals] });
      return { applied: false, conflict: true };
    }
    const result = applyProposal(job, item);
    if (result.changed) await saveJob(this.env, result.job);
    item.status = 'approved';
    item.decidedBy = approval && approval.approvedBy || 'admin';
    item.decidedAt = Date.now();
    item.applied = result.changed;
    this.setState({ ...this.state, proposals: [...this.state.proposals] });
    return { applied: result.changed, conflict: false };
  }

  async onWorkflowError(workflowName, workflowId, error) {
    const proposals = (this.state.proposals || []).map(p =>
      p.workflowId === workflowId && p.status !== 'rejected'
        ? { ...p, status: 'error', error: String(error || 'workflow failed') }
        : p
    );
    this.setState({ ...this.state, proposals, lastError: String(error || 'workflow failed') });
  }
}

export class ProposalWorkflow extends AgentWorkflow {
  async run(event, step) {
    const proposal = await step.do('prepare-proposal', async () => {
      const item = await this.agent.getProposalContext(event.payload.proposalId);
      if (!item) throw new Error('proposal not found');
      return { proposalId: item.id, title: item.title, kind: item.kind };
    });
    await this.reportProgress({
      step: 'approval',
      status: 'pending',
      message: proposal.title
    });
    const approval = await this.waitForApproval(step, { timeout: '30 days' });
    const result = await step.do('apply-approved-proposal', async () =>
      this.agent.applyApprovedProposal(proposal.proposalId, approval && approval.metadata || approval)
    );
    await step.reportComplete(result);
    return result;
  }
}

async function handle(request, env) {
  const session = await sessionFor(request, env);
  if (!session || !['admin', 'pm'].includes(session.role)) return json({ error: 'unauthorized' }, 401);
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'v1' || parts[1] !== 'jobs' || !parts[2]) return json({ error: 'not found' }, 404);
  const jobId = parts[2];
  const raw = await env.RIDGELINE_KV.get('job:' + jobId);
  if (!raw) return json({ error: 'job not found' }, 404);
  const agent = await getAgentByName(env.ProjectAgent, jobId);
  if (request.method === 'GET' && parts[3] === 'state') return json(await agent.getSnapshot());
  if (request.method === 'POST' && parts[3] === 'analyze') return json(await agent.refresh(session.name || session.role));
  if (request.method === 'POST' && parts[3] === 'proposals' && parts[4] && parts[5] === 'decision') {
    const body = await request.json();
    if (!['approve', 'reject'].includes(body.decision)) return json({ error: 'decision must be approve or reject' }, 400);
    if (body.decision === 'approve' && session.role !== 'admin') return json({ error: 'admin approval required' }, 403);
    return json(await agent.decide(parts[4], body.decision, session.name || session.role, body.reason));
  }
  return json({ error: 'not found' }, 404);
}

export default {
  fetch(request, env) {
    return handle(request, env).catch(error => json({ error: error.message || 'agent error' }, 500));
  },
  async scheduled(controller, env, ctx) {
    const index = await loadJson(env, 'jobs:index', []);
    const active = index.filter(j => (j.status || 'active') === 'active').slice(0, 200);
    ctx.waitUntil(Promise.all(active.map(async job => {
      const agent = await getAgentByName(env.ProjectAgent, job.id);
      return agent.refresh('Scheduled morning review');
    })));
  }
};
