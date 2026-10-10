import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFrogBrain } from '../lib/frog-brain.mjs';

const buy = (token, time, amount) => ({
  profile: 'Frog',
  action: 'Buy signal',
  token,
  tradedTokenMint: token,
  time,
  sourceAmounts: { paid: { amount, symbol: 'SOL' } }
});

const sell = (token, time, amount, soldPercent = 100) => ({
  profile: 'Frog',
  action: 'Sell signal',
  token,
  tradedTokenMint: token,
  time,
  sourceAmounts: { received: { amount, symbol: 'SOL' }, soldPercent }
});

const timed = (trade, detectionToSubmit) => ({
  ...trade,
  execution: { timingsMs: { detectionToSubmit } }
});

test('frog brain learns repeat buys, round trips and buy size without executing trades', () => {
  const brain = analyzeFrogBrain([
    buy('D96pump', '10/10/2026, 02:10:00', 0.49),
    buy('D96pump', '10/10/2026, 02:11:00', 0.24),
    sell('D96pump', '10/10/2026, 02:35:00', 4.72),
    buy('ALL22', '10/10/2026, 02:13:00', 0.24),
    sell('ALL22', '10/10/2026, 02:36:00', 0.3, 50)
  ]);

  assert.equal(brain.name, 'Frog Brain');
  assert.equal(brain.mode, 'shadow');
  assert.equal(brain.sample.buys, 3);
  assert.equal(brain.sample.sells, 2);
  assert.equal(brain.sample.repeatBuyTokens, 1);
  assert.equal(brain.sample.roundTripTokens, 2);
  assert.equal(brain.buySize.unit, 'SOL');
  assert.equal(brain.buySize.median, 0.24);
  assert.equal(brain.smartMove.name, 'Frog Smart Move');
  assert.equal(brain.smartMove.status, 'watch-and-protect');
  assert.match(brain.rules.join(' '), /add to the same coin/);
  assert.match(brain.nextStep, /Keep learning|Ready for paper/);
});

test('frog brain stays in data collection when history is too thin', () => {
  const brain = analyzeFrogBrain([buy('ONEpump', '10/10/2026, 02:10:00', 0.2)]);
  assert.equal(brain.readiness, 'collecting-data');
  assert.equal(brain.sample.roundTripTokens, 0);
  assert.equal(brain.holding.medianMinutes, null);
  assert.match(brain.nextStep, /Keep learning/);
});

test('frog smart move reads copy timing before recommending cleaner entries', () => {
  const brain = analyzeFrogBrain([
    timed(buy('A1pump', '10/10/2026, 02:10:00', 0.2), 420),
    timed(sell('A1pump', '10/10/2026, 02:15:00', 0.4), 650),
    timed(buy('B2pump', '10/10/2026, 02:20:00', 0.2), 480),
    timed(sell('B2pump', '10/10/2026, 02:25:00', 0.4), 700),
    timed(buy('C3pump', '10/10/2026, 02:30:00', 0.2), 450),
    timed(sell('C3pump', '10/10/2026, 02:35:00', 0.4), 730)
  ]);

  assert.equal(brain.smartMove.buySpeed, 'target');
  assert.equal(brain.smartMove.sellSpeed, 'backup');
  assert.equal(brain.smartMove.buyTimingMs, 450);
  assert.match(brain.smartMove.recommendation, /Follow Frog|Keep copying/);
  assert(brain.smartMove.rules.some(rule => /Profit Ladder/.test(rule)));
});
