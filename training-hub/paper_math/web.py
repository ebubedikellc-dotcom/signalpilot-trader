"""Additive paper desk adapter. No lesson writes, model feedback or broker calls."""
import json
import sqlite3
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from . import Case, VERSION, calculator, review, strict_json


def database():
    import store
    db=sqlite3.connect(store.ROOT/'paper-math.sqlite',timeout=10)
    db.row_factory=sqlite3.Row
    db.execute('CREATE TABLE IF NOT EXISTS reviews (token TEXT PRIMARY KEY, request_id TEXT, created REAL, setup TEXT NOT NULL, answer TEXT, error TEXT)')
    db.execute('CREATE TABLE IF NOT EXISTS checked_results (token TEXT PRIMARY KEY, created REAL NOT NULL, checker_version TEXT NOT NULL, assessment TEXT NOT NULL)')
    return db


def save_assessment(db, token, setup, answer):
    """Freeze one separate assessment, without overwriting a prior result."""
    saved = db.execute('SELECT assessment FROM checked_results WHERE token=?', (token,)).fetchone()
    if saved is not None:
        return json.loads(saved['assessment'])
    try:
        assessment = review(setup, answer)
    except Exception:
        assessment = {'status':'NOT_VERIFIED', 'accepted_for_paper':False,
                      'reasons':['Independent calculation could not be completed.'],
                      'final_result':{'status':'NOT_VERIFIED', 'decision':None,
                                      'accepted_for_paper':False,
                                      'checker_version':VERSION,
                                      'message':'No corrected result was verified.'}}
    db.execute('INSERT OR IGNORE INTO checked_results(token,created,checker_version,assessment) VALUES(?,?,?,?)',
               (token, time.time(), VERSION, json.dumps(assessment)))
    return json.loads(db.execute('SELECT assessment FROM checked_results WHERE token=?', (token,)).fetchone()['assessment'])


def prompt(c):
    d=c.model_dump(mode='json')
    # Input facts and output contract only; calculated answers never enter the model prompt.
    text='PAPER only; no orders. Use '+c.source+'. Apply this supplied rule to these facts: '+json.dumps(d,separators=(',',':'))
    text+='\nRule names: CLOSE_ABOVE/BELOW means completed latest close strictly above/below threshold. LONG/SHORT_DISPLACEMENT requires completed candles, latest bullish/bearish, larger abs(close-open) body and close above previous high/below previous low. All entries also require executable entry/exit, cost-inclusive risk<=budget and net reward/risk>=minimum_rr. Choose maximum size fitting risk, cash, margin, liquidity and quantity_step. stop_allowance_per_unit adds to budgeted risk only. Costs=entry_fixed+exit_fixed+quantity*(entry_per_unit+exit_per_unit). CASH means unleveraged purchase; MARGIN reserves margin plus entry fees. Return ONLY JSON with action BUY/SELL_SHORT/NO_TRADE, quantity, entry, stop, target, costs, risk, reward, margin, cash, source, rationale. All numbers decimal strings. NO_TRADE: quantity/totals "0", levels null. Never invent missing inputs or future prices.'
    if len(text)>2000:raise ValueError('Setup text is too long for the existing question limit; shorten labels/source.')
    return text


def submit(data, chat_answer):
    import question_queue
    c=Case.model_validate(data)
    question=prompt(c)
    token=str(uuid.uuid4())
    with database() as db:db.execute('INSERT INTO reviews(token,created,setup) VALUES(?,?,?)',(token,time.time(),c.model_dump_json()))
    def answer(_):
        try:
            raw=chat_answer({'question':question})
            if not isinstance(raw,str) or not raw.strip():raise ValueError('No completed answer.')
            with database() as db:
                db.execute('UPDATE reviews SET answer=? WHERE token=?',(raw,token))
                save_assessment(db, token, c.model_dump(mode='json'), raw)
            return raw
        except Exception:
            with database() as db:db.execute('UPDATE reviews SET error=? WHERE token=?',('No completed answer was verified.',token))
            raise
    try:
        job=question_queue.submit({'question':question},answer)
    except Exception:
        with database() as db:db.execute('UPDATE reviews SET error=? WHERE token=?',('Not submitted: existing queue refused request.',token))
        raise
    with database() as db:db.execute('UPDATE reviews SET request_id=? WHERE token=?',(job['id'],token))
    return job


def result(key):
    import question_queue
    with database() as db:
        row=db.execute('SELECT * FROM reviews WHERE request_id=?',(key,)).fetchone()
        if row is None:raise ValueError('No saved paper setup for this request.')
        if row['answer'] is not None:
            setup = json.loads(row['setup'])
            return {'id':key,'status':'ready','answer':row['answer'],'setup':setup,
                    'check':save_assessment(db, row['token'], setup, row['answer'])}
    if row['error']:return {'id':key,'status':'failed','error':row['error'],'check':{'status':'NOT_VERIFIED'}}
    try:return question_queue.get(key)
    except ValueError:return {'id':key,'status':'unverified','error':'Question unavailable after restart; do not assume a decision or resubmit automatically.'}


def install(Handler, chat_answer):
    from . import demo
    old_get,old_post=Handler.do_GET,Handler.do_POST
    def get(self):
        route=urlparse(self.path).path
        if route=='/paper-demo':
            return self.send(200,Path(__file__).with_name('demo.html').read_bytes(),'text/html; charset=utf-8')
        if route=='/api/paper-demo/status':
            try:
                offset=int(parse_qs(urlparse(self.path).query).get('offset',['0'])[0])
                if not 0<=offset<=100000:raise ValueError('Invalid history offset.')
                return self.send(200,demo.public_status(offset))
            except ValueError as e:return self.send(400,{'error':str(e)})
        if route=='/paper-math':
            return self.send(200,Path(__file__).with_name('panel.html').read_bytes(),'text/html; charset=utf-8')
        if route=='/api/paper-math/health':return self.send(200,{'version':VERSION,'mode':'PAPER','calculator':'Python Decimal','validator':'Pydantic','orders_enabled':False})
        if route.startswith('/api/paper-math/result/'):
            try:return self.send(200,result(route.rsplit('/',1)[1]))
            except ValueError as e:return self.send(404,{'error':str(e)})
        return old_get(self)
    def post(self):
        route=urlparse(self.path).path
        if route not in ('/api/paper-math/calculate','/api/paper-math/check','/api/paper-math/submit',
                         '/api/paper-demo/start','/api/paper-demo/pause','/api/paper-demo/resume'):
            return old_post(self)
        if self.headers.get('X-Trade-Lord')!='1' or self.headers.get('Sec-Fetch-Site')=='cross-site':
            return self.send(403,{'error':'Use your own Trade Lord page.'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=16000:raise ValueError('Use a JSON request under 16 KB.')
            self.connection.settimeout(15)
            data=strict_json(self.rfile.read(size).decode('utf-8'))
            if not isinstance(data,dict):raise ValueError('Send a JSON object.')
            if route.startswith('/api/paper-demo/'):
                if data:raise ValueError('No settings or trading-rule changes are accepted here.')
                if route.endswith('/start'):demo.start()
                else:demo.pause(route.endswith('/pause'))
                return self.send(200,demo.public_status())
            if route.endswith('/calculate'):
                if set(data)!={'expression'}:raise ValueError('Expected expression only.')
                return self.send(200,calculator(data['expression']))
            if route.endswith('/check'):
                if set(data)!={'case','proposal'}:raise ValueError('Expected case and proposal.')
                return self.send(200,review(data['case'],data['proposal']))
            return self.send(202,submit(data,chat_answer))
        except (ValueError,TypeError,UnicodeError) as e:return self.send(400,{'error':str(e)[:1000]})
        except Exception:return self.send(503,{'error':'Paper checker unavailable; no decision verified.'})
    Handler.do_GET,Handler.do_POST=get,post
    demo.launch(chat_answer)
