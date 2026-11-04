import copy
import json
import tempfile
import types
import unittest
from decimal import Decimal as D
from pathlib import Path
from unittest.mock import patch, Mock
import store
# question_queue depends on the existing generated module; reuse the repository fixture.
import test_answer_fix
import question_queue
from paper_math import review
from paper_math import demo
from paper_math.market import KrakenFeed, FeedError, fresh

NOW=1800000000

def quote(t=NOW,bid='.999',ask='1',size='10000'):
    return dict(venue='Kraken',symbol='DOGE/USD',observed_at=t,bid_time=t,ask_time=t,bid=bid,ask=ask,bid_size=size,ask_size=size)

def snapshot(t=NOW):
    return dict(quote=quote(t),bars=[
        dict(time=t-600,open='0.98',high='0.99',low='0.97',close='0.985',completed=True),
        dict(time=t-300,open='0.985',high='1.01',low='0.98',close='1',completed=True)],
        minimum_quantity='1',minimum_notional='.5',quantity_step='.00000001',price_step='0.0000001',provider='fixture')

def decision(case,quantity=None):
    raw=dict(action='NO_TRADE',quantity='0',entry=None,stop=None,target=None,costs='0',risk='0',reward='0',cash='0',margin='0',source=demo.SOURCE,rationale='Fixture')
    p=review(case,raw)['final_result']['decision']
    if quantity is not None:p['quantity']=quantity
    return p

class ExecutionTests(unittest.TestCase):
    def setUp(self):self.s=snapshot();self.c=demo.make_case(self.s,'5000');self.p=decision(self.c,'10')
    def enter(self,**kw):
        args=dict(case=self.c,raw=self.p,quote=quote(),now=NOW,deadline=NOW+1200,meta=self.s);args.update(kw)
        return demo.enter(**args)
    def test_frozen_risk_cash_liquidity_size(self):
        p=decision(self.c)
        self.assertEqual(p['quantity'],'995')
        self.assertEqual(D(p['cash']),D('995')*D('1.005004'))
        self.assertLessEqual(D(p['risk']),25)
        self.assertLess(len(demo.question(self.c,NOW)),2000)
    def test_venue_ticks_preserve_entry_and_conservative_stop(self):
        s=snapshot();s['quote']=quote(bid='0.0767567',ask='0.0767634')
        c=demo.make_case(s,'5000');p=decision(c,'50')
        self.assertEqual(c['entry'],'0.0768402')
        for k in ('entry','stop','target'):self.assertEqual(D(c[k])%D(s['price_step']),0)
        r=demo.enter(c,p,s['quote'],NOW,NOW+1200,s)
        self.assertEqual(r['status'],'OPEN');self.assertEqual(r['entry'],c['entry'])
    def test_exact_stop_fee_and_gap_no_double_slippage(self):
        s=self.enter();self.assertEqual(s['entry'],'1.001')
        s=demo.advance(s,quote(NOW+15,bid='.97',ask='.971'),NOW+15,NOW+10000)
        self.assertEqual(s['status'],'STOP');self.assertEqual(s['pnl'],'-0.39978')
        self.assertEqual(s['costs'],'0.08008');self.assertEqual(s['exit'],'0.96903')
    def test_target_conservative_price_and_later_loss_ignored(self):
        s=demo.advance(self.enter(),quote(NOW+15,bid='1.06',ask='1.061'),NOW+15,NOW+10000)
        self.assertEqual((s['status'],s['pnl'],s['exit']),('TARGET','0.42042','1.05105'))
        self.assertEqual(demo.advance(s,quote(NOW+30,bid='.5',ask='.51'),NOW+30,NOW+10000),s)
    def test_no_retrofill_on_higher_new_ask(self):
        r=self.enter(quote=quote(NOW+600,bid='1.01',ask='1.02'),now=NOW+600)
        self.assertEqual(r['status'],'NO_FILL');self.assertFalse(r['filled'])
    def test_better_fresh_price_can_fill(self):
        r=self.enter(quote=quote(NOW+600,bid='.995',ask='.996'),now=NOW+600)
        self.assertEqual(r['entry'],'0.996996')
    def test_expiry_no_backdated_fill(self):
        self.assertEqual(self.enter(now=NOW+1200,quote=quote(NOW+1200))['status'],'NO_FILL')
    def test_stale_quote_and_missing_quote_no_fill(self):
        for q in (None,quote(NOW-61)):
            self.assertEqual(self.enter(quote=q)['status'],'NO_FILL')
    def test_cash_rejection_not_automatic_resize(self):
        p=dict(self.p,quantity='1000');r=self.enter(raw=p)
        self.assertEqual(r['status'],'REJECTED');self.assertEqual(r['costs'],'0')
    def test_new_depth_no_assumed_full_or_partial_fill(self):
        self.assertEqual(self.enter(quote=quote(size='50'))['status'],'NO_FILL')
    def test_venue_minimum_no_fill(self):
        m=dict(self.s,minimum_quantity='50')
        self.assertEqual(self.enter(meta=m)['status'],'REJECTED')
    def test_missing_malformed_and_changed_order_never_inferred(self):
        for p in (None,'BUY 10',dict(self.p,target='10')):
            self.assertEqual(self.enter(raw=p)['status'],'NOT_VERIFIED')
    def test_no_trade_and_contradiction(self):
        p=dict(self.p,action='NO_TRADE',quantity='0',entry=None,stop=None,target=None)
        self.assertEqual(self.enter(raw=p)['status'],'NO_TRADE')
        p['entry']='1';self.assertEqual(self.enter(raw=p)['status'],'NOT_VERIFIED')
    def test_observation_gap_unresolved_even_if_next_quote_profitable(self):
        s=demo.advance(self.enter(),quote(NOW+46,bid='1.1',ask='1.11'),NOW+46,NOW+10000)
        self.assertEqual(s['status'],'UNRESOLVED');self.assertIsNone(s['pnl'])
    def test_stop_latches_until_liquidity_returns(self):
        s=demo.advance(self.enter(),quote(NOW+15,bid='.97',ask='.971',size='1'),NOW+15,NOW+10000)
        self.assertEqual((s['status'],s['exit_pending']),('OPEN','STOP'));self.assertIsNone(s['mark_pnl'])
        s=demo.advance(s,quote(NOW+30,bid='1.02',ask='1.021'),NOW+30,NOW+10000)
        self.assertEqual((s['status'],s['exit']),('STOP','1.01898'))
    def test_unfilled_target_does_not_disable_stop(self):
        s=demo.advance(self.enter(),quote(NOW+15,bid='1.06',ask='1.07',size='1'),NOW+15,NOW+10000)
        self.assertEqual(s['exit_pending'],'TARGET')
        s=demo.advance(s,quote(NOW+30,bid='.97',ask='.98'),NOW+30,NOW+10000)
        self.assertEqual(s['status'],'STOP')
    def test_end_time_closes_at_observed_price_not_forecast(self):
        s=demo.advance(self.enter(),quote(NOW+15),NOW+15,NOW+15)
        self.assertEqual(s['status'],'TIME_EXIT');self.assertEqual(s['exit'],'0.998001')
    def test_unavailable_feed_wait_then_unresolved(self):
        s=demo.advance(self.enter(),None,NOW+15,NOW+10000);self.assertEqual(s['status'],'OPEN')
        s=demo.advance(s,None,NOW+46,NOW+10000);self.assertEqual(s['status'],'UNRESOLVED')

class FeedTests(unittest.TestCase):
    def transport(self,endpoint,params):
        if endpoint=='SystemStatus':r=dict(status='online')
        elif endpoint=='AssetPairs':r=dict(XDGUSD=dict(wsname='XDG/USD',status='online',ordermin='50',costmin='.5',lot_decimals=8,tick_size='0.0000001'))
        elif endpoint=='Depth':r=dict(XDGUSD=dict(asks=[['1','10000',NOW]],bids=[['.999','10000',NOW]]))
        else:r=dict(XDGUSD=[[NOW-600,'.98','.99','.97','.985','0','1',1],[NOW-300,'.985','1.01','.98','1','0','1',1],[NOW,'99','999','1','999','0','1',1]],last=NOW)
        return dict(error=[],result=r)
    def test_unfinished_candle_excluded(self):
        f=KrakenFeed(clock=lambda:NOW,transport=self.transport);s=f.snapshot()
        self.assertEqual(s['bars'][-1]['close'],'1');self.assertEqual(s['minimum_quantity'],'50')
    def test_no_private_or_order_endpoints(self):
        f=KrakenFeed(transport=self.transport)
        for endpoint in ('AddOrder','Balance','../private/AddOrder'):
            with self.assertRaises(FeedError):f.get(endpoint)
    def test_error_no_fallback_price(self):
        f=KrakenFeed(transport=lambda *a:dict(error=['rate limited'],result={}))
        with self.assertRaises(FeedError):f.quote()
    def test_freshness_identity_nan_crossed_book(self):
        for k,v in [('observed_at',NOW-61),('bid_time',NOW+1),('symbol','BTC/USD'),('bid','NaN'),('bid','2')]:
            q=quote();q[k]=v
            with self.subTest(k=k),self.assertRaises(FeedError):fresh(q,NOW)
    def test_missing_current_candles(self):
        def old(endpoint,params):
            r=self.transport(endpoint,params)
            if endpoint=='OHLC':
                for row in r['result']['XDGUSD']:row[0]-=1800
            return r
        with self.assertRaises(FeedError):KrakenFeed(clock=lambda:NOW,transport=old).snapshot()

class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=patch.object(store,'ROOT',Path(self.tmp.name));self.root.start()
        self.src=patch.object(store,'get',return_value=dict(status='ready',lessons='Completed actual notes fixture.',updated=NOW-1));self.src.start()
        self.queue=patch.object(question_queue,'current',return_value={'job':None});self.queue.start()
        self.submit=patch.object(question_queue,'submit',return_value={'id':'q1','status':'waiting'});self.submitter=self.submit.start()
        self.feed=Mock();self.feed.snapshot.return_value=snapshot();self.feed.quote.return_value=quote()
        self.sid=demo.start(NOW)
    def tearDown(self):self.submit.stop();self.queue.stop();self.src.stop();self.root.stop();self.tmp.cleanup()
    def ev(self):
        with demo.db() as con:return demo.events(con,self.sid)
    def reserve(self):
        demo.tick(lambda _:None,NOW,self.feed)
        return next(x for x in self.ev() if x['kind']=='precommit')
    def answer(self,e,p):
        with demo.db() as con:demo.event(con,self.sid,e['token'],'answer',{'raw':json.dumps(p)},NOW+1)
    def test_precommit_before_submit_no_outcome_or_feedback_in_prompt(self):
        def submit(data,cb):
            e=next(x for x in self.ev() if x['kind']=='precommit')
            self.assertIn('expected',e['payload']);self.assertIn('commitment',e['payload'])
            for word in ('final_result','future path','previous grades','0.42042'):
                self.assertNotIn(word,data['question'])
            self.assertNotIn('future',e['payload'])
            return {'id':'q1'}
        self.submitter.side_effect=submit;self.reserve();self.submitter.assert_called_once()
        status=demo.public_status();self.assertNotIn('precommit',status['cases'][0])
    def test_respects_external_pending(self):
        question_queue.current.return_value={'job':{'status':'waiting'}}
        demo.tick(None,NOW,self.feed);self.submitter.assert_not_called()
    def test_unfinished_source_never_tested(self):
        store.get.return_value={'status':'working','lessons':'unfinished'}
        demo.tick(None,NOW,self.feed);self.submitter.assert_not_called()
    def test_no_duplicate_after_missing_queue_on_restart(self):
        self.reserve()
        with patch.object(question_queue,'get',side_effect=ValueError('Lost after restart')):
            demo.tick(None,NOW+15,self.feed);demo.tick(None,NOW+30,self.feed)
        self.submitter.assert_called_once();self.assertTrue(any(x['kind']=='uncertain' for x in self.ev()))
    def test_recover_original_and_checked_before_new_submission(self):
        e=self.reserve();p=decision(e['payload']['case']);p['risk']='0';self.answer(e,p)
        self.feed.quote.return_value=quote(NOW+15)
        demo.tick(None,NOW+15,self.feed)
        self.feed.quote.return_value=quote(NOW+30,bid='1.06',ask='1.07')
        demo.tick(None,NOW+30,self.feed)
        r=next(x for x in self.ev() if x['kind']=='result')['payload']
        self.assertEqual(r['assessment']['status'],'FAIL');self.assertEqual(r['original']['status'],'TARGET')
        self.assertEqual(r['assessment']['actual_proposal']['risk'],'0');self.submitter.assert_called_once()
        self.assertEqual(demo.public_status()['cases'][0]['answer']['raw'],json.dumps(p))
    def test_pausing_pending_answer_prevents_entry(self):
        e=self.reserve();self.answer(e,decision(e['payload']['case']));demo.pause(True)
        self.feed.quote.return_value=quote(NOW+15);demo.tick(None,NOW+15,self.feed)
        r=next(x for x in self.ev() if x['kind']=='result')['payload']
        self.assertEqual(r['original']['status'],'NO_FILL')
    def test_seven_day_stop_no_submission(self):
        demo.tick(None,NOW+demo.DAYS,self.feed);self.submitter.assert_not_called()
        demo.pause(True);demo.pause(False)
        with demo.db() as con:self.assertEqual(con.execute('SELECT ends FROM sessions').fetchone()[0],NOW+demo.DAYS)
    def test_cannot_create_overlapping_run(self):
        with self.assertRaises(ValueError):demo.start(NOW+1)
    def test_loss_kept_separate_from_grade(self):
        e=self.reserve();self.answer(e,decision(e['payload']['case']))
        self.feed.quote.return_value=quote(NOW+15);demo.tick(None,NOW+15,self.feed)
        self.feed.quote.return_value=quote(NOW+30,bid='.97',ask='.98');demo.tick(None,NOW+30,self.feed)
        r=next(x for x in self.ev() if x['kind']=='result')['payload']
        self.assertEqual(r['assessment']['status'],'PASS');self.assertLess(D(r['original']['pnl']),0)
        self.assertGreater(D(demo.ledger(self.ev())['closed_max_drawdown']),0)
    def test_feed_failure_no_synthetic_substitute(self):
        self.feed.snapshot.side_effect=FeedError('Unavailable')
        demo.tick(None,NOW,self.feed);self.submitter.assert_not_called()
        self.assertEqual(demo.public_status()['health']['state'],'WAITING_FEED')
    def test_unresolved_marks_equity_unknown_and_no_new_run(self):
        e=self.reserve();self.answer(e,decision(e['payload']['case']))
        self.feed.quote.return_value=quote(NOW+15);demo.tick(None,NOW+15,self.feed)
        self.feed.quote.return_value=quote(NOW+70);demo.tick(None,NOW+70,self.feed)
        self.assertIsNone(demo.ledger(self.ev())['equity'])
        with self.assertRaises(ValueError):demo.start(NOW+demo.DAYS+1)

if __name__=='__main__':unittest.main()
