import test from 'node:test';
import assert from 'node:assert/strict';
import { createGmgnRequestGate, gmgnRetryAt } from '../lib/gmgn-rate-limit.mjs';

function clockGate(options = {}) {
  let time = 1800000000000;
  return { now: () => time, advance: ms => time += ms, gate: createGmgnRequestGate({now: () => time, sleep: async ms => { time += ms; }, ...options}) };
}

test('all wallets are serialized and simultaneous duplicate reads share one request', async () => {
  const h = clockGate();
  const starts = [];
  const fetch = async () => { starts.push(h.now()); return ['trade']; };
  const a = h.gate.run('frog', fetch);
  const duplicate = h.gate.run('frog', fetch);
  assert.equal(a, duplicate);
  await Promise.all([a, duplicate, h.gate.run('deku', fetch), h.gate.run('trunoest', fetch)]);
  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= 500);
  assert.ok(starts[2] - starts[1] >= 500);
});

test('429 cancels queued network requests and respects the longest reset before one recovery', async () => {
  let saved;
  const h = clockGate({save: async s => { saved = structuredClone(s); }});
  let calls = 0;
  const retryAt = h.now() + 600000;
  const fail = async () => { calls++; throw Object.assign(new Error('GMGN request limit reached.'), {httpStatus:429, retryAt}); };
  const results = await Promise.allSettled([h.gate.run('frog', fail), h.gate.run('deku', fail), h.gate.run('trunoest', fail)]);
  assert.equal(calls, 1);
  assert.ok(results.every(r => r.status === 'rejected' && r.reason.retryAt >= retryAt));
  assert.equal(saved.status, 429);
  for (let i = 0; i < 10; i++) await assert.rejects(h.gate.run('frog', fail), /Requests paused until/);
  assert.equal(calls, 1);
  h.advance(601001);
  assert.deepEqual(await h.gate.run('frog', async () => {calls++; return ['fresh'];}), ['fresh']);
  assert.equal(calls, 2);
  assert.equal(saved.blockedUntil, 0);
});

test('cooldown survives a process restart and repeat failures increase wait', async () => {
  let saved;
  const h = clockGate({save: async s => { saved = structuredClone(s); }});
  const fail = async () => { throw Object.assign(new Error('Limited'), {httpStatus:429}); };
  await assert.rejects(h.gate.run('frog', fail));
  const first = saved.blockedUntil;
  const restarted = clockGate({load: async () => saved});
  let calls = 0;
  await assert.rejects(restarted.gate.run('deku', async () => {calls++;}), /paused/);
  assert.equal(calls, 0);
  h.advance(301001);
  await assert.rejects(h.gate.run('frog', fail));
  assert.ok(saved.blockedUntil - h.now() >= 600000);
  assert.ok(saved.blockedUntil > first);
});

test('reset parsing honors provider header, body and Retry-After without exposing payload', () => {
  const now = 1800000000000;
  const headers = new Headers({'x-ratelimit-reset': '1800000600', 'retry-after': '120'});
  assert.equal(gmgnRetryAt(headers, JSON.stringify({reset_at:1800000700}), now), now + 700000);
  assert.equal(gmgnRetryAt(new Headers({'retry-after':new Date(now+60000).toUTCString()}), 'invalid', now), now + 60000);
  assert.equal(gmgnRetryAt(new Headers({'x-ratelimit-reset':'junk'}), '{}', now), now);
});

test('security rejection stops further automatic requests', async () => {
  const h = clockGate(); let calls = 0;
  await assert.rejects(h.gate.run('frog', async () => {calls++; throw Object.assign(new Error('GMGN security screening blocked this server.'), {httpStatus:403});}));
  h.advance(86400000);
  await assert.rejects(h.gate.run('deku', async () => {calls++;}), /security/);
  assert.equal(calls, 1);
});

test('unreadable persisted cooldown fails closed for every caller', async () => {
  const h = clockGate({load: async () => {throw new Error('storage unavailable');}});
  let calls = 0;
  for (const key of ['frog','deku']) await assert.rejects(h.gate.run(key, async () => {calls++;}), /storage unavailable/);
  assert.equal(calls, 0);
});
