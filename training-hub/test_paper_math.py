import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from paper_math import Case, calculator, calculate, check, parse_proposal
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
        install(Handler,lambda x:'unused')
        self.assertEqual(Handler('/api/jobs').do_GET(),'original GET')
        self.assertEqual(Handler('/api/question').do_POST(),'original POST')
        self.assertEqual(Handler('/api/paper-math/calculate',{'expression':'2+3'},False).do_POST()[0],403)
        self.assertEqual(Handler('/api/paper-math/calculate',{'expression':'2+3'}).do_POST()[1]['result'],'5')
        self.assertFalse(Handler('/api/paper-math/health').do_GET()[1]['orders_enabled'])
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

if __name__=='__main__':unittest.main()
