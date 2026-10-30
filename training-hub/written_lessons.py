"""Save written reference lessons without taking the video worker slot."""
import re
import time
import uuid
import store

MAX_TEXT = 12000

def save(data):
    if not isinstance(data, dict):
        raise ValueError("Enter a lesson title and written lesson.")
    title, text = data.get('title'), data.get('text')
    if not isinstance(title, str) or not isinstance(text, str):
        raise ValueError('Enter a lesson title and written lesson.')
    title, text = title.strip(), text.strip()
    if not 1 <= len(title) <= 140:
        raise ValueError('Use a title between 1 and 140 characters.')
    if not 1 <= len(text) <= MAX_TEXT:
        raise ValueError('Paste between 1 and 12,000 characters. Split longer lessons into parts.')
    if store.space() + len(text.encode('utf-8')) * 4 + 65536 > store.QUOTA:
        raise ValueError('Storage allowance is full.')
    title = '[Written] ' + title
    with store.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        previous = db.execute("SELECT id FROM jobs WHERE title=? AND lessons=? AND status='ready' AND url IS NULL", (title, text)).fetchone()
        if previous:
            return {'id': previous['id'], 'duplicate': True}
        if db.execute('SELECT count(*) FROM jobs').fetchone()[0] >= 1000:
            raise ValueError('Queue limit reached.')
        ident, now = str(uuid.uuid4()), time.time()
        db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)',
            (ident, title, None, 'ready', 'Written lesson saved. Available for questions.', now, now, '', text))
    return {'id': ident, 'duplicate': False}

def excerpts(rows, question, budget=8000):
    """Rank bounded passages, including passages near the end of a lesson."""
    terms = set(re.findall(r'\w+', question.lower()))
    terms = {t for t in terms if len(t) > 2}
    candidates = []
    for row in rows:
        text = row['lessons']
        for start in range(0, len(text), 1600):
            passage = text[start:start + 2000]
            score = sum(t in passage.lower() for t in terms)
            score += sum(t in row['title'].lower() for t in terms)
            candidates.append((score, row, start, passage))
    candidates.sort(key=lambda item: item[0], reverse=True)
    selected = []
    for _, row, start, passage in candidates[:4]:
        passage = passage[:budget]
        selected.append({'title': row['title'], 'url': row['url'], 'lessons': passage,
                         'excerpted': len(passage) < len(row['lessons']), 'character_offset': start})
        budget -= len(passage)
        if budget <= 0:
            break
    return selected
