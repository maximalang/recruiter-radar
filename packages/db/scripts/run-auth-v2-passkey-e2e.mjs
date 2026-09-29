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
if (!databaseUrl) throw new Error('DATABASE_URL is required.')
if (process.env.AUTH_V2_DISPOSABLE_DB_CONFIRMED !== 'true') {
  throw new Error(
    'AUTH_V2_DISPOSABLE_DB_CONFIRMED=true is required before creating a disposable database.',
  )
}

const root = resolve(import.meta.dirname, '..', '..', '..')
const webRoot = resolve(root, 'apps', 'web')
const migrateScript = resolve(root, 'packages', 'db', 'scripts', 'migrate.mjs')
const iconGenerationScript = resolve(webRoot, 'scripts', 'generate-app-icons.mjs')
const nextScript = resolve(root, 'node_modules', 'next', 'dist', 'bin', 'next')
const artifactsDirectory = resolve(webRoot, 'scripts')
const e2eDistName = `.next-auth-v2-e2e-${process.pid}`
const e2eDistDirectory = resolve(webRoot, e2eDistName)
const e2eTsconfigName = `.auth-v2-e2e-tsconfig-${process.pid}.json`
const e2eTsconfigPath = resolve(webRoot, e2eTsconfigName)
const sourceTsconfigPath = resolve(webRoot, 'tsconfig.json')
const nextEnvPath = resolve(webRoot, 'next-env.d.ts')
const reportPath = resolve(artifactsDirectory, 'auth-v2-passkey-e2e-report.json')
const databaseName = `auth_v2_e2e_passkeys_${process.pid}_${Date.now()}`
const temporaryUrl = new URL(databaseUrl)
temporaryUrl.pathname = `/${databaseName}`
temporaryUrl.searchParams.delete('schema')
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), 'rr-auth-v2-passkey-e2e-'),
)
const outboxPath = join(temporaryDirectory, 'outbox.json')
const httpsKeyPath = join(temporaryDirectory, 'localhost-key.pem')
const httpsCertPath = join(temporaryDirectory, 'localhost-cert.pem')
const admin = new Client({ connectionString: databaseUrl })
let database = null
let databaseCreated = false
let browser = null
let context = null
let webServer = null
let listenerPid = null
let originalNextEnv = null
let failure = null
let baseUrl = ''
const serverOutput = []
const report = {
  database: databaseName,
  browser: 'Playwright Chromium virtual CTAP2 authenticator',
  flows: {},
  screenshots: {},
  accessibility: {},
  responsive: {},
  consoleFindings: [],
  networkFindings: [],
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function inspectAccessibility(page, key) {
  await page.locator('main').waitFor({ state: 'visible' })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  assert(overflow <= 0, `${key} overflows horizontally by ${overflow}px.`)
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
    `${key} has unlabeled visible controls: ${unlabeledControls.join(', ')}`,
  )
  const aria = await page.locator('body').ariaSnapshot()
  assert(
    aria.includes('heading'),
    `${key} accessibility snapshot is missing a heading.`,
  )
  await page.keyboard.press('Tab')
  const focusMoved = await page.evaluate(
    () => document.activeElement !== document.body,
  )
  assert(focusMoved, `${key} did not expose a keyboard focus target.`)
  report.accessibility[key] = {
    labelledControls: true,
    ariaSnapshotLines: aria.split('\n').length,
    keyboardFocus: true,
  }
  report.responsive[key] = {
    viewport: page.viewportSize(),
    overflowPixels: overflow,
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(address && typeof address === 'object', 'Failed to reserve port.')
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
  const candidates = [
    process.env.OPENSSL_PATH?.trim() || null,
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
      await execFileAsync(candidate, [
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
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ], { windowsHide: true, maxBuffer: 1024 * 1024 })
      return
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(
    `OpenSSL is required: ${
      lastError instanceof Error ? lastError.message : 'not found'
    }`,
  )
}

async function waitForServer() {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (webServer?.exitCode !== null) {
      throw new Error(
        `Next.js exited before readiness: ${serverOutput.slice(-8).join('')}`,
      )
    }
    try {
      const status = await new Promise((resolveStatus, reject) => {
        const request = httpsGet(
          `https://127.0.0.1:${new URL(baseUrl).port}/login`,
          { rejectUnauthorized: false },
          (response) => {
            response.resume()
            resolveStatus(response.statusCode ?? 0)
          },
        )
        request.setTimeout(5_000, () => {
          request.destroy(new Error('Readiness timeout.'))
        })
        request.once('error', reject)
      })
      if (status > 0 && status < 500) return
    } catch {
      // Retry while Next compiles the first route.
    }
    await delay(250)
  }
  throw new Error('Next.js did not become ready.')
}

async function findListenerPid(port) {
  if (process.platform !== 'win32') return null
  const command = [
    `$connection = Get-NetTCPConnection -State Listen -LocalPort ${port}`,
    '-ErrorAction SilentlyContinue | Select-Object -First 1;',
    'if ($connection) { $connection.OwningProcess }',
  ].join(' ')
  const result = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  ).catch(() => null)
  const value = result?.stdout?.trim() ?? ''
  return /^[1-9]\d*$/.test(value) ? Number(value) : null
}

async function stopServer() {
  if (!webServer) return
  if (process.platform === 'win32') {
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

async function restoreNextEnv() {
  if (originalNextEnv === null) return
  const current = await readFile(nextEnvPath, 'utf8')
  if (current === originalNextEnv) return
  const generated = `import "./${e2eDistName}/dev/types/routes.d.ts";`
  const original = originalNextEnv.match(
    /^import ".+\/types\/routes\.d\.ts";$/m,
  )?.[0]
  assert(original, 'Original next-env route import was not recognized.')
  const sanitized = current.replace(generated, original)
  assert(
    sanitized.replaceAll('\r\n', '\n')
      === originalNextEnv.replaceAll('\r\n', '\n'),
    'next-env.d.ts changed outside the generated route import.',
  )
  await writeFile(nextEnvPath, originalNextEnv, 'utf8')
}

function observePage(page) {
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      report.consoleFindings.push({
        type: message.type(),
        text: message.text(),
      })
    }
  })
  page.on('pageerror', (error) => {
    report.consoleFindings.push({ type: 'pageerror', text: error.message })
  })
  page.on('requestfailed', (request) => {
    if (
      request.failure()?.errorText !== 'net::ERR_ABORTED'
      || new URL(request.url()).origin !== baseUrl
    ) {
      report.networkFindings.push({
        url: request.url(),
        error: request.failure()?.errorText ?? 'unknown',
      })
    }
  })
}

async function createFixture() {
  const email = `passkey-e2e-${process.pid}-${Date.now()}@example.invalid`
  const user = await database.query(
    `INSERT INTO users (
       email,
       email_normalized,
       email_verified_at,
       onboarding_status,
       last_authenticated_at,
       created_at,
       updated_at
     )
     VALUES ($1, $1, NOW(), 'completed', NOW(), NOW(), NOW())
     RETURNING id::TEXT AS id`,
    [email],
  )
  const userId = user.rows[0]?.id
  assert(userId, 'Failed to create passkey user.')
  const workspace = await database.query(
    'SELECT ensure_auth_user_workspace($1)::TEXT AS id',
    [userId],
  )
  const workspaceId = workspace.rows[0]?.id
  assert(workspaceId, 'Failed to create passkey workspace.')
  const token = randomBytes(32).toString('hex')
  const session = await database.query(
    `INSERT INTO auth_sessions (
       user_id,
       workspace_id,
       token_hash,
       auth_method,
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
       NOW(),
       NOW(),
       NOW() + INTERVAL '14 days',
       NOW() + INTERVAL '30 days',
       NOW(),
       NOW()
     )
     RETURNING id::TEXT AS id`,
    [userId, workspaceId, hashToken(token)],
  )
  return {
    email,
    userId,
    workspaceId,
    token,
    sessionId: session.rows[0]?.id,
  }
}

async function databaseCount(sql, values) {
  const result = await database.query(sql, values)
  return result.rows[0]?.count ?? 0
}

try {
  await admin.connect()
  await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
  databaseCreated = true
  const port = await freePort()
  baseUrl = `https://localhost:${port}`
  originalNextEnv = await readFile(nextEnvPath, 'utf8')
  await writeFile(
    e2eTsconfigPath,
    await readFile(sourceTsconfigPath, 'utf8'),
    'utf8',
  )
  await writeFile(outboxPath, '[]\n', 'utf8')
  await createHttpsCertificate()
  const environment = {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: temporaryUrl.toString(),
    AUTH_PLATFORM_V2_ENABLED: 'true',
    AUTH_WORKSPACES_V2_ENABLED: 'true',
    AUTH_ONBOARDING_V2_ENABLED: 'true',
    AUTH_PASSKEYS_ENABLED: 'true',
    AUTH_SITE_URL: baseUrl,
    AUTH_PASSKEY_RP_ID: 'localhost',
    AUTH_RATE_LIMIT_SECRET:
      'auth-v2-passkey-e2e-rate-limit-secret-000000000001',
    SESSION_SECRET:
      'auth-v2-passkey-e2e-session-secret-000000000000001',
    AUTH_EMAIL_TRANSPORT: 'test',
    AUTH_EMAIL_TEST_OUTBOX_PATH: outboxPath,
    AUTH_V2_E2E_DIST_DIR: e2eDistName,
    AUTH_V2_E2E_TSCONFIG: e2eTsconfigName,
    NODE_EXTRA_CA_CERTS: httpsCertPath,
  }
  await run(process.execPath, [iconGenerationScript], environment)
  await run(process.execPath, [migrateScript], environment)
  database = new Client({ connectionString: temporaryUrl.toString() })
  await database.connect()
  const fixture = await createFixture()

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
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  for (const [stream, label] of [
    [webServer.stdout, 'next'],
    [webServer.stderr, 'next-error'],
  ]) {
    stream?.setEncoding('utf8')
    stream?.on('data', (chunk) => {
      serverOutput.push(`[${label}] ${chunk}`)
      if (serverOutput.length > 200) serverOutput.shift()
    })
  }
  await waitForServer()
  listenerPid = await findListenerPid(port)

  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  })
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'ru-RU',
    colorScheme: 'light',
    ignoreHTTPSErrors: true,
  })
  await context.addInitScript(() => {
    if ('PublicKeyCredential' in window) {
      Object.defineProperty(
        PublicKeyCredential,
        'isConditionalMediationAvailable',
        {
          configurable: true,
          value: async () => false,
        },
      )
    }
  })
  await context.addCookies([{
    name: '__Host-rr_session',
    value: fixture.token,
    url: baseUrl,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  }])
  const page = await context.newPage()
  observePage(page)
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const virtual = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  const authenticatorId = virtual.authenticatorId

  const clientSessionReady = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url())
    return responseUrl.pathname === '/api/auth/session/refresh'
      && response.request().method() === 'POST'
      && response.ok()
  })
  await page.goto(`${baseUrl}/settings/security`, {
    waitUntil: 'domcontentloaded',
  })
  await clientSessionReady
  const passkeySection = page.locator(
    'section[aria-labelledby="passkey-settings"]',
  )
  await passkeySection.waitFor({ state: 'visible' })
  await passkeySection.getByLabel('Название нового ключа').fill('E2E key')
  await passkeySection.getByRole('button', {
    name: 'Добавить ключ',
  }).click()
  await passkeySection.getByRole('status').filter({
    hasText: 'Ключ доступа добавлен',
  }).waitFor({ state: 'visible' })
  assert(
    await databaseCount(
      'SELECT COUNT(*)::INTEGER AS count FROM user_passkeys WHERE user_id = $1',
      [fixture.userId],
    ) === 1,
    'Passkey registration did not persist one credential.',
  )
  const registrationOutbox = JSON.parse(await readFile(outboxPath, 'utf8'))
  assert(
    registrationOutbox.some((message) =>
      message.to === fixture.email
      && message.subject === 'Ключ доступа добавлен — Recruiter Radar'),
    'Passkey registration did not send its security notice.',
  )
  await inspectAccessibility(page, 'management1440')
  const securityScreenshot = resolve(
    artifactsDirectory,
    'auth-v2-passkey-e2e-shot-management-1440.png',
  )
  await page.screenshot({
    path: securityScreenshot,
    fullPage: true,
    caret: 'initial',
  })
  report.screenshots.management1440 = securityScreenshot
  report.flows.registration = {
    credentialPersisted: true,
    privateKeyNeverReturnedToServer: true,
    managementVisible: true,
    securityEmailSent: true,
  }

  await page.goto(`${baseUrl}/login?returnTo=/dashboard`, {
    waitUntil: 'domcontentloaded',
  })
  const passkeyLogin = page.getByRole('button', {
    name: 'Войти с ключом доступа',
  })
  await passkeyLogin.waitFor({ state: 'visible' })
  await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
    authenticatorId,
    enabled: true,
  })
  const explicitOptions = page.waitForResponse((response) =>
    new URL(response.url()).pathname
      === '/api/auth/passkeys/authentication/options')
  const verificationResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname
        === '/api/auth/passkeys/authentication/verify')
  await passkeyLogin.evaluate((element) => {
    element.click()
  })
  await explicitOptions
  const authenticationResponse = await verificationResponse
  assert(
    authenticationResponse.status() === 200,
    `Passkey verification returned ${authenticationResponse.status()}.`,
  )
  await page.waitForURL((url) => url.pathname === '/dashboard')
  assert(
    await databaseCount(
      `SELECT COUNT(*)::INTEGER AS count
       FROM auth_sessions
       WHERE user_id = $1
         AND auth_method = 'passkey'
         AND revoked_at IS NULL`,
      [fixture.userId],
    ) === 1,
    'Passkey authentication did not create one active passkey session.',
  )
  const originalSession = await database.query(
    `SELECT revoked_at IS NOT NULL AS revoked
     FROM auth_sessions
     WHERE id = $1`,
    [fixture.sessionId],
  )
  assert(
    originalSession.rows[0]?.revoked === true,
    'Passkey login did not revoke the prior browser session.',
  )
  const loginOutbox = JSON.parse(await readFile(outboxPath, 'utf8'))
  assert(
    loginOutbox.some((message) =>
      message.to === fixture.email
      && message.subject === 'Новый вход — Recruiter Radar'),
    'Passkey login did not send its security notice.',
  )
  report.flows.login = {
    discoverableCredential: true,
    newDatabaseSession: true,
    previousBrowserSessionRevoked: true,
    securityEmailSent: true,
  }

  await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
    authenticatorId,
    enabled: false,
  })
  await context.clearCookies()
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  const emailInput = page.getByLabel('Рабочий email')
  await emailInput.waitFor({ state: 'visible' })
  assert(
    (await emailInput.getAttribute('autocomplete')) === 'email webauthn',
    'Conditional UI autocomplete token is missing.',
  )
  await emailInput.fill(fixture.email)
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await page.getByRole('heading', { name: 'Проверьте почту' }).waitFor({
    state: 'visible',
  })
  const outbox = JSON.parse(await readFile(outboxPath, 'utf8'))
  assert(
    outbox.some((message) =>
      message.to === fixture.email
      && message.subject === 'Вход в Recruiter Radar'),
    'Verified-email fallback did not use the deterministic outbox.',
  )
  const loginScreenshot = resolve(
    artifactsDirectory,
    'auth-v2-passkey-e2e-shot-login-fallback-390.png',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await inspectAccessibility(page, 'loginFallback390')
  await page.screenshot({
    path: loginScreenshot,
    fullPage: true,
    caret: 'initial',
  })
  report.screenshots.loginFallback390 = loginScreenshot
  report.flows.emailFallback = {
    emailControlVisible: true,
    conditionalAutocomplete: true,
    deterministicEmailSent: true,
  }

  assert(
    report.consoleFindings.length === 0,
    `Browser console findings: ${JSON.stringify(report.consoleFindings)}`,
  )
  assert(
    report.networkFindings.length === 0,
    `Browser network findings: ${JSON.stringify(report.networkFindings)}`,
  )
  report.result = 'passed'
} catch (error) {
  failure = error
  report.result = 'failed'
  report.failure = error instanceof Error ? error.message : String(error)
  report.serverOutput = serverOutput.slice(-30)
} finally {
  await context?.close().catch(() => undefined)
  await browser?.close().catch(() => undefined)
  await stopServer().catch(() => undefined)
  await restoreNextEnv().catch((error) => {
    if (!failure) failure = error
  })
  const safeDist = relative(webRoot, e2eDistDirectory) === e2eDistName
  if (safeDist) {
    await rm(e2eDistDirectory, { recursive: true, force: true })
      .catch(() => undefined)
  } else if (!failure) {
    failure = new Error('Refusing to remove E2E cache outside apps/web.')
  }
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
  const safeTemp = (
    relative(tmpdir(), temporaryDirectory)
      .startsWith('rr-auth-v2-passkey-e2e-')
  )
  if (safeTemp) {
    await rm(temporaryDirectory, { recursive: true, force: true })
      .catch(() => undefined)
  }
  if (failure) {
    report.result = 'failed'
    report.failure = failure instanceof Error ? failure.message : String(failure)
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    .catch(() => undefined)
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (failure) throw failure
