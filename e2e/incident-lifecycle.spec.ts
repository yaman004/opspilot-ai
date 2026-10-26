import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'DemoPassw0rd!';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Good (morning|afternoon|evening)/ })).toBeVisible();
}

async function stat(page: Page, name: string): Promise<number> {
  const value = page.locator('dl > a, dl > div', { hasText: name }).first().locator('dd');
  // The figure is a skeleton until the metrics request resolves; wait for a real number before reading it.
  await expect(value).toHaveText(/^\d+$/);
  return Number((await value.innerText()).trim());
}

test('unauthenticated visitors are sent to sign in', async ({ page }) => {
  await page.goto('/app/incidents');
  await expect(page).toHaveURL(/\/login/);
});

test('rejects a wrong password with a clear message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@demo.opspilot.test');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('full incident lifecycle: create, triage, assign, comment, resolve, verify history and dashboard', async ({ page }) => {
  const title = `E2E checkout database timeout ${Date.now()}`;
  await login(page, 'admin@demo.opspilot.test');

  const openBefore = await stat(page, 'Open incidents');

  /* ---- create, with triage suggestions applied to the form ---- */
  await page.getByRole('link', { name: 'New incident' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill(
    'Customers see 500 errors at checkout. The primary database connection pool is exhausted and queries are timing out since the last deploy.',
  );
  await page.getByRole('button', { name: 'Suggest triage' }).click();
  const triage = page.getByRole('complementary', { name: 'AI triage' });
  await expect(triage.getByText('Mock provider').first()).toBeVisible();
  await triage.getByRole('button', { name: /Apply to form/ }).click();
  await page.getByRole('button', { name: 'Create incident' }).click();

  await expect(page).toHaveURL(/\/app\/incidents\/[a-f0-9]{24}$/);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const key = (await page.getByText(/^Incidents \/ /).innerText()).replace('Incidents / ', '').trim();
  expect(key).toMatch(/^[A-Z]+-\d+$/);
  await expect(page.getByText('Open', { exact: true }).first()).toBeVisible();

  /* ---- run triage on the saved incident and apply it ---- */
  await page.getByRole('tab', { name: 'AI triage' }).click();
  await page.getByRole('button', { name: 'Run triage' }).click();
  await expect(page.getByText('Mock provider').first()).toBeVisible();
  await page.getByRole('button', { name: /Apply selected/ }).click();
  await expect(page.getByText(/Already applied:/)).toBeVisible();

  /* ---- assign ---- */
  const assignee = page.getByLabel('Assignee');
  const firstAgent = assignee.locator('option:not([value=""])').first();
  const agentName = (await firstAgent.innerText()).trim();
  await assignee.selectOption({ label: agentName });
  await expect(assignee).toHaveValue(/[a-f0-9]{24}/);

  /* ---- comment ---- */
  await page.getByRole('tab', { name: 'Comments' }).click();
  await page.getByLabel('Add a comment').fill('Connection pool maxed out; rolling back the deploy.');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(page.getByText('Connection pool maxed out; rolling back the deploy.')).toBeVisible();

  /* ---- status changes ---- */
  await page.getByRole('button', { name: 'Start work' }).click();
  await expect(page.getByText('In progress', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await page.getByLabel('How was it resolved?').fill('Rolled back the deploy and raised the pool size.');
  await page.getByRole('button', { name: 'Resolve incident' }).click();
  await expect(page.getByText('Resolved', { exact: true }).first()).toBeVisible();

  /* ---- history shows every step ---- */
  await page.getByRole('tab', { name: 'Activity' }).click();
  const activity = page.getByRole('tabpanel');
  await expect(activity).toContainText(/created/i);
  await expect(activity).toContainText(/assigned/i);
  await expect(activity).toContainText(/comment/i);
  await expect(activity).toContainText(/resolved/i);

  /* ---- audit log records it ---- */
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
  await expect(page.getByRole('cell', { name: new RegExp(key) }).first()).toBeVisible();

  /* ---- dashboard reflects it: created then resolved, so the open count is unchanged ---- */
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Good/ })).toBeVisible();
  await expect.poll(() => stat(page, 'Open incidents')).toBe(openBefore);
});

test('viewers can read but not create or change incidents', async ({ page }) => {
  await login(page, 'viewer@demo.opspilot.test');
  await expect(page.getByRole('link', { name: 'New incident' })).toHaveCount(0);
  await page.goto('/app/incidents/new');
  await expect(page.getByText(/don.t have access/i).first()).toBeVisible();
});
