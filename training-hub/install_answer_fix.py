"""Patch the live web files copied by deploy_answer_fix.sh; validate before writing."""
import ast
from pathlib import Path
import sys


def install(root):
    root = Path(root)
    server = (root/'server.py').read_text()
    html = (root/'training.html').read_text()
    if 'from question_answers import ask' in server:
        raise ValueError('Answer repair already installed; no files changed.')
    if 'import question_queue' not in server:
        raise ValueError('The existing queued-question upgrade is required.')
    if server.count('from model_requests import ask') != 1:
        raise ValueError('Unknown question transport; no files changed.')
    server = server.replace('from model_requests import ask', 'from question_answers import ask')
    anchor = "        if route.startswith('/api/question/'):"
    if server.count(anchor) != 1:
        raise ValueError('Unknown question routes; no files changed.')
    server = server.replace(anchor, "        if route=='/api/question/current':\n            return self.send(200,question_queue.current())\n" + anchor)
    start = html.find("$('chat').onsubmit=")
    end = html.find("\n", html.find('const pendingQuestion=', start))
    if start < 0 or end < 0 or html.count('async function pollQuestion(') != 1:
        raise ValueError('Unknown question form; no files changed.')
    old = html[start:end]
    if 'localStorage.getItem(\'tradeLordQuestion\')' not in old or "$('chat').querySelector('button')" not in old:
        raise ValueError('Unexpected question resume code; no files changed.')
    html = html[:start] + (root/'question_ui.js').read_text() + html[end:]
    ast.parse(server)
    for name in ('question_answers.py', 'question_queue.py'):
        ast.parse((root/name).read_text())
    (root/'server.py').write_text(server)
    (root/'training.html').write_text(html)


if __name__ == '__main__':
    install(sys.argv[1])
