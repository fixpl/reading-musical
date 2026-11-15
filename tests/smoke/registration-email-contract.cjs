const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'frontend/node_modules/typescript'));
const apiDir = path.join(root, 'frontend/src/lib/api');
const token = (owner) => `header.${Buffer.from(JSON.stringify({ sub: owner })).toString('base64url')}.signature`;
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const proofValue = 'a'.repeat(64);
const challenge = (now, suffix = '') => ({ challengeId: `synthetic-challenge${suffix}`, expiresAt: new Date(now + 600_000).toISOString(), retryAfterSeconds: 60 });
const verified = (now) => ({ emailVerificationToken: proofValue, expiresAt: new Date(now + 600_000).toISOString() });

function setup(fetcher = async () => json({})) {
  const values = new Map(), modules = new Map();
  const localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
  const globals = { localStorage, Headers, Response, AbortController, DOMException, atob, URLSearchParams, fetch: (...args) => fetcher(...args) };
  function evaluate(source, require, extra = {}) {
    const module = { exports: {} };
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const scope = { ...globals, ...extra };
    new Function('module', 'exports', 'require', ...Object.keys(scope), compiled)(module, module.exports, require, ...Object.values(scope));
    return module.exports;
  }
  function load(name) {
    if (name === '$env/dynamic/public') return { env: {} };
    const file = name.replace(/^\.\//, '');
    if (modules.has(file)) return modules.get(file);
    const result = evaluate(fs.readFileSync(path.join(apiDir, `${file}.ts`), 'utf8'), load);
    modules.set(file, result);
    return result;
  }
  const client = load('client'), session = load('session'), registration = load('registration');
  return { client, session, registration, load, evaluate, values, setAccount: (owner) => client.saveTokens({ accessToken: token(owner) }) };
}

function flow(app, clock = { now: Date.now() }) {
  let state;
  const verification = new app.registration.RegistrationEmailVerification((value) => { state = value; }, () => clock.now);
  verification.setEmail('Actor@Example.com');
  return { verification, clock, state: () => state };
}

test('email verification uses anonymous requests, preserves email case, and keeps code and proof out of storage', async () => {
  const calls = [], clock = { now: Date.now() };
  const app = setup(async (url, init) => { calls.push({ url, init }); return json(url.endsWith('/request') ? challenge(clock.now) : verified(clock.now)); });
  const view = flow(app, clock);
  await view.verification.send();
  assert.equal(view.state().phase, 'code');
  await view.verification.verify('012345');
  assert.equal(view.state().phase, 'verified');
  assert.equal(view.verification.getProof('Actor@Example.com').token, proofValue);
  assert.equal(view.verification.getProof('actor@example.com'), null);
  for (const { init } of calls) {
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    assert.equal(new Headers(init.headers).has('authorization'), false);
    assert.equal(JSON.parse(init.body).email, 'Actor@Example.com');
  }
  assert.equal(JSON.parse(calls[1].init.body).code, '012345');
  assert.equal(app.values.size, 0);
  view.verification.dispose();
});

test('resend waits 60 seconds and replaces the previous challenge', async () => {
  let requests = 0, receivedChallenge;
  const clock = { now: Date.now() };
  const app = setup(async (url, init) => {
    if (url.endsWith('/request')) return json(challenge(clock.now, String(++requests)));
    receivedChallenge = JSON.parse(init.body).challengeId;
    return json(verified(clock.now));
  });
  const view = flow(app, clock);
  await view.verification.send();
  assert.equal(await view.verification.send(), false);
  assert.equal(requests, 1);
  clock.now += 60_000;
  await view.verification.send();
  await view.verification.verify('012345');
  assert.equal(receivedChallenge, 'synthetic-challenge2');
  view.verification.dispose();
});

test('mail pause and rate limits remain retryable without issuing a proof', async () => {
  let requests = 0;
  const clock = { now: Date.now() };
  const app = setup(async () => {
    requests += 1;
    if (requests === 1) return new Response('temporarily unavailable', { status: 503 });
    if (requests === 2) return json({ code: 'REGISTRATION_EMAIL_RATE_LIMITED', message: '잠시 후 다시 받아 주세요.', retryAfterSeconds: 80 }, 429, { 'retry-after': '80' });
    return json(challenge(clock.now));
  });
  const view = flow(app, clock);
  assert.equal(await view.verification.send(), false);
  assert.equal(view.state().phase, 'idle');
  assert.ok(view.state().error.includes('다시 시도'));
  assert.equal(await view.verification.send(), false);
  assert.equal(view.state().retryAt, clock.now + 80_000);
  assert.equal(await view.verification.send(), false);
  assert.equal(requests, 2);
  clock.now += 80_000;
  assert.equal(await view.verification.send(), true);
  assert.equal(view.verification.getProof('Actor@Example.com'), null);
  view.verification.dispose();
});

test('a wrong code can be corrected, while expired codes and proofs require verification again', async () => {
  let attempts = 0;
  const clock = { now: Date.now() };
  const app = setup(async (url) => url.endsWith('/request') ? json(challenge(clock.now)) : ++attempts === 1 ? json({ message: '번호를 다시 확인해 주세요.', code: 'REGISTRATION_EMAIL_CODE_INVALID' }, 401) : json(verified(clock.now)));
  const view = flow(app, clock);
  await view.verification.send();
  assert.equal(await view.verification.verify('12345'), false);
  assert.equal(attempts, 0);
  assert.equal(await view.verification.verify('111111'), false);
  assert.equal(view.state().phase, 'code');
  assert.equal(await view.verification.verify('012345'), true);
  clock.now += 600_000;
  assert.equal(view.verification.getProof('Actor@Example.com'), null);
  view.verification.tick();
  assert.equal(view.state().phase, 'idle');
  assert.ok(view.state().error.includes('다시'));
  await view.verification.send();
  clock.now += 600_000;
  view.verification.tick();
  assert.equal(view.state().phase, 'idle');
  assert.equal(await view.verification.verify('012345'), false);
  view.verification.dispose();
});

test('changing an email aborts a pending request and ignores its late response', async () => {
  const response = deferred();
  let signal;
  const app = setup(async (_url, init) => { signal = init.signal; return response.promise; });
  const view = flow(app);
  const sending = view.verification.send();
  view.verification.setEmail('new@example.com');
  assert.equal(signal.aborted, true);
  response.resolve(json(challenge(view.clock.now)));
  assert.equal(await sending, false);
  assert.equal(view.state().phase, 'idle');
  assert.equal(view.verification.getProof('new@example.com'), null);
  view.verification.dispose();
});

test('changing email during code verification cannot attach the old proof to the new address', async () => {
  const response = deferred();
  const clock = { now: Date.now() };
  const app = setup(async (url) => url.endsWith('/request') ? json(challenge(clock.now)) : response.promise);
  const view = flow(app, clock);
  await view.verification.send();
  const checking = view.verification.verify('012345');
  view.verification.setEmail('new@example.com');
  response.resolve(json(verified(clock.now)));
  assert.equal(await checking, false);
  assert.equal(view.verification.getProof('new@example.com'), null);
  assert.equal(view.state().phase, 'idle');
  view.verification.dispose();
});

test('unmount and account changes abort verification and reject a late JSON body', async () => {
  for (const stop of ['dispose', 'account']) {
    const body = deferred(), started = deferred();
    const app = setup(async () => ({ ok: true, status: 200, headers: new Headers(), json: () => { started.resolve(); return body.promise; } }));
    const view = flow(app);
    const sending = view.verification.send();
    await started.promise;
    if (stop === 'dispose') view.verification.dispose(); else app.setAccount('other-account');
    body.resolve(challenge(view.clock.now));
    assert.equal(await sending, false);
    assert.equal(view.state().stopped, true);
    assert.equal(view.verification.getProof('Actor@Example.com'), null);
  }
});

test('an already verified proof is discarded immediately after an email or account change', async () => {
  for (const change of ['email', 'account']) {
    const clock = { now: Date.now() };
    const app = setup(async (url) => json(url.endsWith('/request') ? challenge(clock.now) : verified(clock.now)));
    const view = flow(app, clock);
    await view.verification.send(); await view.verification.verify('012345');
    if (change === 'email') view.verification.setEmail('Actor@Example.com '); else app.setAccount('other-account');
    assert.equal(view.verification.getProof('Actor@Example.com'), null);
    assert.equal(view.verification.getProof('Actor@Example.com '), null);
    view.verification.dispose();
  }
});

const registrationInput = () => ({ email: 'Actor@Example.com', emailVerificationToken: proofValue, name: '검증 배우', password: 'synthetic-password9', profileType: 'ACTOR', agreements: { terms: true, privacy: true, age14: true, termsDocumentId: 'terms-document', privacyDocumentId: 'privacy-document' } });

test('registration includes proof and existing agreements, keeps refresh cookies, and installs the new owner', async () => {
  let sent;
  const app = setup(async (url, init) => { sent = { url, init }; return json({ tokens: { accessToken: token('new-actor'), refreshToken: 'synthetic-refresh' } }); });
  const before = app.session.captureSession();
  const after = await app.registration.registerVerifiedAccount(registrationInput(), before, new AbortController().signal);
  assert.equal(after.owner, 'new-actor');
  assert.equal(app.session.isCurrentSession(after, true), true);
  assert.equal(sent.url, '/api/v1/auth/register');
  assert.equal(sent.init.credentials, 'include');
  assert.deepEqual(JSON.parse(sent.init.body), registrationInput());
  assert.equal(app.client.getAccessToken(), token('new-actor'));
  assert.equal(app.values.get('reading-musical.refreshToken'), undefined);
  assert.equal([...app.values.values()].includes(proofValue), false);
});

test('late registration cannot replace a newer login, including an account A to B to A cycle', async () => {
  for (const cycle of [false, true]) {
    const response = deferred();
    const app = setup(async () => response.promise);
    if (cycle) app.setAccount('account-a');
    const before = app.session.captureSession();
    const creating = app.registration.registerVerifiedAccount(registrationInput(), before, new AbortController().signal);
    const rejected = assert.rejects(creating, { name: 'AbortError' });
    app.setAccount('account-b');
    if (cycle) app.setAccount('account-a');
    response.resolve(json({ tokens: { accessToken: token('new-actor') } }));
    await rejected;
    assert.equal(app.client.getAccessToken(), token(cycle ? 'account-a' : 'account-b'));
  }
});

test('a disposed registration ignores a late body even if fetch does not honor abort', async () => {
  const response = deferred(), controller = new AbortController();
  const app = setup(async () => response.promise);
  const creating = app.registration.registerVerifiedAccount(registrationInput(), app.session.captureSession(), controller.signal);
  const rejected = assert.rejects(creating, { name: 'AbortError' });
  controller.abort();
  response.resolve(json({ tokens: { accessToken: token('new-actor') } }));
  await rejected;
  assert.equal(app.client.getAccessToken(), null);
});

test('registration from a stale view cannot dispatch under the new account', async () => {
  let writes = 0;
  const app = setup(async () => { writes += 1; return json({}); });
  const before = app.session.captureSession();
  app.setAccount('other-account');
  await assert.rejects(app.registration.registerVerifiedAccount(registrationInput(), before, new AbortController().signal), { name: 'AbortError' });
  assert.equal(writes, 0);
});

function registrationPage(app, search = '') {
  const source = fs.readFileSync(path.join(root, 'frontend/src/routes/register/+page.svelte'), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  let mount;
  const navigations = [], proofResets = [];
  const state = Object.assign((value) => value, { raw: (value) => value });
  const page = { url: { pathname: '/register', search }, data: { site: { info: { siteName: '아트브릿지' }, registration: { ready: { signup: true, optionalProfile: true }, policies: [{ id: 'terms-document', kind: 'TERMS' }, { id: 'privacy-document', kind: 'SIGNUP_PRIVACY' }] } } } };
  const prefix = 'const $state = state; const $derived = value => value; const $effect = () => {};\n';
  const harness = `\nmodule.exports.harness = {
    mount: () => mount(), submit: () => handleSubmit({ preventDefault() {} }),
    fill: (proof = true) => { name = '검증 배우'; email = 'Actor@Example.com'; password = confirm = 'synthetic-password9'; terms = privacy = age14 = true; emailVerification = { getProof: () => proof ? { email, token: '${proofValue}', expiresAt: Date.now() + 600000 } : null, reset: message => proofResets.push(message) }; },
    get: () => ({ name, email, password, confirm, terms, privacy, age14, accountCreated, signedIn, sessionChanged, errorMessage, submitting })
  };`;
  const view = app.evaluate(prefix + source + harness, (name) => {
    if (name === 'svelte') return { onMount: (callback) => { mount = callback; } };
    if (name === '$app/navigation') return { goto: async (href) => { navigations.push(href); }, invalidate: async () => {} };
    if (name === '$app/stores') return { page };
    if (name === '$lib/api/client') return app.client;
    if (name === '$lib/api/session') return app.session;
    if (name === '$lib/api/registration') return app.registration;
    if (name === '$lib/api/auth') return app.load('auth');
    if (name === '$lib/api/site') return { displayPolicy: () => null };
    if (name === '$lib/domain/labels') return { PROFILE_TYPE_LABELS: { ACTOR: '배우' } };
    if (name.includes('components/') || name.startsWith('@lucide/')) return {};
    throw new Error(`Unexpected registration import: ${name}`);
  }, { state, $page: page, mount: () => mount(), proofResets, window: { location: { search } } }).harness;
  return { view, navigations, proofResets };
}

test('the registration screen blocks submission without email verification', async () => {
  let writes = 0;
  const app = setup(async () => { writes += 1; return json({}); });
  const page = registrationPage(app), dispose = page.view.mount();
  page.view.fill(false);
  await page.view.submit();
  assert.equal(writes, 0);
  assert.ok(page.view.get().errorMessage.includes('인증번호'));
  dispose();
});

test('invalid registration proof requests reverification while preserving form values and agreements', async () => {
  const app = setup(async () => json({ message: '이메일을 다시 확인해 주세요.', code: 'REGISTRATION_EMAIL_VERIFICATION_INVALID' }, 401));
  const page = registrationPage(app), dispose = page.view.mount();
  page.view.fill();
  await page.view.submit();
  const after = page.view.get();
  assert.equal(after.name, '검증 배우');
  assert.equal(after.email, 'Actor@Example.com');
  assert.equal(after.password, 'synthetic-password9');
  assert.equal(after.terms && after.privacy && after.age14, true);
  assert.equal(page.proofResets.length, 1);
  assert.equal(after.submitting, false);
  assert.equal(after.accountCreated, false);
  dispose();
});

test('invitation acceptance failure keeps the new account and redirects to the invitation instead of registering twice', async () => {
  let registrations = 0;
  const app = setup(async (url) => {
    if (url.endsWith('/auth/register')) { registrations += 1; return json({ tokens: { accessToken: token('new-actor') } }); }
    return json({ message: '초대를 다시 확인해 주세요.' }, 409);
  });
  const page = registrationPage(app, '?invite=synthetic-invite'), dispose = page.view.mount();
  page.view.fill();
  await page.view.submit();
  await page.view.submit();
  assert.equal(registrations, 1);
  assert.equal(app.client.getAccessToken(), token('new-actor'));
  assert.deepEqual(page.navigations, ['/invite/synthetic-invite']);
  assert.equal(page.view.get().accountCreated, true);
  assert.equal(page.view.get().password, '');
  dispose();
});

test('a normal verified registration reaches the existing member home path', async () => {
  const app = setup(async (url) => url.endsWith('/auth/register') ? json({ tokens: { accessToken: token('new-actor') } }) : json({ id: 'new-actor', platformRole: 'MEMBER' }));
  const page = registrationPage(app), dispose = page.view.mount();
  page.view.fill();
  await page.view.submit();
  assert.deepEqual(page.navigations, ['/app']);
  assert.equal(page.view.get().accountCreated, true);
  assert.equal(page.view.get().submitting, false);
  dispose();
});

test('an account switch during registration cannot publish completion or navigate the newer account', async () => {
  const response = deferred();
  const app = setup(async () => response.promise);
  const page = registrationPage(app), dispose = page.view.mount();
  page.view.fill();
  const creating = page.view.submit();
  app.setAccount('other-account');
  response.resolve(json({ tokens: { accessToken: token('new-actor') } }));
  await creating;
  assert.equal(app.client.getAccessToken(), token('other-account'));
  assert.equal(page.view.get().accountCreated, false);
  assert.equal(page.view.get().sessionChanged, true);
  assert.equal(page.view.get().password, '');
  assert.deepEqual(page.navigations, []);
  dispose();
});

test('unmount during registration prevents token installation and navigation', async () => {
  const response = deferred();
  const app = setup(async () => response.promise);
  const page = registrationPage(app), dispose = page.view.mount();
  page.view.fill();
  const creating = page.view.submit();
  dispose();
  response.resolve(json({ tokens: { accessToken: token('new-actor') } }));
  await creating;
  assert.equal(app.client.getAccessToken(), null);
  assert.deepEqual(page.navigations, []);
});

test('an account switch while accepting an invitation cannot redirect the newer account', async () => {
  const response = deferred(), started = deferred();
  const app = setup(async (url) => {
    if (url.endsWith('/auth/register')) return json({ tokens: { accessToken: token('new-actor') } });
    started.resolve(); return response.promise;
  });
  const page = registrationPage(app, '?invite=synthetic-invite'), dispose = page.view.mount();
  page.view.fill();
  const creating = page.view.submit();
  await started.promise;
  app.setAccount('other-account');
  response.resolve(json({ next: '/app' }));
  await creating;
  assert.equal(app.client.getAccessToken(), token('other-account'));
  assert.deepEqual(page.navigations, []);
  assert.equal(page.view.get().sessionChanged, true);
  dispose();
});

test('the root layout can synchronously remount registration on token commit without losing invitation completion', async () => {
  for (const acceptStatus of [200, 409]) {
    let registrations = 0, acceptances = 0, disposeOld, replacement, disposeNew;
    const app = setup(async (url) => {
      if (url.endsWith('/auth/register')) { registrations += 1; return json({ tokens: { accessToken: token('new-actor') } }); }
      if (url.includes('/invitations/')) { acceptances += 1; return json({ next: '/app' }, acceptStatus); }
      return json({ id: 'new-actor', platformRole: 'MEMBER' });
    });
    const page = registrationPage(app, '?invite=synthetic-invite');
    disposeOld = page.view.mount();
    // +layout.svelte의 subscribeSession + flushSync + {#key sessionGeneration} 경계를 재현한다.
    const stopLayout = app.session.subscribeSession(() => {
      disposeOld();
      replacement = registrationPage(app, '?invite=synthetic-invite');
      disposeNew = replacement.view.mount();
    });
    page.view.fill();
    await page.view.submit();
    assert.equal(registrations, 1);
    assert.equal(acceptances, 1);
    assert.deepEqual(page.navigations, [acceptStatus === 200 ? '/app' : '/invite/synthetic-invite']);
    assert.equal(replacement.view.get().signedIn, true);
    replacement.view.fill();
    await replacement.view.submit();
    assert.equal(registrations, 1);
    stopLayout(); disposeNew();
  }
});

test('an existing authenticated member cannot start another registration from a freshly mounted screen', async () => {
  let writes = 0;
  const app = setup(async () => { writes += 1; return json({}); });
  app.setAccount('existing-actor');
  const page = registrationPage(app), dispose = page.view.mount();
  page.view.fill();
  await page.view.submit();
  assert.equal(page.view.get().signedIn, true);
  assert.equal(writes, 0);
  assert.equal(app.client.getAccessToken(), token('existing-actor'));
  dispose();
});

test('the compiled verification screen renders a native six-digit input pattern', async () => {
  const { compile } = require(path.join(root, 'frontend/node_modules/svelte/compiler'));
  const resolveSvelte = (name) => pathToFileURL(require.resolve(name, { paths: [path.join(root, 'frontend')] })).href;
  const dataModule = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  const internalServer = resolveSvelte('svelte/internal/server');
  const compileFixture = (source, filename) => dataModule(compile(source, { generate: 'server', filename }).js.code.replaceAll("'svelte/internal/server'", JSON.stringify(internalServer)));
  const input = compileFixture('<script>let {ref, ...props} = $props();</script><input {...props} />', 'InputFixture.svelte');
  const button = compileFixture('<script>let {children, ...props} = $props();</script><button {...props}>{@render children?.()}</button>', 'ButtonFixture.svelte');
  const label = compileFixture('<script>let {children, ...props} = $props();</script><label {...props}>{@render children?.()}</label>', 'LabelFixture.svelte');
  const imports = {
    'svelte/internal/server': internalServer,
    svelte: resolveSvelte('svelte'),
    '$lib/api/registration': dataModule('export class RegistrationEmailVerification {}'),
    '$lib/components/ui/input': dataModule(`export {default as Input} from ${JSON.stringify(input)};`),
    '$lib/components/ui/button': dataModule(`export {default as Button} from ${JSON.stringify(button)};`),
    '$lib/components/ui/label': dataModule(`export {default as Label} from ${JSON.stringify(label)};`)
  };
  const source = fs.readFileSync(path.join(root, 'frontend/src/lib/components/site/RegistrationEmailVerification.svelte'), 'utf8');
  let compiled = compile(source, { generate: 'server', filename: 'RegistrationEmailVerification.svelte' }).js.code;
  // SSR에서는 onMount가 실행되지 않으므로 인증번호 입력 단계만 fixture로 연다. 원본 markup은 그대로 compile한다.
  assert.ok(compiled.includes('phase: "idle"'));
  compiled = compiled.replace('phase: "idle"', 'phase: "code"');
  compiled = compiled.replace(/from\s+(["'])([^"']+)\1/g, (_all, _quote, name) => {
    assert.ok(imports[name], `Unexpected compiled import: ${name}`);
    return `from ${JSON.stringify(imports[name])}`;
  });
  const { default: Verification } = await import(dataModule(compiled));
  const { render } = await import(resolveSvelte('svelte/server'));
  const { body } = render(Verification, { props: { email: 'synthetic@example.com' } });
  const inputMarkup = body.match(/<input\b[^>]*\bid="registration-email-code"[^>]*>/)?.[0];
  assert.ok(inputMarkup, 'The compiled verification state must render its code input');
  const pattern = inputMarkup.match(/\bpattern="([^"]+)"/)?.[1];
  assert.equal(pattern, '[0-9]{6}');
  const nativePattern = new RegExp(`^(?:${pattern})$`);
  assert.equal(nativePattern.test('012345'), true);
  assert.equal(nativePattern.test('12345'), false);
  assert.equal(nativePattern.test('1234567'), false);
  assert.equal(nativePattern.test('abcdef'), false);
});
