"""Seven-day forward paper runner. Real observations; virtual orders only.

No exchange order client, account credentials, lesson writes or model feedback.
"""
import hashlib
import json
import sqlite3
import threading
import time
import uuid
from decimal import Decimal as D, ROUND_FLOOR, ROUND_CEILING
from . import Case, calculate, fmt, parse_proposal, review, totals
from .market import KrakenFeed, FeedError, fresh

DAYS = 7 * 86400
POLL = 15
MAX_GAP = 45
DECISION_TTL = 20 * 60
MAX_HOLD = 30 * 60
FEE = D('.004')
SLIP = D('.001')
PARTICIPATION = D('.10')
SOURCE_ID = '95010837-b3f7-41f3-b913-1b25113aa967'
SOURCE = 'Meme coins - liquidity, token checks and execution risk'
POLICY = (
    'Forward PAPER on Kraken DOGE/USD public data only. No real orders. Future prices are unknown, never generated. '
    'Fixed experiment rule: BUY only when latest completed 5-minute close exceeds previous completed high, '
    'net planned reward/risk >=1.5 and all limits fit. Long cash only; whole tokens; $25 maximum risk, '
    'at most 0.5% of the lower account equity, and at most $1000 cash. Stop 1.5% below frozen entry; target 5% above. '
    'Frozen entry rounds up and stop/target down to the venue price tick; simulated buys round up, sells down. '
    'Entry limit includes 0.1% adverse price adjustment. Fixed simulated commission each side is 0.4% of the frozen '
    'entry price per token, not a claim about an actual account fee tier. Stop sizing includes 0.1% adverse fill allowance. '
    'After the completed answer, use a new public book snapshot. Never backdate a fill. One immediate all-or-none '
    'entry attempt; reject missing data, expired 20-minute setup, changed levels, excess cash or quantity, venue minimum '
    'failure, quote above limit, or already-crossed stop/target. Use at most 10% of displayed top-of-book size. '
    'Simulated entry is ask plus 0.1%; stop exit is first observed bid minus 0.1%; target fills conservatively at target '
    'only when adjusted bid reaches it. Bid/ask spread is embodied in the prices, not charged twice. '
    'Stops latch when triggered; insufficient exit depth waits without inventing a partial fill. Time exit after 30 minutes '
    'or at the seven-day deadline uses the next eligible bid minus 0.1%. Pause blocks new entries, continues observation '
    'of existing positions. Observation gaps over 45 seconds with an open position become UNRESOLVED and pause the run. '
    'Normal sampling is every 15 seconds, not a tick-complete replay: intrapoll moves are not known. Displayed depth '
    'does not guarantee real execution, queue priority or market impact. Original and checked accounts are separate. '
    'These rules stay fixed for a run; they are an evaluation protocol, not a demonstrated profitable strategy.')
RUBRIC = ('Grade original decision arithmetic and adherence to frozen inputs separately from simulated profit or loss. '
    'PASS means the structured numeric decision follows the programmed rules, not that it will profit. '
    'No malformed prose is turned into an order. Source content and rationale need owner review. '
    'Calculated corrections appear only in the owner report; they are never supplied back to Trade Lord as lessons or feedback.')
TERMINAL = {'NO_TRADE','NO_FILL','REJECTED','NOT_VERIFIED','STOP','TARGET','TIME_EXIT','UNRESOLVED'}


def db():
    import store
    store.ROOT.mkdir(parents=True, exist_ok=True)
    con=sqlite3.connect(store.ROOT/'paper-demo.sqlite',timeout=15)
    con.row_factory=sqlite3.Row
    con.executescript('''CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, started REAL NOT NULL, ends REAL NOT NULL, paused INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL,
        token TEXT NOT NULL, kind TEXT NOT NULL, created REAL NOT NULL, payload TEXT NOT NULL, UNIQUE(token,kind));''')
    return con


def event(con,sid,token,kind,data,now=None):
    con.execute('INSERT OR IGNORE INTO events(session,token,kind,created,payload) VALUES(?,?,?,?,?)',
        (sid,token,kind,time.time() if now is None else now,json.dumps(data,sort_keys=True)))


def events(con,sid):
    return [dict(r,payload=json.loads(r['payload'])) for r in con.execute('SELECT * FROM events WHERE session=? ORDER BY seq',(sid,))]


def start(now=None):
    now=time.time() if now is None else now
    with db() as con:
        con.execute('BEGIN IMMEDIATE')
        old=con.execute('SELECT * FROM sessions ORDER BY started DESC LIMIT 1').fetchone()
        if old:
            ev=events(con,old['id'])
            unfinished={x['token'] for x in ev if x['kind']=='precommit'}-{x['token'] for x in ev if x['kind']=='result'}
            unresolved=any(x['kind']=='result' and any(x['payload'][k]['status']=='UNRESOLVED' for k in ('original','checked')) for x in ev)
            if now<old['ends'] or unfinished or unresolved:
                raise ValueError('Existing run or unresolved record must be recovered; no new run created.')
        sid=str(uuid.uuid4())
        con.execute('INSERT INTO sessions VALUES(?,?,?,0)',(sid,now,now+DAYS))
        event(con,sid,sid,'start',dict(equity='5000',mode='FORWARD_PUBLIC_DATA',policy=POLICY,rubric=RUBRIC),now)
    return sid


def pause(value):
    with db() as con:
        row=con.execute('SELECT * FROM sessions ORDER BY started DESC LIMIT 1').fetchone()
        if not row: raise ValueError('No run has started.')
        con.execute('UPDATE sessions SET paused=? WHERE id=?',(int(value),row['id']))
        event(con,row['id'],str(uuid.uuid4()),'pause' if value else 'resume',{})


def tick_price(price,step,up=False):
    return (price/step).to_integral_value(rounding=ROUND_CEILING if up else ROUND_FLOOR)*step


def make_case(snapshot,equity):
    q=snapshot['quote']; prev,last=snapshot['bars']; step=D(snapshot['price_step'])
    e=tick_price(D(q['ask'])*(1+SLIP),step,True)
    stop=tick_price(e*D('.985'),step);target=tick_price(e*D('1.05'),step)
    budget=min(D('25'),D(equity)*D('.005'))
    c=dict(mode='PAPER',label='Forward DOGE/USD',source=SOURCE,unit='DOGE tokens',currency='USD',side='LONG',
        rule='CLOSE_ABOVE',threshold=prev['high'],
        previous={k:v for k,v in prev.items() if k!='time'},latest={k:v for k,v in last.items() if k!='time'},
        entry=fmt(e),stop=fmt(stop),target=fmt(target),value_per_point='1',quantity_step='1',
        risk_budget=fmt(budget),minimum_rr='1.5',funding='CASH',available_cash=fmt(min(D(equity),D('1000'))),
        margin_per_unit='0',available_margin='0',entry_liquidity=fmt(D(q['ask_size'])*PARTICIPATION),
        exit_liquidity=fmt(D(q['bid_size'])*PARTICIPATION),entry_executable=True,exit_executable=True,
        entry_fixed='0',exit_fixed='0',entry_per_unit=fmt(e*FEE),exit_per_unit=fmt(e*FEE),
        stop_allowance_per_unit=fmt(stop-tick_price(stop*(1-SLIP),step)))
    Case.model_validate(c)
    proposed=D(calculate(c)['maximum_conditional_quantity'])
    if proposed<D(snapshot['minimum_quantity']) or proposed*e<D(snapshot['minimum_notional']):
        c['entry_executable']=False
    return c


def question(c,observed):
    # No answer key, observed future, previous grades or corrective lessons included.
    q=(f"FORWARD PAPER DOGE/USD on Kraken; no real orders. Use {c['source']}. Observed epoch {observed}. "
       f"Fixed BUY rule: completed 5-minute close {c['latest']['close']} > previous high {c['threshold']}, "
       f"net reward/risk >=1.5, risk <=${c['risk_budget']}; otherwise NO_TRADE. "
       f"Frozen entry limit {c['entry']}, stop {c['stop']}, target {c['target']}; $1/point/token, whole tokens, no borrowing. "
       f"Cash ${c['available_cash']}. Entry/exit available {c['entry_executable']}/{c['exit_executable']}; "
       f"liquidity caps {c['entry_liquidity']}/{c['exit_liquidity']}. "
       f"Fixed fees 0; per-token entry fee {c['entry_per_unit']}, exit fee {c['exit_per_unit']}; "
       f"extra adverse-stop allowance {c['stop_allowance_per_unit']} for sizing only. No margin. "
       "Give maximum size under ALL limits. This is one immediate simulated entry attempt AFTER your answer using a fresh quote, "
       "all-or-none, no entry above limit, setup expires after 20 minutes. Stops may slip; future prices unknown. "
       "Return ONLY JSON keys action,quantity,entry,stop,target,costs,risk,reward,margin,cash,source,rationale. "
       "Numbers must be decimal STRINGS. action BUY or NO_TRADE. NO_TRADE quantity/totals '0', levels null. "
       "Explain rule and stop limitation briefly. No real execution.")
    if len(q)>2000: raise ValueError('Demo prompt exceeds existing question limit.')
    return q


def empty(status,reason=''):
    return dict(status=status,pnl='0',costs='0',filled=False,reason=reason,net_marks=[])


def enter(case,raw,quote,now,deadline,meta):
    try: p=parse_proposal(raw if isinstance(raw,str) else json.dumps(raw))
    except (ValueError,TypeError): return empty('NOT_VERIFIED','No accepted structured decision; no inferred order.')
    if p.action=='NO_TRADE':
        if p.quantity!=0 or any(x is not None for x in (p.entry,p.stop,p.target)):
            return empty('NOT_VERIFIED','Contradictory no-trade instruction.')
        return empty('NO_TRADE')
    c=Case.model_validate(case);q=p.quantity
    if p.action!='BUY' or (p.entry,p.stop,p.target)!=(c.entry,c.stop,c.target):
        return empty('NOT_VERIFIED','Changed side/levels are unsupported; no accepted order.')
    if now>=deadline: return empty('NO_FILL','Setup expired or run ended before decision; no backdated fill.')
    if quote is None: return empty('NO_FILL','No eligible fresh quote for the single entry attempt.')
    try: fresh(quote,now)
    except FeedError as e: return empty('NO_FILL',str(e))
    step=D(meta['price_step']);ask=tick_price(D(quote['ask'])*(1+SLIP),step,True);bid=D(quote['bid']);t=totals(c,q)
    if q<=0 or q%c.quantity_step or not c.entry_executable or q>c.entry_liquidity or t['cash']>c.available_cash:
        return empty('REJECTED','Frozen cash, size or availability limit failed; no resizing.')
    if q<D(meta['minimum_quantity']) or q%D(meta['quantity_step']) or q*ask<D(meta['minimum_notional']):
        return empty('REJECTED','Venue minimum or size increment failed.')
    if ask>c.entry or bid<=c.stop or bid>=c.target:
        return empty('NO_FILL','Market moved beyond entry limit or crossed stop/target before entry.')
    if q>min(D(quote['ask_size']),D(quote['bid_size']))*PARTICIPATION:
        return empty('NO_FILL','Fresh displayed entry/exit liquidity cannot support the whole position.')
    fees=q*(c.entry_per_unit+c.exit_per_unit)
    mark=q*(tick_price(bid*(1-SLIP),step)-ask)-fees
    return dict(status='OPEN',pnl=None,costs=fmt(q*c.entry_per_unit),filled=True,quantity=fmt(q),entry=fmt(ask),
        stop=fmt(c.stop),target=fmt(c.target),entry_time=now,last_observed=now,exit_pending=None,
        exit_cost=fmt(q*c.exit_per_unit),price_step=fmt(step),net_marks=[fmt(mark)],mark_pnl=fmt(mark))


def advance(state,quote,now,ends):
    if state['status']!='OPEN': return state
    s=dict(state);s['net_marks']=list(state['net_marks'])
    if now-s['last_observed']>MAX_GAP:
        s.update(status='UNRESOLVED',reason='Observation gap exceeds 45 seconds; unseen stop/target order cannot be inferred.',mark_pnl=None)
        return s
    if quote is None: return s
    try: fresh(quote,now)
    except FeedError: return s
    if quote['observed_at']<=s['last_observed']: return s
    q=D(s['quantity']);bid=D(quote['bid']);adjusted=tick_price(bid*(1-SLIP),D(s['price_step']))
    s['last_observed']=quote['observed_at']
    if bid<=D(s['stop']):s['exit_pending']='STOP'
    elif s['exit_pending']!='STOP' and now>=min(ends,s['entry_time']+MAX_HOLD):s['exit_pending']='TIME_EXIT'
    elif not s['exit_pending'] and adjusted>=D(s['target']):s['exit_pending']='TARGET'
    if q>D(quote['bid_size'])*PARTICIPATION:
        s['mark_pnl']=None
        return s
    # A latched stop/time order remains pending. A target remains a limit order.
    reason=s['exit_pending']
    can_exit=reason and (reason!='TARGET' or adjusted>=D(s['target']))
    fill=D(s['target']) if can_exit and reason=='TARGET' else adjusted
    total_cost=D(s['costs'])+D(s['exit_cost'])
    pnl=q*(fill-D(s['entry']))-total_cost
    s['mark_pnl']=fmt(pnl);s['net_marks'].append(fmt(pnl))
    if can_exit:s.update(status=reason,pnl=fmt(pnl),costs=fmt(total_cost),exit=fmt(fill),exit_time=now)
    return s


def ledger(ev,which='original'):
    equity=peak=marked_peak=D('5000');costs=dd=marked_dd=D(0);filled=no_trade=rejected=unverified=0;unresolved=False
    for e in ev:
        if e['kind']!='result':continue
        r=e['payload'][which];costs+=D(r['costs'])
        filled+=bool(r['filled']);no_trade+=r['status']=='NO_TRADE';rejected+=r['status'] in ('REJECTED','NO_FILL');unverified+=r['status']=='NOT_VERIFIED'
        if r['pnl'] is None:unresolved=True;continue
        for delta in r.get('net_marks',[]):
            mark=equity+D(delta);marked_peak=max(marked_peak,mark);marked_dd=max(marked_dd,marked_peak-mark)
        equity+=D(r['pnl']);peak=max(peak,equity);dd=max(dd,peak-equity)
    return dict(equity=None if unresolved else fmt(equity),known_equity=fmt(equity),net=None if unresolved else fmt(equity-D('5000')),
        costs=fmt(costs),closed_max_drawdown=fmt(dd),discrete_marked_max_drawdown=fmt(marked_dd),
        filled=filled,no_trade=no_trade,rejected=rejected,not_verified=unverified,unresolved=unresolved)


def public_status(offset=0):
    with db() as con:
        s=con.execute('SELECT * FROM sessions ORDER BY started DESC LIMIT 1').fetchone()
        if not s:return {'state':'NOT_STARTED','orders_enabled':False,'mode':'FORWARD_PUBLIC_DATA'}
        s=dict(s);ev=events(con,s['id'])
    out=dict(s,state='ENDED' if time.time()>=s['ends'] else 'PAUSED' if s['paused'] else 'RUNNING',
        mode='FORWARD_PUBLIC_DATA',orders_enabled=False,original_ledger=ledger(ev),checked_ledger=ledger(ev,'checked'),cases=[],
        coverage='DOGE/USD on Kraken only. Gold, stocks, options and other tokens have no verified feed in this version.',
        notice=POLICY,health=next((x['payload'] for x in reversed(ev) if x['kind']=='health'),None))
    cases=[x for x in ev if x['kind']=='precommit']
    out['total_cases']=len(cases)
    out['offset']=offset
    out['next_offset']=offset+20 if offset+20<len(cases) else None
    for e in list(reversed(cases))[offset:offset+20]:
        g={x['kind']:x['payload'] for x in ev if x['token']==e['token']}
        steps=[x['payload'] for x in ev if x['token']==e['token'] and x['kind'].startswith('step:')]
        item=dict(token=e['token'],created=e['created'],question=e['payload']['question'],commitment=e['payload']['commitment'],request=g.get('request'),status='PENDING')
        if 'answer' in g:item.update(answer=g['answer'],assessment=g.get('assessment'))
        if steps:item.update(status='OBSERVING',positions=steps[-1])
        if 'result' in g:item.update(status='COMPLETE',result=g['result'],precommit=e['payload'],observations=steps)
        if 'uncertain' in g:item.update(status='NOT_VERIFIED',uncertainty=g['uncertain'])
        out['cases'].append(item)
    return out


def health(con,s,ev,state,reason,now):
    last=next((e['payload'] for e in reversed(ev) if e['kind']=='health'),None)
    data=dict(state=state,reason=reason)
    if data!=last:event(con,s['id'],str(uuid.uuid4()),'health',data,now)


def tick(chat_answer,now=None,feed=None):
    import fcntl,store,question_queue
    fixed_time=now
    clock=lambda: time.time() if fixed_time is None else fixed_time
    now=clock();feed=feed or KrakenFeed()
    store.ROOT.mkdir(parents=True,exist_ok=True)
    with open(store.ROOT/'paper-demo.lock','a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return
        with db() as con:
            row=con.execute('SELECT * FROM sessions ORDER BY started DESC LIMIT 1').fetchone()
            if not row:return
            s=dict(row);ev=events(con,s['id'])
            for e in ev:
                if e['kind']!='precommit':continue
                g={x['kind']:x['payload'] for x in ev if x['token']==e['token']}
                if 'result' in g:continue
                if 'uncertain' in g:return
                if 'answer' not in g:
                    try:
                        if 'request' not in g:raise ValueError('Submission status uncertain; no automatic duplicate.')
                        job=question_queue.get(g['request']['id'])
                        if job['status']=='ready':event(con,s['id'],e['token'],'answer',dict(raw=job['answer']),now)
                        elif job['status']=='failed':raise ValueError('Generation failed; no automatic retry.')
                    except ValueError as exc:
                        event(con,s['id'],e['token'],'uncertain',dict(reason=str(exc)),now)
                        con.execute('UPDATE sessions SET paused=1 WHERE id=?',(s['id'],))
                    return
                raw=g['answer']['raw'];p=e['payload'];c=p['case']
                assessment=g.get('assessment') or review(c,raw)
                event(con,s['id'],e['token'],'assessment',assessment,now)
                steps=[x['payload'] for x in ev if x['token']==e['token'] and x['kind'].startswith('step:')]
                try:quote=feed.quote();now=clock();fresh(quote,now)
                except FeedError:quote=None
                if steps:
                    states={k:advance(steps[-1][k],quote,now,s['ends']) for k in ('original','checked')}
                else:
                    deadline=min(e['created']+DECISION_TTL,s['ends'])
                    if s['paused']:deadline=now
                    states=dict(original=enter(c,raw,quote,now,deadline,p['snapshot']),
                        checked=enter(c,assessment['final_result']['decision'],quote,now,deadline,p['snapshot']))
                event(con,s['id'],e['token'],'step:'+str(uuid.uuid4()),dict(quote=quote,**states),now)
                if all(states[k]['status'] in TERMINAL for k in states):
                    feedback=('Original numeric decision follows the fixed rules.' if assessment['status']=='PASS' else
                        'Original decision not verified.' if assessment['status']=='NOT_VERIFIED' else 'Original decision has rule/calculation errors: '+' '.join(assessment['reasons']))
                    event(con,s['id'],e['token'],'result',dict(assessment=assessment,feedback=feedback,**states),now)
                    if any(states[k]['status']=='UNRESOLVED' for k in states):
                        con.execute('UPDATE sessions SET paused=1 WHERE id=?',(s['id'],))
                return
            if s['paused'] or now>=s['ends'] or ledger(ev)['unresolved'] or ledger(ev,'checked')['unresolved']:return
            finished=[e for e in ev if e['kind']=='result']
            if finished and now-finished[-1]['created']<60:return
            cur=question_queue.current()['job']
            if cur and cur['status'] not in ('ready','failed'):return
            try:source=store.get(SOURCE_ID)
            except ValueError:source={}
            if source.get('status')!='ready' or not source.get('lessons','').strip():
                health(con,s,ev,'WAITING_SOURCE','Relevant completed saved notes are unavailable.',now);return
            try:snapshot=feed.snapshot();now=clock();fresh(snapshot['quote'],now)
            except FeedError as exc:
                health(con,s,ev,'WAITING_FEED',str(exc),now);return
            health(con,s,ev,'CONNECTED','Public DOGE/USD feed verified for this observation.',now)
            key=snapshot['bars'][-1]['time']
            if any(e['kind']=='precommit' and e['payload']['bar_time']==key for e in ev):return
            equity=min(D(ledger(ev)['known_equity']),D(ledger(ev,'checked')['known_equity']))
            if equity<=0:
                con.execute('UPDATE sessions SET paused=1 WHERE id=?',(s['id'],));return
            c=make_case(snapshot,equity);q=question(c,snapshot['quote']['observed_at']);token=str(uuid.uuid4())
            payload=dict(case=c,question=q,snapshot=snapshot,bar_time=key,expected=calculate(c),rubric=RUBRIC,
                execution_policy=POLICY,source_id=SOURCE_ID,source_snapshot=source['lessons'],source_updated=source.get('updated'))
            payload['commitment']=hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()
            event(con,s['id'],token,'precommit',payload,now)
        # Freeze inputs, rules and grading BEFORE submission. The future is observed later, never invented.
        def answer(data):
            raw=chat_answer(data)
            if not isinstance(raw,str) or not raw.strip():raise ValueError('No complete answer.')
            with db() as con:event(con,s['id'],token,'answer',dict(raw=raw))
            return raw
        try:
            request=question_queue.submit({'question':q},answer)
            with db() as con:event(con,s['id'],token,'request',request)
        except Exception:
            with db() as con:
                event(con,s['id'],token,'uncertain',dict(reason='Queue submission not verified; never automatically resubmitted.'))
                con.execute('UPDATE sessions SET paused=1 WHERE id=?',(s['id'],))

_worker=None

def launch(chat_answer):
    global _worker
    if _worker and _worker.is_alive():return
    def loop():
        while True:
            try:tick(chat_answer)
            except Exception:
                try:pause(True)
                except Exception:pass
            time.sleep(POLL)
    _worker=threading.Thread(target=loop,daemon=True,name='paper-demo');_worker.start()
