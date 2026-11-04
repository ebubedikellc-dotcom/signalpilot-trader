import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {execFileSync} from 'node:child_process';

const root = new URL('.', import.meta.url);
const html = fs.readFileSync(new URL('paper_math/panel.html', root), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function page() {
  const nodes = new Map();
  const element = () => ({textContent:'', value:'', hidden:true, disabled:false, children:[],
    append(child) { this.children.push(child); }});
  for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set(match[1], element());
  const context = {
    document: {createElement:element, getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    }},
    localStorage:{getItem:()=>null, setItem(){}, removeItem(){}},
    setTimeout(){throw Error('No polling expected in rendering tests');},
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  return {context, nodes};
}

function fixture() {
  // Exercise the actual Python correction output rather than a second renderer schema.
  return JSON.parse(execFileSync('python3', ['-c',
    "import json; from test_paper_math import setup_case,proposal; from paper_math import review; p=proposal(); p.update(risk='4',reward='100'); print(json.dumps(review(setup_case(),p)))"
  ], {cwd:root, encoding:'utf8', env:{...process.env, PYTHONPATH:'.'}}));
}

test('main answer uses corrected figures and keeps the original failure visible', () => {
  const {context,nodes}=page();
  const result=fixture();
  nodes.get('answer').textContent='Original AI answer: risk 4 and reward 100';
  context.renderCheck(result);
  const text=nodes.get('final-answer').textContent;
  assert.match(text,/CORRECTED/);
  assert.match(text,/Original AI assessment: FAIL/);
  assert.match(text,/Planned loss including costs: \$20/);
  assert.match(text,/Net target profit: \$28/);
  assert.doesNotMatch(text,/Net target profit: \$100/);
  assert.equal(nodes.get('answer').textContent,'Original AI answer: risk 4 and reward 100');
  assert.equal(nodes.get('final').hidden,false);
});

test('unverified and legacy responses do not display an accepted decision', () => {
  const {context}=page();
  for (const result of [undefined, {status:'PASS'}, {final_result:{status:'NOT_VERIFIED',accepted_for_paper:false,decision:{action:'BUY'}}}]) {
    const text=context.finalText(result);
    assert.match(text,/NOT VERIFIED/);
    assert.doesNotMatch(text,/Decision: BUY/);
  }
});

test('starting another request removes the previous result and frozen inputs', () => {
  const {context,nodes}=page();
  context.renderCheck(fixture());
  context.clearResult();
  assert.equal(nodes.get('final').hidden,true);
  for(const key of ['final-answer','answer','review','frozen'])assert.equal(nodes.get(key).textContent,'');
});
