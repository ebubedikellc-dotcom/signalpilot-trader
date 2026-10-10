import test from 'node:test';
import assert from 'node:assert/strict';
import {currentExitNotices} from '../lib/exit-status.mjs';
test('current diagnostics retain open coins, pending receipts and unresolved source sells without presenting closed history as blockers',()=>{
 const report={positions:{open:{raw:'20',mint:'openCoin'},closed:{raw:'0',mint:'closedCoin'}},pending:{pending:{mint:'pendingCoin'}},
 notices:{open:'Watching',closed:'Old 429',pending:'Awaiting confirmation',source:'Sell retry',old:'Expired'}};
 const original=JSON.stringify(report), result=currentExitNotices(report,{source:{}});
 assert.deepEqual(Object.keys(result.current),['open','pending','source']);
 assert.deepEqual(Object.keys(result.previous),['closed','old']);assert.match(result.current.open,/openCo/);
 assert.equal(JSON.stringify(report),original,'journal history must remain intact');
});
