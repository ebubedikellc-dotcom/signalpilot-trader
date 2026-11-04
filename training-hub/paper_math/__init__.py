"""Paper-only arithmetic and validation. No model, trading or network calls."""
import ast
import json
import re
from decimal import Decimal, DecimalException, localcontext, ROUND_FLOOR
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, BeforeValidator, Field, model_validator

VERSION = '1.0.0'

def number(v):
    # Decimal strings preserve the original value; floats/bools are never coerced.
    if not isinstance(v, str) or not re.fullmatch(r'-?\d{1,12}(?:\.\d{1,8})?', v):
        raise ValueError('Use a decimal string: at most 12 integer and 8 fractional digits.')
    return Decimal(v)

Number = Annotated[Decimal, BeforeValidator(number)]
Positive = Annotated[Number, Field(gt=0)]
Nonnegative = Annotated[Number, Field(ge=0)]
Text = Annotated[str, Field(min_length=1, max_length=140)]

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, frozen=True)

class Candle(Strict):
    open: Positive
    high: Positive
    low: Positive
    close: Positive
    completed: bool

    @model_validator(mode='after')
    def valid_ohlc(self):
        if not self.low <= min(self.open, self.close) <= max(self.open, self.close) <= self.high:
            raise ValueError('OHLC values are inconsistent.')
        return self

class Case(Strict):
    mode: Literal['PAPER']
    label: Text
    source: Text
    unit: Text
    currency: Literal['USD']
    side: Literal['LONG', 'SHORT']
    rule: Literal['CLOSE_ABOVE', 'CLOSE_BELOW', 'LONG_DISPLACEMENT', 'SHORT_DISPLACEMENT']
    threshold: Positive
    previous: Candle
    latest: Candle
    entry: Positive
    stop: Positive
    target: Positive
    value_per_point: Positive
    quantity_step: Positive
    risk_budget: Positive
    minimum_rr: Nonnegative
    funding: Literal['CASH', 'MARGIN']
    available_cash: Nonnegative
    margin_per_unit: Nonnegative
    available_margin: Nonnegative
    entry_liquidity: Nonnegative
    exit_liquidity: Nonnegative
    entry_executable: bool
    exit_executable: bool
    entry_fixed: Nonnegative
    exit_fixed: Nonnegative
    entry_per_unit: Nonnegative
    exit_per_unit: Nonnegative
    stop_allowance_per_unit: Nonnegative

    @model_validator(mode='after')
    def geometry(self):
        if self.side == 'LONG' and not self.stop < self.entry < self.target:
            raise ValueError('Long requires stop < entry < target.')
        if self.side == 'SHORT' and not self.target < self.entry < self.stop:
            raise ValueError('Short requires target < entry < stop.')
        if self.rule in ('CLOSE_ABOVE', 'LONG_DISPLACEMENT') and self.side != 'LONG':
            raise ValueError('This rule requires LONG.')
        if self.rule in ('CLOSE_BELOW', 'SHORT_DISPLACEMENT') and self.side != 'SHORT':
            raise ValueError('This rule requires SHORT.')
        if self.funding == 'CASH' and (self.side != 'LONG' or self.value_per_point != 1):
            raise ValueError('Cash mode supports unleveraged LONG with value_per_point=1 only.')
        if self.funding == 'MARGIN' and self.margin_per_unit <= 0:
            raise ValueError('Margin mode requires positive margin_per_unit.')
        return self

class Proposal(Strict):
    action: Literal['BUY', 'SELL_SHORT', 'NO_TRADE']
    quantity: Nonnegative
    entry: Positive | None
    stop: Positive | None
    target: Positive | None
    costs: Nonnegative
    risk: Nonnegative
    reward: Number
    margin: Nonnegative
    cash: Nonnegative
    source: Text
    rationale: Annotated[str, Field(min_length=1, max_length=1000)]

def fmt(x):
    s = format(x, 'f')
    return s.rstrip('0').rstrip('.') if '.' in s else s

def strict_json(raw):
    def pairs(items):
        out = {}
        for k, v in items:
            if k in out:
                raise ValueError('Duplicate JSON key.')
            out[k] = v
        return out
    return json.loads(raw, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite number.')))

def parse_proposal(raw):
    if not isinstance(raw, str) or len(raw) > 12000:
        raise ValueError('Missing or oversized decision.')
    # Accept one JSON object or one fenced JSON object; never infer values from prose.
    raw = raw.strip()
    if raw.startswith('```json\n') and raw.endswith('\n```'):
        raw = raw[8:-4].strip()
    return Proposal.model_validate(strict_json(raw))

def pattern(c):
    p, n = c.previous, c.latest
    pb, nb = abs(p.close-p.open), abs(n.close-n.open)
    if not n.completed or (c.rule.endswith('DISPLACEMENT') and not p.completed):
        ok = False
    elif c.rule == 'CLOSE_ABOVE': ok = n.close > c.threshold
    elif c.rule == 'CLOSE_BELOW': ok = n.close < c.threshold
    elif c.rule == 'LONG_DISPLACEMENT': ok = n.close > n.open and nb > pb and n.close > p.high
    else: ok = n.close < n.open and nb > pb and n.close < p.low
    return ok, {'previous_body':fmt(pb), 'latest_body':fmt(nb),
                'previous_range':fmt(p.high-p.low), 'latest_range':fmt(n.high-n.low)}

def totals(c, q):
    if not q:
        return {k:Decimal(0) for k in ('costs','risk','reward','margin','cash')}
    costs = c.entry_fixed+c.exit_fixed+q*(c.entry_per_unit+c.exit_per_unit)
    risk = q*(abs(c.entry-c.stop)*c.value_per_point+c.stop_allowance_per_unit)+costs
    reward = q*abs(c.target-c.entry)*c.value_per_point-costs
    margin = q*c.margin_per_unit if c.funding == 'MARGIN' else Decimal(0)
    cash = c.entry_fixed+q*c.entry_per_unit+(q*c.entry if c.funding == 'CASH' else margin)
    return dict(costs=costs,risk=risk,reward=reward,margin=margin,cash=cash)

def floor_step(x, step):
    return max(Decimal(0), (x/step).to_integral_value(rounding=ROUND_FLOOR)*step)

def calculate(case):
    c = case if isinstance(case, Case) else Case.model_validate(case)
    with localcontext() as ctx:
        ctx.prec = 80
        fixed = c.entry_fixed+c.exit_fixed
        per_risk = abs(c.entry-c.stop)*c.value_per_point+c.entry_per_unit+c.exit_per_unit+c.stop_allowance_per_unit
        cost_at_entry = c.entry_per_unit+(c.entry if c.funding == 'CASH' else c.margin_per_unit)
        limits = [(c.risk_budget-fixed)/per_risk, c.entry_liquidity, c.exit_liquidity,
                  (c.available_cash-c.entry_fixed)/cost_at_entry]
        if c.funding == 'MARGIN': limits.append(c.available_margin/c.margin_per_unit)
        q = floor_step(min(limits), c.quantity_step)
        t = totals(c, q)
        trigger, candles = pattern(c)
        reasons = []
        if not trigger: reasons.append('Pattern / completed-close rule is not met.')
        if not c.entry_executable or not c.exit_executable: reasons.append('Entry or whole-position exit is unavailable.')
        if q == 0: reasons.append('No permitted size fits all stated limits.')
        if q > 0 and t['reward'] < c.minimum_rr*t['risk']: reasons.append('Net reward/risk is below the stated minimum.')
        action = ('BUY' if c.side == 'LONG' else 'SELL_SHORT') if not reasons else 'NO_TRADE'
        return {'version':VERSION, 'mode':'PAPER', 'expected_action':action,
                'maximum_conditional_quantity':fmt(q), 'committed_quantity':fmt(q if not reasons else Decimal(0)),
                'conditional_totals':{k:fmt(v) for k,v in t.items()},
                'conditional_rr':fmt(t['reward']/t['risk']) if q else None,
                'committed_totals':{k:fmt(v) for k,v in (t if not reasons else totals(c,Decimal(0))).items()},
                'pattern':candles, 'pattern_pass':trigger, 'reasons':reasons,
                'fill_assumed':False, 'stop_guarantees_cap':False,
                'limit':'Checks stated paper inputs only; no market forecast, fill or profit guarantee.'}

def check(case, proposal):
    try:
        c = Case.model_validate(case)
        p = parse_proposal(proposal) if isinstance(proposal,str) else Proposal.model_validate(proposal)
    except (ValueError, TypeError) as e:
        return {'status':'NOT_VERIFIED','accepted_for_paper':False,
                'reasons':['Missing or invalid structured inputs / decision. '+str(e)[:800]], 'fill_assumed':False}
    with localcontext() as ctx:
        ctx.prec=80
        reference=calculate(c)
        problems=[]
        if p.action != reference['expected_action']: problems.append('Final action does not follow the supplied rule.')
        q=p.quantity
        if p.action == 'NO_TRADE':
            if q != 0: problems.append('NO_TRADE requires zero quantity.')
            if any(x is not None for x in (p.entry,p.stop,p.target)): problems.append('NO_TRADE requires null order levels.')
            expected=totals(c,Decimal(0))
        else:
            if q <= 0 or q % c.quantity_step: problems.append('Quantity must be positive and a permitted size increment.')
            if q != Decimal(reference['maximum_conditional_quantity']): problems.append('Quantity is not the requested maximum permitted size.')
            if (p.entry,p.stop,p.target)!=(c.entry,c.stop,c.target): problems.append('Order levels differ from the frozen setup.')
            expected=totals(c,q)
            if expected['risk']>c.risk_budget: problems.append('Cost-inclusive planned loss exceeds budget.')
            if expected['cash']>c.available_cash or expected['margin']>c.available_margin: problems.append('Cash or margin limit exceeded.')
            if q>min(c.entry_liquidity,c.exit_liquidity): problems.append('Quantity exceeds declared liquidity.')
        for field,val in expected.items():
            if getattr(p,field)!=val: problems.append(field+' does not equal the independent calculation ('+fmt(val)+').')
        if p.source != c.source: problems.append('Source label differs from the supplied reference; citation content needs review.')
        return {'status':'FAIL' if problems else 'PASS','accepted_for_paper':not problems,
                'reasons':problems,'reference':reference, 'actual_proposal':p.model_dump(mode='json'),
                'actual_quantity_totals':{k:fmt(v) for k,v in expected.items()},
                'source_content_verified':False,'rationale_verified':False,'fill_assumed':False}

def calculator(expression):
    """Bounded decimal arithmetic; no eval, names, attributes, functions or code execution."""
    if not isinstance(expression,str) or not 0<len(expression)<=256:
        raise ValueError('Use an arithmetic expression of 1-256 characters.')
    try:
        tree=ast.parse(expression.strip(),mode='eval')
        if len(list(ast.walk(tree)))>64: raise ValueError('Expression is too complex.')
        def run(node):
            if isinstance(node,ast.Constant) and type(node.value) in (int,float):
                raw=ast.get_source_segment(expression.strip(),node)
                return number(raw)
            if isinstance(node,ast.UnaryOp) and isinstance(node.op,(ast.UAdd,ast.USub)):
                v=run(node.operand);return v if isinstance(node.op,ast.UAdd) else -v
            if isinstance(node,ast.BinOp) and isinstance(node.op,(ast.Add,ast.Sub,ast.Mult,ast.Div,ast.Pow)):
                a,b=run(node.left),run(node.right)
                if isinstance(node.op,ast.Add):v=a+b
                elif isinstance(node.op,ast.Sub):v=a-b
                elif isinstance(node.op,ast.Mult):v=a*b
                elif isinstance(node.op,ast.Div):v=a/b
                else:
                    if b != b.to_integral_value() or abs(b)>12:raise ValueError('Exponent must be an integer from -12 to 12.')
                    v=a**int(b)
                if not v.is_finite() or (v and abs(v.adjusted())>80):raise ValueError('Result is outside supported limits.')
                return v
            raise ValueError('Only decimal numbers, brackets and + - * / ** are supported.')
        with localcontext() as ctx:
            ctx.prec=80
            value=run(tree.body)
            return {'result':fmt(value),'precision_digits':80,'mode':'PAPER'}
    except (SyntaxError,DecimalException,OverflowError,RecursionError) as e:
        raise ValueError('Invalid arithmetic or division by zero.') from e
