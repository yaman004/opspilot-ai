import type { Category, Severity } from '@opspilot/shared';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';

export interface AiPrompt {
  system: string;
  user: string;
  /** Names of the organization's teams, so the model can only suggest ones that exist. */
  teamNames: string[];
  title: string;
  description: string;
}

export interface AiProvider {
  /** 'mock' | 'anthropic' | 'openai' */
  readonly name: string;
  readonly model: string;
  /** True only for the built-in heuristic provider. Surfaced everywhere the result is shown. */
  readonly isMock: boolean;
  /** Returns the model's raw text. Validation happens in the orchestrator, never here. */
  complete(prompt: AiPrompt, signal: AbortSignal): Promise<string>;
}

/** Typed failure used by the orchestrator to decide whether a retry makes sense. */
export class AiError extends AppError {
  constructor(
    status: number,
    code: string,
    message: string,
    public readonly retryable = false,
    public readonly retryAfterMs?: number,
  ) {
    super(status, code, message);
    this.name = 'AiError';
  }
}

export function errorForHttpStatus(status: number, retryAfterHeader?: string | null): AiError {
  const retryAfterMs = retryAfterHeader && !Number.isNaN(Number(retryAfterHeader)) ? Number(retryAfterHeader) * 1000 : undefined;
  if (status === 429) return new AiError(429, 'AI_RATE_LIMITED', 'The AI provider is rate limiting requests. Try again shortly.', true, retryAfterMs);
  if (status === 401 || status === 403) {
    // Deliberately vague: never echo provider error bodies that could contain key fragments.
    return new AiError(502, 'AI_AUTH_ERROR', 'The AI provider rejected the configured credentials. Contact an administrator.');
  }
  if (status >= 500) return new AiError(502, 'AI_UPSTREAM_ERROR', 'The AI provider is temporarily unavailable.', true);
  return new AiError(502, 'AI_REQUEST_REJECTED', `The AI provider rejected the request (HTTP ${status}).`);
}

type FetchLike = typeof fetch;

async function postJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal) {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new AiError(504, 'AI_TIMEOUT', 'The AI provider took too long to respond.', true);
    throw new AiError(502, 'AI_NETWORK_ERROR', 'Could not reach the AI provider.', true);
  }
  if (!res.ok) throw errorForHttpStatus(res.status, res.headers.get('retry-after'));
  try {
    return (await res.json()) as any;
  } catch {
    throw new AiError(502, 'AI_INVALID_RESPONSE', 'The AI provider returned an unreadable response.');
  }
}

export function createAnthropicProvider(fetchImpl: FetchLike = fetch): AiProvider {
  const model = env.AI_MODEL ?? 'claude-sonnet-5-5';
  const base = (env.AI_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '');
  return {
    name: 'anthropic',
    model,
    isMock: false,
    async complete(prompt, signal) {
      const json = await postJson(
        fetchImpl,
        `${base}/v1/messages`,
        { 'x-api-key': env.AI_API_KEY as string, 'anthropic-version': '2023-06-01' },
        { model, max_tokens: 1200, temperature: 0.2, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] },
        signal,
      );
      const text = Array.isArray(json?.content)
        ? json.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('')
        : '';
      if (!text) throw new AiError(502, 'AI_INVALID_RESPONSE', 'The AI provider returned an empty response.');
      return text;
    },
  };
}

/** Works with OpenAI and any OpenAI-compatible endpoint (set AI_BASE_URL). */
export function createOpenAiProvider(fetchImpl: FetchLike = fetch): AiProvider {
  const model = env.AI_MODEL ?? 'gpt-4o-mini';
  const base = (env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  return {
    name: 'openai',
    model,
    isMock: false,
    async complete(prompt, signal) {
      const json = await postJson(
        fetchImpl,
        `${base}/chat/completions`,
        { authorization: `Bearer ${env.AI_API_KEY}` },
        {
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
        },
        signal,
      );
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text) throw new AiError(502, 'AI_INVALID_RESPONSE', 'The AI provider returned an empty response.');
      return text;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Mock provider — a keyword heuristic. It is NOT an AI model.          */
/* ------------------------------------------------------------------ */

const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  database: ['database', ' db ', 'postgres', 'mysql', 'mongo', 'replication', 'deadlock', 'sql', 'query', 'redis'],
  network: ['network', 'vpn', 'dns', 'latency', 'packet', 'router', 'switch', 'wifi', 'wi-fi', 'bandwidth', 'connectivity'],
  security: ['breach', 'phishing', 'malware', 'ransomware', 'unauthorized', 'suspicious', 'vulnerab', 'leak', 'compromised', 'attack'],
  infrastructure: ['server', 'cpu', 'memory', 'disk', 'kubernetes', 'pod', 'cluster', 'host', 'instance', 'load balancer', 'outage'],
  application: ['error', 'exception', 'crash', 'bug', '500', 'deploy', 'release', 'api', 'timeout', 'checkout', 'page'],
  access: ['login', 'log in', 'password', 'permission', 'access', 'sso', 'mfa', 'locked out', 'account'],
  data: ['report', 'pipeline', 'etl', 'missing records', 'corrupt', 'dashboard data', 'export', 'sync'],
  hardware: ['laptop', 'printer', 'monitor', 'keyboard', 'device', 'battery', 'headset', 'scanner'],
  other: [],
};

const TEAM_HINTS: Record<Category, string[]> = {
  database: ['data', 'db', 'database', 'platform'],
  network: ['network', 'infra', 'platform'],
  security: ['security', 'sec'],
  infrastructure: ['infra', 'platform', 'sre', 'devops', 'ops'],
  application: ['app', 'engineering', 'product', 'dev'],
  access: ['it', 'support', 'security', 'helpdesk'],
  data: ['data', 'analytics'],
  hardware: ['it', 'support', 'helpdesk'],
  other: ['support', 'ops'],
};

const QUESTIONS: Record<Category, string[]> = {
  database: ['When did the slowdown or failure begin, and did a deploy or migration precede it?', 'Is it affecting reads, writes, or both?', 'Are there recent changes in query volume or connection counts?'],
  network: ['Which sites, regions or users are affected?', 'Is the problem constant or intermittent?', 'Did any network or firewall change go out recently?'],
  security: ['What indicators of compromise have been observed?', 'Which accounts, hosts or data may be exposed?', 'Has the affected system been isolated yet?'],
  infrastructure: ['Which hosts, pods or services are affected?', 'What do CPU, memory and disk metrics show over the last hour?', 'Was there a recent scaling or configuration change?'],
  application: ['What is the exact error message or HTTP status users see?', 'Which release or feature flag changed most recently?', 'Can the issue be reproduced, and on which environments?'],
  access: ['Which user(s) and which application are affected?', 'What error is shown at sign-in?', 'Were there recent password, MFA or permission changes?'],
  data: ['Which dataset or report is wrong, and since when?', 'Did an upstream pipeline or schema change?', 'How many records are affected?'],
  hardware: ['What is the device model and asset tag?', 'Does the problem persist after a restart?', 'Is there visible damage or error indication?'],
  other: ['Who is affected and how many people?', 'When did the problem start?', 'What has already been tried?'],
};

const STEPS: Record<Category, string[]> = {
  database: ['Check database health, slow-query logs and connection pool saturation.', 'Review recent migrations and deploys for the affected service.', 'Fail over or add capacity only after confirming the bottleneck.'],
  network: ['Run traceroute/ping from an affected location and a healthy one.', 'Inspect interface error counters and recent firewall/DNS changes.', 'Check provider status pages for upstream issues.'],
  security: ['Isolate the affected account or host and preserve logs.', 'Rotate potentially exposed credentials.', 'Notify the security lead and start an evidence log.'],
  infrastructure: ['Inspect host/pod metrics and recent events for restarts or evictions.', 'Review the last configuration or scaling change and roll back if correlated.', 'Check load balancer health checks.'],
  application: ['Collect error traces and correlate with the latest deploy.', 'Disable the most recent feature flag or roll back the release if correlated.', 'Reproduce in staging with the reporter’s steps.'],
  access: ['Verify the account status and recent authentication logs.', 'Check group/role membership against the expected access.', 'Reset the credential or MFA enrollment if appropriate.'],
  data: ['Compare source and destination row counts for the affected window.', 'Review the last pipeline run logs and schema changes.', 'Backfill after the root cause is fixed.'],
  hardware: ['Restart the device and reseat connections.', 'Swap with a known-good unit to isolate the fault.', 'Open a vendor/warranty ticket if confirmed faulty.'],
  other: ['Gather a precise timeline and affected user list.', 'Identify an owner and set an update cadence.', 'Document findings in the incident notes.'],
};

const CRITICAL = ['outage', 'is down', 'are down', 'all users', 'data loss', 'breach', 'ransomware', 'production down', 'cannot process payments', 'completely'];
const HIGH = ['major', 'many users', 'multiple users', 'failing', 'degraded', 'unable to', 'cannot', "can't", 'payment', 'checkout', 'urgent'];
const LOW = ['minor', 'cosmetic', 'typo', 'question', 'request', 'how do i', 'nice to have'];

export function mockAnalyze(title: string, description: string, teamNames: string[]) {
  const text = ` ${title} ${description} `.toLowerCase();
  const scores = (Object.keys(CATEGORY_KEYWORDS) as Category[]).map((c) => ({
    c,
    n: CATEGORY_KEYWORDS[c].filter((k) => text.includes(k)).length,
  }));
  scores.sort((a, b) => b.n - a.n);
  const top = scores[0] as { c: Category; n: number };
  const category: Category = top.n > 0 ? top.c : 'other';

  const has = (list: string[]) => list.some((k) => text.includes(k));
  const severity: Severity = has(CRITICAL) ? 'critical' : has(HIGH) ? 'high' : has(LOW) ? 'low' : 'medium';
  const priority = ({ critical: 'urgent', high: 'high', medium: 'medium', low: 'low' } as const)[severity];

  const hints = TEAM_HINTS[category];
  const team = teamNames.find((t) => hints.some((h) => t.toLowerCase().includes(h))) ?? null;
  const firstSentence = description.split(/(?<=[.!?])\s/)[0]?.trim() ?? description;
  return {
    category,
    severity,
    priority,
    suggestedTeam: team,
    summary: `Looks like a ${category} issue: ${firstSentence}`.slice(0, 590),
    diagnosticQuestions: QUESTIONS[category],
    troubleshootingSteps: STEPS[category],
    // Keyword matching is weak evidence; the confidence is capped accordingly.
    confidence: Math.min(0.6, 0.25 + top.n * 0.1),
  };
}

export function createMockProvider(): AiProvider {
  return {
    name: 'mock',
    model: 'mock-keyword-heuristic-v1',
    isMock: true,
    async complete(prompt) {
      return JSON.stringify(mockAnalyze(prompt.title, prompt.description, prompt.teamNames));
    },
  };
}
