/**
 * Seeds a FICTIONAL demo organization ("Northwind Ops") with realistic data.
 * All names, emails and incidents are made up. Safe to re-run: the demo org is rebuilt from scratch.
 *   npm run seed
 */
import mongoose from 'mongoose';
import { DEFAULT_ESCALATION_RULES, DEFAULT_PRIORITY_FOR_SEVERITY, DEFAULT_SLA_TARGETS, computeDeadlines, priorityRank, severityRank } from '@opspilot/shared';
import { connectDb, disconnectDb } from '../config/db';
import { env } from '../config/env';
import { hashPassword } from '../services/auth';
import {
  AiAnalysis, Attachment, AuditLog, Comment, Incident, Invitation, Membership, Notification, Organization, SlaPolicy, Team, User,
} from '../models';

if (env.isProd) {
  console.error('Refusing to seed demo data with NODE_ENV=production.');
  process.exit(1);
}

export const DEMO_PASSWORD = 'DemoPassw0rd!';
const DEMO_SLUG = 'northwind-ops';
const people = [
  { key: 'owner', name: 'Olivia Okafor', email: 'owner@demo.opspilot.test', role: 'owner' },
  { key: 'admin', name: 'Arjun Mehta', email: 'admin@demo.opspilot.test', role: 'admin' },
  { key: 'agent', name: 'Ava Lindqvist', email: 'agent@demo.opspilot.test', role: 'agent' },
  { key: 'agent2', name: 'Mateo Silva', email: 'mateo@demo.opspilot.test', role: 'agent' },
  { key: 'agent3', name: 'Yuki Tanaka', email: 'yuki@demo.opspilot.test', role: 'agent' },
  { key: 'viewer', name: 'Vera Novak', email: 'viewer@demo.opspilot.test', role: 'viewer' },
] as const;

const templates: Array<{ title: string; description: string; category: string; severity: 'low' | 'medium' | 'high' | 'critical'; tags: string[]; team: string }> = [
  { title: 'Checkout API returning 500 errors', description: 'Customers cannot complete checkout since the 14:05 deploy. Error rate peaked at 38%.', category: 'application', severity: 'critical', tags: ['checkout', 'payments'], team: 'Platform Engineering' },
  { title: 'Primary Postgres replica lagging', description: 'Replication lag on pg-replica-2 is above 90 seconds and growing; reporting dashboards are stale.', category: 'database', severity: 'high', tags: ['postgres', 'replication'], team: 'Data Platform' },
  { title: 'VPN drops for remote staff in EU', description: 'Multiple users in Berlin and Lisbon report VPN sessions dropping every 10–15 minutes.', category: 'network', severity: 'high', tags: ['vpn', 'eu'], team: 'IT Support' },
  { title: 'Suspicious sign-ins from unknown region', description: 'Security alerts show repeated failed sign-ins for finance accounts from an unusual region.', category: 'security', severity: 'critical', tags: ['auth', 'finance'], team: 'Security' },
  { title: 'Nightly ETL job missed its window', description: 'The warehouse load finished 3 hours late; morning sales report shows yesterday’s numbers.', category: 'data', severity: 'medium', tags: ['etl', 'reporting'], team: 'Data Platform' },
  { title: 'Kubernetes node pool autoscaling stuck', description: 'Pending pods in the batch namespace; cluster autoscaler logs show quota errors.', category: 'infrastructure', severity: 'high', tags: ['kubernetes', 'quota'], team: 'Platform Engineering' },
  { title: 'Cannot reset password via SSO portal', description: 'Several employees get a blank page after clicking the reset link in the SSO portal.', category: 'access', severity: 'medium', tags: ['sso', 'password'], team: 'IT Support' },
  { title: 'Warehouse label printer offline', description: 'The Zebra printer in dock B stopped responding; shipments are being hand-labelled.', category: 'hardware', severity: 'low', tags: ['printer', 'warehouse'], team: 'IT Support' },
  { title: 'Slow image loading on product pages', description: 'CDN cache hit ratio dropped from 96% to 61% after a config change.', category: 'application', severity: 'medium', tags: ['cdn', 'performance'], team: 'Platform Engineering' },
  { title: 'Backup verification failed for object store', description: 'Weekly restore test failed for the invoices bucket; checksum mismatch on 12 objects.', category: 'data', severity: 'high', tags: ['backup', 'storage'], team: 'Data Platform' },
  { title: 'Wi-Fi coverage gap on 3rd floor', description: 'Access point AP-3F-02 is down; meeting rooms 301-304 have no coverage.', category: 'network', severity: 'low', tags: ['wifi'], team: 'IT Support' },
  { title: 'Expired TLS certificate on partner API', description: 'The partner-facing API certificate expired overnight; partner integrations are failing.', category: 'security', severity: 'critical', tags: ['tls', 'partners'], team: 'Security' },
  { title: 'Message queue backlog growing', description: 'The order-events queue has 240k unprocessed messages; consumers are restarting repeatedly.', category: 'infrastructure', severity: 'high', tags: ['queue', 'orders'], team: 'Platform Engineering' },
  { title: 'Laptop battery swelling reported', description: 'An employee reports a swollen battery on a three-year-old laptop; device taken out of service.', category: 'hardware', severity: 'medium', tags: ['laptop', 'safety'], team: 'IT Support' },
  { title: 'Search results missing recent products', description: 'Products added in the last 24 hours do not appear in site search; index sync job is failing.', category: 'application', severity: 'medium', tags: ['search', 'catalog'], team: 'Platform Engineering' },
  { title: 'Duplicate invoices generated', description: 'Finance reports 40 customers received duplicate invoices after a retry storm.', category: 'data', severity: 'medium', tags: ['billing', 'invoices'], team: 'Data Platform' },
];

async function main() {
  await connectDb();

  const existing = await Organization.findOne({ slug: DEMO_SLUG }).lean();
  if (existing) {
    const filter = { organizationId: existing._id };
    await Promise.all([Incident, Comment, Notification, AuditLog, SlaPolicy, Invitation, AiAnalysis, Attachment, Team, Membership].map((m) => (m as any).deleteMany(filter)));
    await Organization.deleteOne({ _id: existing._id });
  }
  await User.deleteMany({ email: { $in: people.map((p) => p.email) } });

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users: Record<string, InstanceType<typeof User>> = {};
  for (const p of people) users[p.key] = await User.create({ name: p.name, email: p.email, passwordHash, timezone: 'UTC' });

  const owner = users.owner!;
  const org = await Organization.create({ name: 'Northwind Ops', slug: DEMO_SLUG, createdBy: owner._id, incidentCounter: 1000 });
  for (const p of people) await Membership.create({ userId: users[p.key]!._id, organizationId: org._id, role: p.role });

  await SlaPolicy.create({ organizationId: org._id, name: 'Default SLA policy', targets: DEFAULT_SLA_TARGETS, escalationRules: DEFAULT_ESCALATION_RULES, isDefault: true, updatedBy: owner._id });

  const teamDefs: Array<[string, string, string[]]> = [
    ['Platform Engineering', 'Application platform and infrastructure', ['agent', 'agent2']],
    ['Data Platform', 'Databases, pipelines and reporting', ['agent2', 'agent3']],
    ['IT Support', 'Helpdesk, devices and network', ['agent3', 'agent']],
    ['Security', 'Security operations', ['agent', 'admin']],
  ];
  const teams: Record<string, InstanceType<typeof Team>> = {};
  for (const [name, description, members] of teamDefs) {
    teams[name] = await Team.create({ organizationId: org._id, name, description, memberIds: members.map((k) => users[k]!._id) });
  }

  const reporters = [users.agent!, users.agent2!, users.agent3!, users.admin!];
  const assignees = [users.agent!, users.agent2!, users.agent3!];
  const now = Date.now();
  const DAY = 86_400_000;
  let counter = 1000;
  const incidentsOut: Array<{ id: unknown; resolved: boolean }> = [];

  // 45 incidents over the last 30 days, mixed states.
  const total = 45;
  for (let i = 0; i < total; i++) {
    const t = templates[i % templates.length]!;
    const ageDays = Math.min(29.5, (total - i) * (30 / total) * (0.85 + ((i * 7) % 10) / 33));
    const createdAt = new Date(now - ageDays * DAY - ((i * 977) % 80) * 60_000);
    const sev = i % 11 === 0 ? 'critical' : t.severity;
    const priority = DEFAULT_PRIORITY_FOR_SEVERITY[sev];
    const target = DEFAULT_SLA_TARGETS[sev];
    const { responseDueAt, resolutionDueAt } = computeDeadlines(createdAt, target);
    const reporter = reporters[i % reporters.length]!;
    const assignee = i % 6 === 5 ? null : assignees[i % assignees.length]!;
    const team = teams[t.team]!;

    // Older incidents are mostly resolved; the newest stay active.
    const roll = (i * 37) % 100;
    let status: 'open' | 'triaged' | 'in_progress' | 'blocked' | 'resolved' | 'closed';
    if (ageDays > 12) status = roll < 55 ? 'closed' : roll < 92 ? 'resolved' : 'in_progress';
    else if (ageDays > 4) status = roll < 35 ? 'resolved' : roll < 55 ? 'in_progress' : roll < 70 ? 'blocked' : roll < 85 ? 'triaged' : 'open';
    else status = roll < 15 ? 'resolved' : roll < 40 ? 'in_progress' : roll < 55 ? 'triaged' : roll < 65 ? 'blocked' : 'open';

    const responded = status !== 'open';
    const firstRespondedAt = responded ? new Date(createdAt.getTime() + (0.25 + ((i * 13) % 17) / 10) * target.responseMinutes * 60_000) : null;
    const isDone = status === 'resolved' || status === 'closed';
    const resolveFactor = (i % 4 === 3 ? 1.35 : 0.3 + ((i * 17) % 60) / 100); // some breach their SLA
    const resolvedAt = isDone ? new Date(createdAt.getTime() + resolveFactor * target.resolutionMinutes * 60_000) : null;

    const number = ++counter;
    const inc = await Incident.collection.insertOne({
      organizationId: org._id,
      number,
      title: t.title,
      description: t.description,
      category: t.category,
      severity: sev,
      priority,
      severityRank: severityRank(sev),
      priorityRank: priorityRank(priority),
      status,
      reporterId: reporter._id,
      assigneeId: assignee?._id ?? null,
      teamId: team._id,
      tags: t.tags,
      sla: { responseDueAt, resolutionDueAt, firstRespondedAt, alertsSent: [] },
      resolutionSummary: isDone ? 'Root cause identified and fixed; monitoring confirms normal behaviour.' : null,
      resolvedAt,
      closedAt: status === 'closed' && resolvedAt ? new Date(resolvedAt.getTime() + 3_600_000) : null,
      reopenCount: 0,
      createdAt,
      updatedAt: resolvedAt ?? firstRespondedAt ?? createdAt,
    });
    incidentsOut.push({ id: inc.insertedId, resolved: isDone });

    const audit = [
      { action: 'incident.created', at: createdAt, actor: reporter._id, metadata: { key: `INC-${number}`, severity: sev, category: t.category } },
    ];
    if (assignee) audit.push({ action: 'incident.assigned', at: new Date(createdAt.getTime() + 120_000), actor: users.admin!._id, metadata: { to: String(assignee._id), toName: (assignee as any).name } as any });
    if (firstRespondedAt) audit.push({ action: 'incident.status_changed', at: firstRespondedAt, actor: (assignee ?? users.agent!)._id, metadata: { from: 'open', to: status === 'blocked' ? 'blocked' : 'in_progress' } as any });
    if (resolvedAt) audit.push({ action: 'incident.status_changed', at: resolvedAt, actor: (assignee ?? users.agent!)._id, metadata: { from: 'in_progress', to: 'resolved' } as any });
    await AuditLog.collection.insertMany(
      audit.map((a) => ({ organizationId: org._id, actorId: a.actor, action: a.action, entityType: 'incident', entityId: String(inc.insertedId), metadata: a.metadata, ip: null, requestId: null, createdAt: a.at })),
    );

    if (i % 3 === 0 && firstRespondedAt) {
      await Comment.collection.insertMany([
        { organizationId: org._id, incidentId: inc.insertedId, authorId: (assignee ?? users.agent!)._id, body: 'Looking into this now. Initial findings point to the most recent change.', internal: false, createdAt: new Date(firstRespondedAt.getTime() + 60_000), updatedAt: new Date() },
        { organizationId: org._id, incidentId: inc.insertedId, authorId: (assignee ?? users.agent!)._id, body: 'Internal: checked dashboards, correlates with the 14:05 deploy. Preparing rollback.', internal: true, createdAt: new Date(firstRespondedAt.getTime() + 180_000), updatedAt: new Date() },
      ]);
    }
  }
  await Organization.updateOne({ _id: org._id }, { $set: { incidentCounter: counter } });

  // Notifications for the demo agent
  const open = await Incident.find({ organizationId: org._id, assigneeId: users.agent!._id, status: { $nin: ['resolved', 'closed'] } }).limit(4).lean();
  for (const inc of open) {
    await Notification.create({ organizationId: org._id, userId: users.agent!._id, type: 'incident_assigned', title: `INC-${inc.number} assigned to you`, body: inc.title, incidentId: inc._id, dedupeKey: `seed:assigned:${inc._id}` });
  }
  await Notification.create({ organizationId: org._id, userId: users.agent!._id, type: 'system', title: 'Welcome to OpsPilot AI', body: 'This is fictional demonstration data.', dedupeKey: 'seed:welcome:agent' });

  await AuditLog.create({ organizationId: org._id, actorId: owner._id, action: 'organization.created', entityType: 'organization', entityId: String(org._id), metadata: { name: org.name } });

  console.log('\nSeeded fictional demo organization "Northwind Ops"');
  console.log(`  incidents: ${total}   teams: ${teamDefs.length}   members: ${people.length}`);
  console.log('\nDemo logins (password for all: ' + DEMO_PASSWORD + ')');
  for (const p of people) console.log(`  ${p.role.padEnd(7)} ${p.email}`);
  console.log('');
  await disconnectDb();
  await mongoose.disconnect().catch(() => undefined);
}

main().catch(async (err) => {
  console.error(err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
