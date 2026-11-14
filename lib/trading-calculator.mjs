// Exact decimal arithmetic for linear, same-instrument mark-to-stop scenarios.
// No wallet access, order submission, or assumptions about fill prices.
const S = 100000000n;
const names = ['currentPrice','stopPrice','pointValue','existingUnits','addedUnits','unitStep','fixedExitCost','exitCostPerUnit','riskBudget'];
const fail = message => Object.assign(new Error(message), {status:400});
function decimal(value, name) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/.test(value))
    throw fail(`${name} must be a non-negative decimal string with up to 8 decimal places.`);
  const [whole, fraction=''] = value.split('.');
  return BigInt(whole)*S + BigInt(fraction.padEnd(8,'0'));
}
function format(value) {
  const whole=value/S, fraction=(value%S).toString().padStart(8,'0').replace(/0+$/,'');
  return `${whole}${fraction?'.'+fraction:''}`;
}
function ceilDivide(n,d) { return (n+d-1n)/d; }
export function calculateTradingRisk(input) {
  if (!input || Array.isArray(input) || typeof input !== 'object') throw fail('Provide all trading inputs.');
  if (!['long','short'].includes(input.side)) throw fail('Choose long or short.');
  const v=Object.fromEntries(names.map(name=>[name,decimal(input[name],name)]));
  if (!v.currentPrice || !v.stopPrice || !v.pointValue || !v.unitStep || !v.riskBudget)
    throw fail('Prices, point value, unit step and risk budget must be greater than zero.');
  const distance=input.side==='long'?v.currentPrice-v.stopPrice:v.stopPrice-v.currentPrice;
  if (distance<=0n) throw fail('A long stop must be below the current price; a short stop must be above it.');
  if (v.addedUnits%v.unitStep!==0n) throw fail('Added units must be a multiple of the unit step.');
  const perUnit=distance*v.pointValue+v.exitCostPerUnit*S;
  const riskNumerator=q=>q*perUnit+v.fixedExitCost*S*S;
  const budgetNumerator=v.riskBudget*S*S;
  const current=riskNumerator(v.existingUnits), proposed=riskNumerator(v.existingUnits+v.addedUnits);
  const available=budgetNumerator-current;
  const maximum=available<0n?0n:(available/(v.unitStep*perUnit))*v.unitStep;
  const money=n=>format(ceilDivide(n,S*S)); // Display risk rounded upward, never down.
  return {
    calculation:'linear-mark-to-stop', input:{side:input.side,...Object.fromEntries(names.map(n=>[n,input[n]]))},
    currentRisk:money(current), proposedRisk:money(proposed), riskBudget:format(v.riskBudget),
    maxAdditionalUnits:format(maximum), withinBudget:proposed<=budgetNumerator,
    existingPositionExceedsBudget:current>budgetNumerator,
    checks:{completeInputs:true,validStopDirection:true,validUnitStep:true,includesExistingUnits:true,includesExitCosts:true},
    formula:'(existing units + added units) × (price-to-stop distance × point value + exit cost per unit) + fixed exit cost',
    basis:'Calculation from supplied inputs. Linear exposure only; supplied exit costs apply to the total resulting position. Stop execution and maximum actual loss are not guaranteed.',
    executionAuthorized:false
  };
}
