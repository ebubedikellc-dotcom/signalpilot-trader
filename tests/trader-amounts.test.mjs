import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {sourceAmountsFromSwap} from '../lib/trader-amounts.mjs';
const SOL='So11111111111111111111111111111111111111112',USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const token=(mint,raw,decimals)=>({mint,rawTokenAmount:{tokenAmount:raw,decimals}});
const tx=(input,output,source='SOLANA_DIRECT')=>({source,events:{swap:{tokenInputs:[input],tokenOutputs:[output]}}});
const script=readFileSync(new URL('../script.js',import.meta.url),'utf8');
const c=vm.createContext({money:n=>'$'+n});
vm.runInContext(script.slice(script.indexOf('function traderTapeAmount('),script.indexOf('function walletBalance(')),c);
test('tape shows actual trader payment independently of capped copy size',()=>{
 const sourceAmounts=sourceAmountsFromSwap(tx(token(SOL,'250010000',9),token('coin','990000000000',6)));
 assert.equal(sourceAmounts.side,'buy');assert.equal(sourceAmounts.verified,true);
 const label=c.traderTapeAmount({action:'Buy signal',sourceAmounts,execution:{swapUsdValue:10}},'Frog');
 assert.match(label,/Frog paid for this buy: 0.25001 SOL/);assert.doesNotMatch(label,/\$10/);
});
test('sell shows quote received and percentage, never raw coin quantity as dollars',()=>{
 const sourceAmounts=sourceAmountsFromSwap(tx(token('coin','12345678901234567890',9),token(USDC,'42005000',6)));
 const label=c.traderTapeAmount({action:'Sell signal',sourceAmounts,execution:{sourceSale:{soldPercent:50},swapUsdValue:3}},'Frog');
 assert.match(label,/received from this sale: 42.005 USDC/);assert.match(label,/Sold 50%/);assert.doesNotMatch(label,/123456789|\$3/);
 assert.equal(c.traderTapeAmount({action:'Manual sell',sourceAmounts},'Frog'),'');
});
test('missing and synthetic feed amounts are explicitly unavailable',()=>{
 const synthetic=tx(token(SOL,'5000000000',9),token('coin','1000000',6),'GMGN');
 assert.equal(sourceAmountsFromSwap(synthetic),null);
 synthetic.gmgn={quote_address:SOL,quote_amount:'0.12345'};
 const sourceAmounts=sourceAmountsFromSwap(synthetic);assert.equal(sourceAmounts.paid.raw,'123450000');assert.equal(sourceAmounts.verified,false);
 assert.match(c.traderTapeAmount({action:'Buy signal',sourceAmounts},'Frog'),/0.12345 SOL · feed report/);
 assert.match(c.traderTapeAmount({action:'Sell signal',amount:10000000},'Frog'),/Amount unavailable/);
 assert.equal(sourceAmountsFromSwap({}),null);
});
