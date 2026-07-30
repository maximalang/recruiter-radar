import { execFile, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { get as httpsGet } from 'node:https'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

import pg from 'pg'
import { chromium } from 'playwright'

const { Client } = pg
const execFileAsync = promisify(execFile)
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.')
}
if (process.env.AUTH_V2_DISPOSABLE_DB_CONFIRMED !== 'true') {
  throw new Error(
    'AUTH_V2_DISPOSABLE_DB_CONFIRMED=true is required before creating a disposable database.',
  )
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const webRoot = resolve(root, 'apps', 'web')
const migrateScript = resolve(root, 'packages', 'db', 'scripts', 'migrate.mjs')
const nextScript = resolve(root, 'node_modules', 'next', 'dist', 'bin', 'next')
const artifactsDirectory = resolve(webRoot, 'scripts')
const e2eDistName = `.next-auth-v2-e2e-${process.pid}`
const e2eDistDirectory = resolve(webRoot, e2eDistName)
const e2eTsconfigName = `.auth-v2-e2e-tsconfig-${process.pid}.json`
const e2eTsconfigPath = resolve(webRoot, e2eTsconfigName)
const sourceTsconfigPath = resolve(webRoot, 'tsconfig.json')
const nextEnvPath = resolve(webRoot, 'next-env.d.ts')
const reportPath = resolve(
  artifactsDirectory,
  'auth-v2-account-team-e2e-report.json',
)
const databaseName =
  `auth_v2_e2e_account_team_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`
temporaryUrl.searchParams.delete('schema')

const outboxDirectory = await mkdtemp(
  join(tmpdir(), 'rr-auth-v2-account-team-e2e-'),
)
const outboxPath = join(outboxDirectory, 'outbox.json')
const httpsKeyPath = join(outboxDirectory, 'localhost-key.pem')
const httpsCertPath = join(outboxDirectory, 'localhost-cert.pem')
const admin = new Client({ connectionString: databaseUrl })
let database = null
let databaseCreated = false
let browser = null
let webServer = null
let webServerPort = null
let webServerListenerPid = null
let failure = null
let originalNextEnv = null
const serverOutput = []
const report = {
  database: databaseName,
  browser: 'isolated Playwright Chromium',
  consoleFindings: [],
  networkFindings: [],
  expectedBrowserEvents: [],
  accessibility: {},
  responsive: {},
  flows: {},
  screenshots: {},
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertSafeE2EDistDirectory() {
  assert(
    relative(webRoot, e2eDistDirectory) === e2eDistName,
    'Refusing to remove an E2E cache outside apps/web.',
  )
}

function assertSafeOutboxDirectory() {
  const relativePath = relative(tmpdir(), outboxDirectory)
  assert(
    relativePath.startsWith('rr-auth-v2-account-team-e2e-')
      && !relativePath.includes('/')
      && !relativePath.includes('\\'),
    'Refusing to remove an E2E outbox outside the system temp directory.',
  )
}

function recordCleanupFailure(error) {
  if (failure) return
  failure = error
  report.result = 'failed'
  report.failure = error instanceof Error ? error.message : String(error)
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function opaqueToken() {
  return randomBytes(32).toString('hex')
}

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(
    address && typeof address === 'object',
    'Failed to reserve a local browser-test port.',
  )
  await new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose())
  })
  return address.port
}

async function run(command, args, environment) {
  const result = await execFileAsync(command, args, {
    cwd: root,
    env: environment,
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

async function createHttpsCertificate() {
  const configured = process.env.OPENSSL_PATH?.trim()
  const candidates = [
    configured || null,
    'openssl',
    ...(process.platform === 'win32'
      ? [
        'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
        'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
      ]
      : []),
  ].filter(Boolean)
  let lastError = null
  for (const candidate of candidates) {
    try {
      await execFileAsync(
        candidate,
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-sha256',
          '-nodes',
          '-keyout',
          httpsKeyPath,
          '-out',
          httpsCertPath,
          '-days',
          '1',
          '-subj',
          '/CN=127.0.0.1',
          '-addext',
          'subjectAltName=IP:127.0.0.1,DNS:localhost',
        ],
        { windowsHide: true, maxBuffer: 1024 * 1024 },
      )
      return
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(
    `OpenSSL is required for the local HTTPS browser gate: ${
      lastError instanceof Error ? lastError.message : 'not found'
    }`,
  )
}

async function createUser(prefix) {
  const email = `${prefix}-${process.pid}-${Date.now()}@example.invalid`
  const result = await database.query(
    `INSERT INTO users (
       email,
       email_normalized,
       email_verified_at,
       display_name,
       created_at,
       updated_at,
       last_authenticated_at
     )
     VALUES ($1, $1, NOW(), $2, NOW(), NOW(), NOW())
     RETURNING id::TEXT AS id`,
    [email, `${prefix} account`],
  )
  const userId = result.rows[0]?.id
  assert(userId, `Failed to create ${prefix} user fixture.`)
  const workspaceResult = await database.query(
    'SELECT ensure_auth_user_workspace($1)::TEXT AS id',
    [userId],
  )
  const workspaceId = workspaceResult.rows[0]?.id
  assert(workspaceId, `Failed to create ${prefix} workspace fixture.`)
  return { email, userId, workspaceId }
}

async function createSession(user, labels) {
  const token = opaqueToken()
  const result = await database.query(
    `INSERT INTO auth_sessions (
       user_id,
       workspace_id,
       token_hash,
       auth_method,
       device_label,
       browser_label,
       environment_label,
       created_at,
       last_seen_at,
       idle_expires_at,
       absolute_expires_at,
       rotated_at,
       last_authenticated_at
     )
     VALUES (
       $1,
       $2,
       $3,
       'magic_link',
       $4,
       $5,
       $6,
       NOW() - INTERVAL '2 minutes',
       NOW() - INTERVAL '1 minute',
       NOW() + INTERVAL '13 days',
       NOW() + INTERVAL '29 days',
       NOW() - INTERVAL '1 minute',
       NOW() - INTERVAL '1 minute'
     )
     RETURNING id::TEXT AS id`,
    [
      user.userId,
      user.workspaceId,
      hashToken(token),
      labels.device,
      labels.browser,
      labels.environment,
    ],
  )
  const id = result.rows[0]?.id
  assert(id, `Failed to create session for ${user.email}.`)
  return { id, token }
}

async function seedFixtures() {
  const owner = await createUser('owner')
  const invited = await createUser('invited')
  const wrong = await createUser('wrong')
  await database.query(
    `UPDATE workspaces
     SET name = 'Signal Bureau', updated_at = NOW()
     WHERE id = $1`,
    [owner.workspaceId],
  )
  owner.session = await createSession(owner, {
    device: 'Owner workstation',
    browser: 'Chromium',
    environment: 'Windows 11',
  })
  owner.otherSession = await createSession(owner, {
    device: 'Owner phone',
    browser: 'Mobile browser',
    environment: 'Android',
  })
  invited.session = await createSession(invited, {
    device: 'Invitee workstation',
    browser: 'Chromium',
    environment: 'Linux',
  })
  wrong.session = await createSession(wrong, {
    device: 'Unrelated workstation',
    browser: 'Chromium',
    environment: 'Windows 11',
  })
  return { owner, invited, wrong }
}

async function waitForWebServer(baseUrl) {
  const deadline = Date.now() + 90_000
  let lastError = null
  while (Date.now() < deadline) {
    if (webServer && webServer.exitCode !== null) {
      throw new Error(
        `Next.js exited before readiness: ${serverOutput.slice(-5).join('')}`,
      )
    }
    try {
      const status = await new Promise((resolveStatus, reject) => {
        const request = httpsGet(
          `${baseUrl}/login`,
          { rejectUnauthorized: false },
          (response) => {
            response.resume()
            resolveStatus(response.statusCode ?? 0)
          },
        )
        request.setTimeout(5_000, () => {
          request.destroy(new Error('HTTPS readiness probe timed out.'))
        })
        request.once('error', reject)
      })
      if (status > 0 && status < 500) return
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  throw new Error(
    `Next.js did not become ready: ${
      lastError instanceof Error ? lastError.message : 'timeout'
    }`,
  )
}

async function findWindowsListenerPid(port) {
  if (process.platform !== 'win32' || !Number.isInteger(port)) return null
  const script = [
    `$connection = Get-NetTCPConnection -State Listen -LocalPort ${port}`,
    '-ErrorAction SilentlyContinue | Select-Object -First 1;',
    'if ($connection) { $connection.OwningProcess }',
  ].join(' ')
  const result = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  ).catch(() => null)
  const value = result?.stdout?.trim() ?? ''
  return /^[1-9]\d*$/.test(value) ? Number(value) : null
}

function captureServerOutput(stream, label) {
  stream?.setEncoding('utf8')
  stream?.on('data', (chunk) => {
    serverOutput.push(`[${label}] ${chunk}`)
    if (serverOutput.length > 200) serverOutput.shift()
  })
}

async function stopWebServer() {
  if (!webServer) return
  if (process.platform === 'win32') {
    const listenerPid = webServerListenerPid
      ?? await findWindowsListenerPid(webServerPort)
    const pids = new Set([listenerPid, webServer.pid].filter(Boolean))
    for (const pid of pids) {
      await execFileAsync(
        'taskkill',
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true },
      ).catch(() => undefined)
    }
  } else if (webServer.exitCode === null) {
    webServer.kill('SIGTERM')
  }
  if (webServer.exitCode === null) {
    await Promise.race([
      new Promise((resolveExit) => webServer.once('exit', resolveExit)),
      delay(5_000),
    ])
  }
  if (webServer.exitCode === null) webServer.kill('SIGKILL')
}

function observePage(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      if (
        label === 'wrong-email'
        && message.type() === 'error'
        && message.text().includes('status of 403 (Forbidden)')
      ) {
        report.expectedBrowserEvents.push({
          page: label,
          type: 'expected-403-console',
        })
        return
      }
      report.consoleFindings.push({
        page: label,
        type: message.type(),
        text: message.text(),
      })
    }
  })
  page.on('pageerror', (error) => {
    report.consoleFindings.push({
      page: label,
      type: 'pageerror',
      text: error.message,
    })
  })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (
      (url.protocol === 'http:' || url.protocol === 'https:')
      && url.hostname !== new URL(baseUrl).hostname
    ) {
      report.networkFindings.push({
        page: label,
        type: 'external-request',
        url: request.url(),
      })
    }
  })
  page.on('requestfailed', (request) => {
    if (
      request.failure()?.errorText === 'net::ERR_ABORTED'
      && new URL(request.url()).origin === new URL(baseUrl).origin
    ) {
      report.expectedBrowserEvents.push({
        page: label,
        type: 'same-origin-navigation-abort',
        pathname: new URL(request.url()).pathname,
      })
      return
    }
    report.networkFindings.push({
      page: label,
      type: 'request-failed',
      url: request.url(),
      error: request.failure()?.errorText ?? 'unknown',
    })
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      if (
        label === 'wrong-email'
        && response.status() === 403
        && new URL(response.url()).pathname === '/api/auth/invite/accept'
      ) {
        report.expectedBrowserEvents.push({
          page: label,
          type: 'expected-email-mismatch',
          status: response.status(),
        })
        return
      }
      report.networkFindings.push({
        page: label,
        type: 'http-error',
        url: response.url(),
        status: response.status(),
      })
    }
  })
}

async function authenticatedContext(token, viewport) {
  const context = await browser.newContext({
    viewport,
    locale: 'ru-RU',
    colorScheme: 'light',
    ignoreHTTPSErrors: true,
  })
  await context.addCookies([{
    name: '__Host-rr_session',
    value: token,
    url: baseUrl,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  }])
  return context
}

async function inspectSurface(page, key, pathname, screenshotName) {
  await page.goto(`${baseUrl}${pathname}`, { waitUntil: 'domcontentloaded' })
  await page.locator('main').waitFor({ state: 'visible' })
  await page.locator('#__next-route-announcer__').waitFor({
    state: 'attached',
  })
  assert(
    new URL(page.url()).pathname === pathname,
    `${pathname} redirected away from the authenticated surface.`,
  )
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  assert(overflow <= 0, `${pathname} overflows horizontally by ${overflow}px.`)
  const unlabeledControls = await page.evaluate(() => {
    const visible = (element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0
      )
    }
    return [...document.querySelectorAll('button, input, select, textarea')]
      .filter((element) => {
        if (
          element instanceof HTMLInputElement
          && element.type === 'hidden'
        ) return false
        if (!visible(element)) return false
        const labelledBy = element.getAttribute('aria-labelledby')
        const labelledByText = labelledBy
          ? labelledBy.split(/\s+/).every((id) =>
            document.getElementById(id)?.textContent?.trim())
          : false
        const label = element instanceof HTMLElement
          ? element.closest('label')
          : null
        return !(
          element.getAttribute('aria-label')?.trim()
          || labelledByText
          || label?.textContent?.trim()
          || element.textContent?.trim()
        )
      })
      .map((element) => element.outerHTML.slice(0, 180))
  })
  assert(
    unlabeledControls.length === 0,
    `${pathname} has unlabeled visible controls: ${unlabeledControls.join(', ')}`,
  )
  const aria = await page.locator('body').ariaSnapshot()
  assert(
    aria.includes('heading') && aria.includes('button'),
    `${pathname} accessibility snapshot is missing expected semantics.`,
  )
  await page.keyboard.press('Tab')
  const focusMoved = await page.evaluate(
    () => document.activeElement !== document.body,
  )
  assert(focusMoved, `${pathname} did not expose a keyboard focus target.`)
  const screenshotPath = resolve(artifactsDirectory, screenshotName)
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    caret: 'initial',
  })
  report.accessibility[key] = {
    labelledControls: true,
    ariaSnapshotLines: aria.split('\n').length,
    keyboardFocus: true,
  }
  report.responsive[key] = {
    viewport: page.viewportSize(),
    overflowPixels: overflow,
  }
  report.screenshots[key] = screenshotPath
}

async function waitForOutboxToken(email, pathname) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const messages = JSON.parse(await readFile(outboxPath, 'utf8'))
      const message = [...messages].reverse().find(
        (entry) => entry.to === email && entry.text.includes(pathname),
      )
      const token = message?.text.match(/#([a-f0-9]{64})(?:\s|$)/)?.[1]
      if (token) return token
    } catch (error) {
      if (
        !error
        || typeof error !== 'object'
        || !('code' in error)
        || error.code !== 'ENOENT'
      ) {
        throw error
      }
    }
    await delay(100)
  }
  throw new Error(`Token for ${pathname} was not recorded for ${email}.`)
}

async function openPendingAction(page, fragmentPath, token, preparePath) {
  const [prepareResponse] = await Promise.all([
    page.waitForResponse((response) =>
      new URL(response.url()).pathname === preparePath),
    page.goto(`${baseUrl}${fragmentPath}${token}`, {
      waitUntil: 'domcontentloaded',
    }),
  ])
  assert(
    prepareResponse.status() === 200,
    `${preparePath} returned ${prepareResponse.status()}.`,
  )
  await page.waitForFunction(() => window.location.hash === '')
  const button = page.locator(
    'section[aria-labelledby="pending-action-title"] button:not([disabled])',
  )
  await button.waitFor({ state: 'visible' })
  return button
}

async function sessionState(id) {
  const result = await database.query(
    `SELECT revoked_at IS NOT NULL AS revoked
     FROM auth_sessions
     WHERE id = $1`,
    [id],
  )
  assert(result.rowCount === 1, `Session ${id} was not found.`)
  return result.rows[0]
}

async function userEmail(userId) {
  const result = await database.query(
    'SELECT email FROM users WHERE id = $1',
    [userId],
  )
  return result.rows[0]?.email
}

async function membershipState(workspaceId, userId) {
  const result = await database.query(
    `SELECT role, status
     FROM workspace_members
     WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId],
  )
  return result.rows[0] ?? null
}

async function verifyOwnershipTransfer(owner, invited) {
  const memberships = await database.query(
    `SELECT user_id::TEXT AS "userId", role, status
     FROM workspace_members
     WHERE workspace_id = $1
       AND user_id IN ($2, $3)
     ORDER BY user_id`,
    [owner.workspaceId, owner.userId, invited.userId],
  )
  const roles = Object.fromEntries(
    memberships.rows.map((row) => [row.userId, row.role]),
  )
  const audit = await database.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM auth_security_events
     WHERE event_type = 'ownership_transferred'
       AND workspace_id = $1
       AND user_id = $2
       AND target_user_id = $3`,
    [owner.workspaceId, owner.userId, invited.userId],
  )
  assert(roles[owner.userId] === 'admin', 'Previous owner was not demoted.')
  assert(roles[invited.userId] === 'owner', 'New owner was not promoted.')
  assert(audit.rows[0]?.count === 1, 'Ownership transfer audit is not unique.')
  assert(
    (await sessionState(owner.session.id)).revoked === true,
    'Ownership transfer did not revoke the previous owner session.',
  )
  return { roles, auditCount: audit.rows[0].count }
}

async function restoreNextEnv() {
  if (originalNextEnv === null) return
  const current = await readFile(nextEnvPath, 'utf8')
  if (current === originalNextEnv) return
  const generatedRouteReference =
    `import "./${e2eDistName}/dev/types/routes.d.ts";`
  const originalRouteReference = originalNextEnv.match(
    /^import ".+\/types\/routes\.d\.ts";$/m,
  )?.[0]
  assert(
    originalRouteReference,
    'Original next-env.d.ts route reference was not recognized.',
  )
  const sanitized = current.replace(
    generatedRouteReference,
    originalRouteReference,
  )
  assert(
    sanitized.replaceAll('\r\n', '\n')
      === originalNextEnv.replaceAll('\r\n', '\n'),
    'next-env.d.ts changed outside the E2E-generated route reference.',
  )
  await writeFile(nextEnvPath, originalNextEnv, 'utf8')
}

let baseUrl = ''

try {
  await admin.connect()
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
  databaseCreated = true

  const port = await freePort()
  webServerPort = port
  baseUrl = `https://127.0.0.1:${port}`
  const sourceTsconfig = await readFile(sourceTsconfigPath, 'utf8')
  originalNextEnv = await readFile(nextEnvPath, 'utf8')
  await writeFile(e2eTsconfigPath, sourceTsconfig, 'utf8')
  await createHttpsCertificate()
  const testEnvironment = {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: temporaryUrl.toString(),
    AUTH_PLATFORM_V2_ENABLED: 'true',
    AUTH_WORKSPACES_V2_ENABLED: 'true',
    AUTH_ONBOARDING_V2_ENABLED: 'true',
    AUTH_SITE_URL: baseUrl,
    AUTH_RATE_LIMIT_SECRET:
      'auth-v2-account-team-e2e-rate-limit-secret-000000001',
    SESSION_SECRET:
      'auth-v2-account-team-e2e-session-secret-00000000000001',
    AUTH_EMAIL_TRANSPORT: 'test',
    AUTH_EMAIL_TEST_OUTBOX_PATH: outboxPath,
    AUTH_V2_E2E_DIST_DIR: e2eDistName,
    AUTH_V2_E2E_TSCONFIG: e2eTsconfigName,
    NODE_EXTRA_CA_CERTS: httpsCertPath,
  }
  await writeFile(outboxPath, '[]\n', 'utf8')
  await run(process.execPath, [migrateScript], testEnvironment)

  database = new Client({ connectionString: temporaryUrl.toString() })
  await database.connect()
  const fixtures = await seedFixtures()

  webServer = spawn(
    process.execPath,
    [
      nextScript,
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
      '--experimental-https',
      '--experimental-https-key',
      httpsKeyPath,
      '--experimental-https-cert',
      httpsCertPath,
    ],
    {
      cwd: webRoot,
      env: testEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  captureServerOutput(webServer.stdout, 'next')
  captureServerOutput(webServer.stderr, 'next-error')
  await waitForWebServer(baseUrl)
  webServerListenerPid = await findWindowsListenerPid(port)

  browser = await chromium.launch({ headless: true })
  const ownerContext = await authenticatedContext(
    fixtures.owner.session.token,
    { width: 390, height: 844 },
  )
  const ownerPage = await ownerContext.newPage()
  observePage(ownerPage, 'owner')

  await inspectSurface(
    ownerPage,
    'security-390',
    '/settings/security',
    'auth-v2-account-team-e2e-shot-security-390.png',
  )
  await inspectSurface(
    ownerPage,
    'team-390',
    '/settings/team',
    'auth-v2-account-team-e2e-shot-team-390.png',
  )
  await ownerPage.setViewportSize({ width: 1440, height: 1000 })
  await inspectSurface(
    ownerPage,
    'security-1440',
    '/settings/security',
    'auth-v2-account-team-e2e-shot-security-1440.png',
  )
  await inspectSurface(
    ownerPage,
    'team-1440',
    '/settings/team',
    'auth-v2-account-team-e2e-shot-team-1440.png',
  )

  await ownerPage.goto(`${baseUrl}/settings/security`, {
    waitUntil: 'domcontentloaded',
  })
  const sessionSection = ownerPage.locator(
    'section[aria-labelledby="active-sessions"]',
  )
  assert(
    await sessionSection.locator('li').count() === 2,
    'Security page did not show both active owner sessions.',
  )
  const endOthers = sessionSection.locator(
    'form:not(:has(input[name="sessionId"])) button[type="submit"]',
  ).first()
  await Promise.all([
    ownerPage.waitForURL('**/settings/security?sessions=others-ended'),
    endOthers.click(),
  ])
  assert(
    (await sessionState(fixtures.owner.otherSession.id)).revoked === true,
    'End other sessions did not revoke the secondary session.',
  )
  assert(
    (await sessionState(fixtures.owner.session.id)).revoked === false,
    'End other sessions revoked the current session.',
  )
  report.flows.sessionRevocation = {
    secondaryRevoked: true,
    currentPreserved: true,
  }

  const originalEmail = fixtures.owner.email
  const changedEmail =
    `owner-changed-${process.pid}-${Date.now()}@example.invalid`
  const emailForm = ownerPage.locator(
    'section[aria-labelledby="email-change"] form',
  )
  await emailForm.locator('input[name="email"]').fill(changedEmail)
  await Promise.all([
    ownerPage.waitForURL('**/settings/security?email=requested'),
    emailForm.locator('button[type="submit"]').click(),
  ])
  assert(
    await userEmail(fixtures.owner.userId) === originalEmail,
    'Primary email changed before explicit confirmation.',
  )
  const emailToken = await waitForOutboxToken(
    changedEmail,
    '/auth/change-email',
  )
  const emailButton = await openPendingAction(
    ownerPage,
    '/auth/change-email#',
    emailToken,
    '/api/auth/email-change/prepare',
  )
  const [emailConfirmResponse] = await Promise.all([
    ownerPage.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/email-change/confirm'),
    emailButton.click(),
  ])
  const emailConfirmBody = await emailConfirmResponse.json()
  assert(
    emailConfirmResponse.status() === 200
      && emailConfirmBody.ok === true
      && emailConfirmBody.destination === '/settings/security?email=changed',
    'Email confirmation did not preserve the current session.',
  )
  await ownerPage.locator('[role="status"]').filter({
    has: ownerPage.locator('a[href="/settings/security?email=changed"]'),
  }).waitFor({ state: 'visible' })
  assert(
    await userEmail(fixtures.owner.userId) === changedEmail,
    'Confirmed email did not become primary.',
  )
  assert(
    (await sessionState(fixtures.owner.session.id)).revoked === false,
    'Email confirmation revoked the current session.',
  )
  report.flows.emailChange = {
    unchangedBeforeConfirmation: true,
    fragmentCleared: true,
    explicitConfirmation: true,
    currentSessionPreserved: true,
  }

  await ownerPage.goto(`${baseUrl}/settings/team`, {
    waitUntil: 'domcontentloaded',
  })
  const inviteForm = ownerPage.locator(
    'section[aria-labelledby="invite-member"] form',
  )
  await inviteForm.locator('input[name="email"]').fill(fixtures.invited.email)
  await inviteForm.locator('select[name="role"]').selectOption('recruiter')
  await Promise.all([
    ownerPage.waitForURL('**/settings/team?invite=sent'),
    inviteForm.locator('button[type="submit"]').click(),
  ])
  const inviteToken = await waitForOutboxToken(
    fixtures.invited.email,
    '/auth/invite',
  )

  const wrongContext = await authenticatedContext(
    fixtures.wrong.session.token,
    { width: 1440, height: 1000 },
  )
  const wrongPage = await wrongContext.newPage()
  observePage(wrongPage, 'wrong-email')
  const wrongButton = await openPendingAction(
    wrongPage,
    '/auth/invite#',
    inviteToken,
    '/api/auth/invite/prepare',
  )
  const [wrongResponse] = await Promise.all([
    wrongPage.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/invite/accept'),
    wrongButton.click(),
  ])
  const wrongBody = await wrongResponse.json()
  assert(
    wrongResponse.status() === 403
      && wrongBody.ok === false
      && wrongBody.code === 'email_mismatch',
    'Wrong-email invite acceptance was not rejected with email_mismatch.',
  )
  await wrongPage.locator(
    'section[aria-labelledby="pending-action-title"] [role="alert"]',
  ).waitFor({ state: 'visible' })
  assert(
    await membershipState(
      fixtures.owner.workspaceId,
      fixtures.wrong.userId,
    ) === null,
    'Wrong-email account gained workspace membership.',
  )
  await wrongContext.close()

  const invitedContext = await authenticatedContext(
    fixtures.invited.session.token,
    { width: 1440, height: 1000 },
  )
  const invitedPage = await invitedContext.newPage()
  observePage(invitedPage, 'invited')
  const acceptButton = await openPendingAction(
    invitedPage,
    '/auth/invite#',
    inviteToken,
    '/api/auth/invite/prepare',
  )
  const [acceptResponse] = await Promise.all([
    invitedPage.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/invite/accept'),
    acceptButton.click(),
  ])
  const acceptBody = await acceptResponse.json()
  assert(
    acceptResponse.status() === 200
      && acceptBody.ok === true
      && acceptBody.destination === '/dashboard?invite=accepted',
    'Invitee did not accept the invite into the target workspace.',
  )
  await invitedPage.locator('[role="status"]').filter({
    has: invitedPage.locator('a[href="/dashboard?invite=accepted"]'),
  }).waitFor({ state: 'visible' })
  assert(
    (await membershipState(
      fixtures.owner.workspaceId,
      fixtures.invited.userId,
    ))?.role === 'recruiter',
    'Accepted invite did not create the bounded recruiter membership.',
  )

  await ownerPage.goto(`${baseUrl}/settings/team`, {
    waitUntil: 'domcontentloaded',
  })
  const invitedMember = ownerPage.locator(
    'section[aria-labelledby="team-members"] li',
  ).filter({ hasText: fixtures.invited.email })
  await invitedMember.locator('select[name="role"]').selectOption('admin')
  await Promise.all([
    ownerPage.waitForURL('**/settings/team?member=role-changed'),
    invitedMember.locator('button[type="submit"]').first().click(),
  ])
  assert(
    (await membershipState(
      fixtures.owner.workspaceId,
      fixtures.invited.userId,
    ))?.role === 'admin',
    'Owner did not change the invited member role to admin.',
  )
  assert(
    (await sessionState(fixtures.invited.session.id)).revoked === true,
    'Role change did not immediately revoke the invited member session.',
  )

  const transferForm = ownerPage.locator(
    'section[aria-labelledby="transfer-owner"] form',
  )
  await transferForm.locator('select[name="targetUserId"]').selectOption(
    fixtures.invited.userId,
  )
  await Promise.all([
    ownerPage.waitForURL('**/login?ownership=transferred'),
    transferForm.locator('button[type="submit"]').click(),
  ])
  const ownership = await verifyOwnershipTransfer(
    fixtures.owner,
    fixtures.invited,
  )
  report.flows.workspaceInviteAndRoles = {
    emailMismatchStatus: wrongResponse.status(),
    boundedInitialRole: 'recruiter',
    changedRole: 'admin',
    targetSessionRevoked: true,
    ownership,
  }

  await invitedContext.close()
  await ownerContext.close()

  assert(
    report.consoleFindings.length === 0,
    `Browser console findings: ${JSON.stringify(report.consoleFindings)}`,
  )
  assert(
    report.networkFindings.length === 0,
    `Unexpected browser network findings: ${
      JSON.stringify(report.networkFindings)
    }`,
  )
  report.result = 'passed'
} catch (error) {
  failure = error
  report.result = 'failed'
  report.failure = error instanceof Error ? error.message : String(error)
  report.serverOutput = serverOutput.slice(-30)
} finally {
  await browser?.close().catch(() => undefined)
  await stopWebServer().catch(() => undefined)
  await restoreNextEnv().catch((error) => {
    recordCleanupFailure(error)
  })
  await Promise.resolve()
    .then(() => assertSafeE2EDistDirectory())
    .then(() => rm(e2eDistDirectory, { recursive: true, force: true }))
    .catch(recordCleanupFailure)
  await rm(e2eTsconfigPath, { force: true }).catch(() => undefined)
  await database?.end().catch(() => undefined)
  if (databaseCreated) {
    await admin.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`,
    ).catch((error) => {
      if (!failure) failure = error
    })
  }
  await admin.end().catch(() => undefined)
  await Promise.resolve()
    .then(() => assertSafeOutboxDirectory())
    .then(() => rm(outboxDirectory, { recursive: true, force: true }))
    .catch(recordCleanupFailure)
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    .catch(() => undefined)
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (failure) throw failure
