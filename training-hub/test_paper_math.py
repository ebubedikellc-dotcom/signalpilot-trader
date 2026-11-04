import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from paper_math import Case, calculator, calculate, check, review, parse_proposal
from paper_math.web import prompt, install


def setup_case():
    return dict(mode='PAPER',label='Invented demo',source='Applied day trading - rules, risk and evidence',unit='shares',currency='USD',side='LONG',rule='CLOSE_ABOVE',threshold='159',entry='160',stop='156',target='168',value_per_point='1',quantity_step='1',risk_budget='23',minimum_rr='1.2',funding='CASH',available_cash='1000',margin_per_unit='0',available_margin='0',entry_liquidity='50',exit_liquidity='50',entry_executable=True,exit_executable=True,entry_fixed='0',exit_fixed='0',entry_per_unit='0.5',exit_per_unit='0.5',stop_allowance_per_unit='0',previous=dict(open='158',high='160',low='157',close='159',completed=True),latest=dict(open='159',high='161',low='158',close='160',completed=True))


def proposal():
    return dict(action='BUY',quantity='4',entry='160',stop='156',target='168',costs='4',risk='20',reward='28',margin='0',cash='642',source='Applied day trading - rules, risk and evidence',rationale='Completed close and risk limits fit.')

class MathsTests(unittest.TestCase):
    def test_decimal_exact_and_parentheses(self):
        self.assertEqual(calculator('0.1 + 0.2 - 0.3')['result'],'0')
        self.assertEqual(calculator('4 * (160 - 156 + 1)')['result'],'20')
    def test_calculator_rejects_code_and_unbounded_work(self):
        for s in ['__import__("os")','2**1000000','1/0','True','1e100','[1]*999999999','2**(2**12)','1.' , '3'*300]:
            with self.subTest(s=s),self.assertRaises(ValueError):calculator(s)
    def test_long_size_and_check(self):
        r=calculate(setup_case());self.assertEqual(r['committed_quantity'],'4');self.assertEqual(r['conditional_rr'],'1.4')
        self.assertEqual(r['conditional_totals'],dict(costs='4',risk='20',reward='28',margin='0',cash='642'))
        self.assertEqual(check(setup_case(),proposal())['status'],'PASS')
    def test_oversized_not_repaired(self):
        p=proposal();p['quantity']='5'
        r=check(setup_case(),p);self.assertEqual(r['status'],'FAIL');self.assertEqual(r['actual_proposal']['quantity'],'5');self.assertFalse(r['fill_assumed'])
    def test_close_not_high_and_no_trade_zeros(self):
        c=setup_case();c['latest']['close']='158.5';r=calculate(c);self.assertEqual(r['expected_action'],'NO_TRADE')
        p=proposal();p.update(action='NO_TRADE',quantity='0',entry=None,stop=None,target=None,costs='0',risk='0',reward='0',margin='0',cash='0');self.assertEqual(check(c,p)['status'],'PASS')
    def test_body_not_range(self):
        c=setup_case();c.update(side='SHORT',rule='SHORT_DISPLACEMENT',entry='71',stop='74',target='65',funding='MARGIN',margin_per_unit='25',available_margin='200',risk_budget='18')
        c['previous']=dict(open='73',high='76',low='72',close='74',completed=True)
        c['latest']=dict(open='74',high='74.5',low='70',close='71',completed=True)
        r=calculate(c);self.assertTrue(r['pattern_pass']);self.assertEqual(r['pattern']['latest_body'],'3');self.assertEqual(r['committed_quantity'],'4');self.assertEqual(r['conditional_totals']['risk'],'16');self.assertEqual(r['conditional_totals']['reward'],'20')
    def test_fixed_costs_liquidity(self):
        c=setup_case();c.update(entry='0.30',stop='0.28',target='0.36',risk_budget='20',minimum_rr='1.5',entry_fixed='2',exit_fixed='3',entry_per_unit='0',exit_per_unit='0',entry_liquidity='600',exit_liquidity='600')
        r=calculate(c);self.assertEqual(r['committed_quantity'],'600');self.assertEqual(r['conditional_totals']['risk'],'17');self.assertEqual(r['conditional_totals']['reward'],'31');self.assertEqual(r['conditional_totals']['cash'],'182')
    def test_allowance_is_not_fee(self):
        c=setup_case();c['stop_allowance_per_unit']='1';c['minimum_rr']='1';r=calculate(c);self.assertEqual(r['committed_quantity'],'3');self.assertEqual(r['conditional_totals']['risk'],'18');self.assertEqual(r['conditional_totals']['costs'],'3');self.assertEqual(r['conditional_totals']['reward'],'21')
    def test_margin_and_cash_bind(self):
        c=setup_case();c.update(funding='MARGIN',margin_per_unit='100',available_margin='300',available_cash='250');r=calculate(c);self.assertEqual(r['committed_quantity'],'2');self.assertEqual(r['conditional_totals']['cash'],'201')
    def test_fractional_step_and_rr_boundary(self):
        c=setup_case();c.update(quantity_step='0.25',risk_budget='22',minimum_rr='1.4');self.assertEqual(calculate(c)['committed_quantity'],'4.25')
        c['minimum_rr']='1.40000001';self.assertEqual(calculate(c)['expected_action'],'NO_TRADE')
    def test_no_exit_and_incomplete_candle(self):
        for name in ['exit_executable','entry_executable']:
            c=setup_case();c[name]=False;self.assertEqual(calculate(c)['expected_action'],'NO_TRADE')
        c=setup_case();c['latest']['completed']=False;self.assertEqual(calculate(c)['expected_action'],'NO_TRADE')
    def test_bad_types_missing_unknown_nan_geometry(self):
        for k,v in [('risk_budget',25.0),('risk_budget',True),('entry','NaN'),('quantity_step','0'),('side','BUY'),('mode','LIVE'),('stop','170')]:
            c=setup_case();c[k]=v
            with self.subTest(k=k,v=v),self.assertRaises(ValueError):Case.model_validate(c)
        c=setup_case();del c['exit_fixed'];self.assertEqual(check(c,proposal())['status'],'NOT_VERIFIED')
        c=setup_case();c['unknown']='x'
        with self.assertRaises(ValueError):Case.model_validate(c)
    def test_unstructured_and_duplicate_answers_unverified(self):
        for s in ['BUY four units','{"action":"BUY","action":"NO_TRADE"}','null']:
            self.assertEqual(check(setup_case(),s)['status'],'NOT_VERIFIED')
    def test_does_not_trust_model_totals(self):
        p=proposal();p.update(risk='4',reward='100');self.assertEqual(check(setup_case(),p)['status'],'FAIL')
    def test_corrected_totals_preserve_original_failure(self):
        p=proposal();p.update(risk='4',reward='100',rationale='Guaranteed money!')
        before=copy.deepcopy(p);c=setup_case();original_case=copy.deepcopy(c)
        r=review(c,p);f=r['final_result']
        self.assertEqual(r['status'],'FAIL');self.assertFalse(r['accepted_for_paper'])
        self.assertEqual(f['status'],'CORRECTED');self.assertTrue(f['accepted_for_paper'])
        self.assertEqual((f['decision']['risk'],f['decision']['reward']),('20','28'))
        self.assertEqual(r['actual_proposal']['risk'],'4')
        self.assertEqual({x['field'] for x in f['changes']},{'risk','reward'})
        self.assertNotIn('Guaranteed',f['decision']['rationale'])
        self.assertFalse(f['source_content_verified']);self.assertFalse(f['rationale_verified'])
        self.assertFalse(f['orders_enabled']);self.assertFalse(f['fill_assumed'])
        self.assertEqual(p,before);self.assertEqual(c,original_case)
    def test_wrong_no_trade_becomes_margin_limited_paper_buy(self):
        c=setup_case();c.update(unit='ounces',entry='3100',stop='3097',target='3109',threshold='3098',
            risk_budget='25',minimum_rr='1.5',funding='MARGIN',available_cash='5000',
            margin_per_unit='150',available_margin='500',entry_liquidity='10',exit_liquidity='10',
            entry_per_unit='0.75',exit_per_unit='0.75')
        c['latest']=dict(open='3097',high='3100',low='3096',close='3099',completed=True)
        p=proposal();p.update(action='NO_TRADE',quantity='0',entry=None,stop=None,target=None,costs='0',risk='0',reward='0',margin='0',cash='0')
        r=review(c,p);d=r['final_result']['decision']
        self.assertEqual(r['status'],'FAIL');self.assertEqual(d['action'],'BUY')
        self.assertEqual(d['quantity'],'3');self.assertEqual(d['costs'],'4.5')
        self.assertEqual(d['risk'],'13.5');self.assertEqual(d['reward'],'22.5')
        self.assertEqual(d['margin'],'450');self.assertEqual(d['cash'],'452.25')
        self.assertEqual(r['final_result']['reward_risk_display'],'1.6667')
    def test_oversize_and_wrong_levels_are_recomputed_from_frozen_case(self):
        p=proposal();p.update(quantity='50',entry='200',stop='190',target='230')
        r=review(setup_case(),p);d=r['final_result']['decision']
        self.assertEqual(r['actual_proposal']['quantity'],'50')
        self.assertEqual((d['quantity'],d['entry'],d['stop'],d['target']),('4','160','156','168'))
        self.assertEqual(d['cash'],'642');self.assertEqual(d['risk'],'20')
    def test_failed_entry_gates_correct_to_no_trade_without_costs(self):
        for change in ['close','ratio','liquidity']:
            c=setup_case()
            if change=='close':c['latest']['close']='158.5'
            elif change=='ratio':c['minimum_rr']='1.40000001'
            else:c['exit_executable']=False
            with self.subTest(change=change):
                f=review(c,proposal())['final_result'];d=f['decision']
                self.assertEqual(f['status'],'CORRECTED');self.assertEqual(d['action'],'NO_TRADE')
                for name in ['quantity','costs','risk','reward','margin','cash']:self.assertEqual(d[name],'0')
                for name in ['entry','stop','target']:self.assertIsNone(d[name])
                self.assertIsNone(f['reward_risk_display'])
    def test_short_correction_uses_direction_multiplier_and_body(self):
        c=setup_case();c.update(side='SHORT',rule='SHORT_DISPLACEMENT',entry='71',stop='74',target='65',funding='MARGIN',margin_per_unit='25',available_margin='200',risk_budget='18')
        c['previous']=dict(open='73',high='76',low='72',close='74',completed=True)
        c['latest']=dict(open='74',high='74.5',low='70',close='71',completed=True)
        f=review(c,proposal())['final_result'];d=f['decision']
        self.assertEqual(d['action'],'SELL_SHORT');self.assertEqual(d['quantity'],'4')
        self.assertEqual((d['risk'],d['reward'],d['margin']),('16','20','100'))
        self.assertEqual(f['pattern']['latest_body'],'3')
    def test_missing_or_unstructured_data_cannot_be_corrected(self):
        c=setup_case();del c['stop']
        for case,p in [(c,proposal()),(setup_case(),'BUY four'),(setup_case(),'{"action":"BUY","action":"NO_TRADE"}'),(setup_case(),None)]:
            with self.subTest(p=p):
                r=review(case,p);self.assertEqual(r['status'],'NOT_VERIFIED')
                self.assertIsNone(r['final_result']['decision']);self.assertFalse(r['final_result']['accepted_for_paper'])
    def test_passing_numbers_keep_grade_and_get_rule_based_explanation(self):
        p=proposal();p['rationale']='The future is guaranteed.'
        r=review(setup_case(),p);f=r['final_result']
        self.assertEqual(r['status'],'PASS');self.assertEqual(f['status'],'CHECKED')
        self.assertEqual(f['changes'],[]);self.assertEqual(f['decision']['quantity'],'4')
        self.assertNotIn('guaranteed',f['decision']['rationale'])
        self.assertFalse(f['rationale_verified'])
    def test_prompt_has_inputs_no_computed_answer(self):
        q=prompt(Case.model_validate(setup_case()));self.assertLessEqual(len(q),2000);self.assertNotIn('642',q)
    def test_adapter_preserves_routes_and_auth(self):
        class Handler:
            def __init__(self,path,body=None,auth=True):
                self.path=path;raw=json.dumps(body or {}).encode();self.headers={'Content-Length':str(len(raw))}
                if auth:self.headers['X-Trade-Lord']='1'
                self.rfile=io.BytesIO(raw);self.connection=type('Conn',(),{'settimeout':lambda *a:None})()
            def send(self,*args):return args
            def do_GET(self):return 'original GET'
            def do_POST(self):return 'original POST'
        with patch('paper_math.demo.launch'):
            install(Handler,lambda x:'unused')
        self.assertEqual(Handler('/api/jobs').do_GET(),'original GET')
        self.assertEqual(Handler('/api/question').do_POST(),'original POST')
        self.assertEqual(Handler('/api/paper-math/calculate',{'expression':'2+3'},False).do_POST()[0],403)
        self.assertEqual(Handler('/api/paper-math/calculate',{'expression':'2+3'}).do_POST()[1]['result'],'5')
        self.assertFalse(Handler('/api/paper-math/health').do_GET()[1]['orders_enabled'])
        self.assertEqual(Handler('/api/paper-demo/start',{},False).do_POST()[0],403)
        self.assertEqual(Handler('/api/paper-demo/start',{'risk_budget':'9999'}).do_POST()[0],400)
        self.assertEqual(Handler('/api/paper-demo/status?offset=-1').do_GET()[0],400)
    def test_install_copies_and_unknown_abort(self):
        from install_paper_math import install as patch_files
        with tempfile.TemporaryDirectory() as root:
            s=Path(root)/'server.py';h=Path(root)/'training.html'
            s.write_text("import question_queue\ndef chat_answer(data): pass\nclass Handler: pass\nif __name__=='__main__': pass\n");h.write_text('<main>Existing lessons</main>')
            patch_files(root);self.assertIn('paper_math.web',s.read_text());self.assertIn('Existing lessons',h.read_text())
            before=s.read_bytes()
            with self.assertRaises(ValueError):patch_files(root)
            self.assertEqual(s.read_bytes(),before)
    def test_queue_conflict_and_completed_result(self):
        import store, question_queue
        from paper_math.web import submit, result
        with tempfile.TemporaryDirectory() as root,patch.object(store,'ROOT',Path(root)):
            with patch.object(question_queue,'submit',side_effect=ValueError('busy')):
                with self.assertRaises(ValueError):submit(setup_case(),lambda _: 'unused')
            def immediate(data,callback):callback(data);return {'id':'test-id','status':'waiting'}
            with patch.object(question_queue,'submit',side_effect=immediate):
                submit(setup_case(),lambda _:json.dumps(proposal()))
            r=result('test-id');self.assertEqual(r['check']['status'],'PASS');self.assertEqual(r['answer'],json.dumps(proposal()))
    def test_correction_is_frozen_and_never_fed_back_to_model(self):
        import store
        from paper_math import web
        p=proposal();p.update(risk='4',reward='100');raw=json.dumps(p,indent=2)
        calls=[]
        def model(data):calls.append(data);return raw
        def immediate(data,callback):callback(data);return {'id':'corrected-id','status':'waiting'}
        with tempfile.TemporaryDirectory() as root,patch.object(store,'ROOT',Path(root)):
            with patch('question_queue.submit',side_effect=immediate):web.submit(setup_case(),model)
            first=web.result('corrected-id')
            self.assertEqual(first['answer'],raw);self.assertEqual(first['check']['status'],'FAIL')
            self.assertEqual(first['check']['final_result']['decision']['risk'],'20')
            self.assertEqual(len(calls),1);self.assertEqual(calls[0]['question'],prompt(Case.model_validate(setup_case())))
            with patch.object(web,'review',side_effect=AssertionError('Must not recalculate saved history')):
                self.assertEqual(web.result('corrected-id'),first)
            with web.database() as db:
                self.assertEqual(db.execute('SELECT count(*) FROM checked_results').fetchone()[0],1)
                self.assertEqual(db.execute('SELECT answer FROM reviews').fetchone()[0],raw)
    def test_waiting_and_failed_requests_never_get_corrected_answers(self):
        import store
        from paper_math import web
        def waiting(*args):return {'id':'pending-id','status':'waiting'}
        with tempfile.TemporaryDirectory() as root,patch.object(store,'ROOT',Path(root)):
            with patch('question_queue.submit',side_effect=waiting):web.submit(setup_case(),lambda _: 'unused')
            with patch('question_queue.get',return_value={'id':'pending-id','status':'waiting'}):
                self.assertEqual(web.result('pending-id')['status'],'waiting')
                self.assertNotIn('check',web.result('pending-id'))
            with web.database() as db:
                self.assertEqual(db.execute('SELECT count(*) FROM checked_results').fetchone()[0],0)
                db.execute('UPDATE reviews SET error=?',('Model failed',))
            r=web.result('pending-id');self.assertEqual(r['check']['status'],'NOT_VERIFIED')
            self.assertNotIn('answer',r)
    def test_checker_failure_keeps_original_and_blocks_final_result(self):
        import store
        from paper_math import web
        raw=json.dumps(proposal())
        def immediate(data,callback):callback(data);return {'id':'check-failure','status':'waiting'}
        with tempfile.TemporaryDirectory() as root,patch.object(store,'ROOT',Path(root)):
            with patch('question_queue.submit',side_effect=immediate),patch.object(web,'review',side_effect=ArithmeticError()):
                web.submit(setup_case(),lambda _:raw)
            r=web.result('check-failure');self.assertEqual(r['answer'],raw)
            self.assertEqual(r['check']['status'],'NOT_VERIFIED');self.assertIsNone(r['check']['final_result']['decision'])

if __name__=='__main__':unittest.main()
