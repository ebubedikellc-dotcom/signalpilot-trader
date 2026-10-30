"""Install written lessons without replacing worker settings or saved data."""
from pathlib import Path
import shutil
import sys
import time

MODULE = '"""Save written reference lessons without taking the video worker slot."""\nimport re\nimport time\nimport uuid\nimport store\n\nMAX_TEXT = 12000\n\ndef save(data):\n    if not isinstance(data, dict):\n        raise ValueError("Enter a lesson title and written lesson.")\n    title, text = data.get(\'title\'), data.get(\'text\')\n    if not isinstance(title, str) or not isinstance(text, str):\n        raise ValueError(\'Enter a lesson title and written lesson.\')\n    title, text = title.strip(), text.strip()\n    if not 1 <= len(title) <= 140:\n        raise ValueError(\'Use a title between 1 and 140 characters.\')\n    if not 1 <= len(text) <= MAX_TEXT:\n        raise ValueError(\'Paste between 1 and 12,000 characters. Split longer lessons into parts.\')\n    if store.space() + len(text.encode(\'utf-8\')) * 4 + 65536 > store.QUOTA:\n        raise ValueError(\'Storage allowance is full.\')\n    title = \'[Written] \' + title\n    with store.connect() as db:\n        db.execute(\'BEGIN IMMEDIATE\')\n        previous = db.execute("SELECT id FROM jobs WHERE title=? AND lessons=? AND status=\'ready\' AND url IS NULL", (title, text)).fetchone()\n        if previous:\n            return {\'id\': previous[\'id\'], \'duplicate\': True}\n        if db.execute(\'SELECT count(*) FROM jobs\').fetchone()[0] >= 1000:\n            raise ValueError(\'Queue limit reached.\')\n        ident, now = str(uuid.uuid4()), time.time()\n        db.execute(\'INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)\',\n            (ident, title, None, \'ready\', \'Written lesson saved. Available for questions.\', now, now, \'\', text))\n    return {\'id\': ident, \'duplicate\': False}\n\ndef excerpts(rows, question, budget=8000):\n    """Rank bounded passages, including passages near the end of a lesson."""\n    terms = set(re.findall(r\'\\w+\', question.lower()))\n    terms = {t for t in terms if len(t) > 2}\n    candidates = []\n    for row in rows:\n        text = row[\'lessons\']\n        for start in range(0, len(text), 1600):\n            passage = text[start:start + 2000]\n            score = sum(t in passage.lower() for t in terms)\n            score += sum(t in row[\'title\'].lower() for t in terms)\n            candidates.append((score, row, start, passage))\n    candidates.sort(key=lambda item: item[0], reverse=True)\n    selected = []\n    for _, row, start, passage in candidates[:4]:\n        passage = passage[:budget]\n        selected.append({\'title\': row[\'title\'], \'url\': row[\'url\'], \'lessons\': passage,\n                         \'excerpted\': len(passage) < len(row[\'lessons\']), \'character_offset\': start})\n        budget -= len(passage)\n        if budget <= 0:\n            break\n    return selected\n'
FORM = '<section class="card" id="written-teaching"><h2>Teach with writing</h2><p class="muted">Paste your lesson here. It saves immediately while videos keep processing. Trade Lord can use it as reference material when answering questions.</p><form id="written-form"><label>Lesson title<input id="written-title" required maxlength="140" placeholder="For example: My risk management rules"></label><label>Paste your written lesson<textarea id="written-text" rows="10" required maxlength="12000" placeholder="Type or paste the words you want Trade Lord to remember…"></textarea></label><small>Up to 12,000 characters per lesson. Split longer writing into parts. To use an article, paste text you are allowed to use; a website link alone will not be read.</small><p><button type="submit">Save written lesson</button></p></form><p id="written-status" role="status" aria-live="polite"></p></section>'
JS = "$('written-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;$('written-status').textContent='Saving your written lesson…';try{const j=await api('/api/lessons/text',{title:$('written-title').value,text:$('written-text').value});$('written-status').textContent=j.duplicate?'This exact lesson is already saved.':'Written lesson saved. You can ask about it now. Videos continue processing.';$('written-form').reset();await refresh()}catch(e){$('written-status').textContent=e.message}finally{b.disabled=false}};\n"

def install(root):
    root = Path(root)
    s = (root/'server.py').read_text()
    h = (root/'training.html').read_text()
    if 'import written_lessons' not in s:
        if 'import store\n' not in s:
            raise ValueError('Unexpected server imports; no changes made.')
        s = s.replace('import store\n', 'import store\nimport written_lessons\n', 1)
        start = s.index('    terms=set(question.lower().split())')
        end = s.index('    context=json.dumps(sources,ensure_ascii=False)', start)
        s = s[:start] + '    with store.connect() as db:\n        rows=[dict(r) for r in db.execute("SELECT title,url,lessons FROM jobs WHERE status=\'ready\' AND trim(lessons) != \'\'")]\n    if not rows:\n        return \'I do not have saved lessons yet. Save a written lesson or let a video finish processing, then ask about it.\'\n    sources=written_lessons.excerpts(rows, question)\n' + s[end:]
        s = s.replace("a study assistant for the owner's videos", "a study assistant for the owner's written and video lessons")
        s = s.replace('Cite video titles and available timestamps.', 'Cite source titles and available timestamps. Written lessons are user-provided claims, not independently verified facts.')
        old = "            if not 0<size<=20000: raise ValueError('Request too large or empty.')"
        if s.count(old) != 1:
            raise ValueError('Unexpected request limit; no changes made.')
        s = s.replace(old, "            if not 0<size<=(80000 if route=='/api/lessons/text' else 20000): raise ValueError('Request too large or empty.')")
        marker = "            if route=='/api/add':"
        if s.count(marker) != 1:
            raise ValueError('Unexpected server routes; no changes made.')
        s = s.replace(marker, "            if route=='/api/lessons/text':\n                return self.send(201,written_lessons.save(data))\n" + marker)
    if 'id="written-form"' not in h:
        marker = '<section class="card"><h2>Gain knowledge of'
        if h.count(marker) != 1:
            raise ValueError('Unexpected control panel; no changes made.')
        h = h.replace(marker, FORM + '\n' + marker)
        h = h.replace("$('add').onsubmit=", JS + "$('add').onsubmit=", 1)
        h = h.replace('Learn what your videos teach, one lesson at a time.', 'Save written lessons and learn from videos, all in one place.')
    compile(s, 'server.py', 'exec')
    compile(MODULE, 'written_lessons.py', 'exec')
    stamp=str(time.time_ns())
    for name, content in [('server.py',s),('training.html',h),('written_lessons.py',MODULE)]:
        p=root/name
        if p.exists():
            shutil.copy2(p,str(p)+'.before-writing-'+stamp)
        p.write_text(content)
    print('Written lesson feature installed in source files.')

if __name__=='__main__':
    install(sys.argv[1] if len(sys.argv)>1 else Path(__file__).parent)
