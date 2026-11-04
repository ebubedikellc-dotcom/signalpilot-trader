"""Patch COPIES of running web files only; fail closed on unknown anchors."""
import ast
from pathlib import Path
import sys


def install(root):
    root=Path(root)
    sp,hp=root/'server.py',root/'training.html'
    server,html=sp.read_text(),hp.read_text()
    if 'paper_math.web' in server:raise ValueError('Paper module already installed; review version before replacing.')
    if 'import question_queue' not in server or 'def chat_answer(data):' not in server:
        raise ValueError('Requires the existing question queue and chat interface.')
    anchor="if __name__=='__main__':"
    if server.count(anchor)!=1:raise ValueError('Unknown startup layout; no files changed.')
    if html.count('</main>')!=1:raise ValueError('Unknown control panel; no files changed.')
    patched=server.replace(anchor,'from paper_math.web import install as install_paper_math\ninstall_paper_math(Handler, chat_answer)\n\n'+anchor)
    link='<section class="card"><h2>Paper practice</h2><p>Seven-day practice with virtual money. Original decisions, checks and simulated results stay in history.</p><a class="link" href="/paper-demo">Open demo trader</a><br><a class="link" href="/paper-math">Open paper calculator</a></section>'
    page=html.replace('</main>',link+'</main>')
    ast.parse(patched)
    sp.write_text(patched);hp.write_text(page)

if __name__=='__main__':install(sys.argv[1])
