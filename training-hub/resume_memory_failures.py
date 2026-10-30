"""One-time recovery of failed model requests, preserving checkpoint files."""
import sqlite3,time
import store
def resume():
    with store.connect() as db:
        with sqlite3.connect(store.ROOT/('before-memory-repair-'+str(time.time_ns())+'.sqlite')) as dest:
            db.backup(dest)
        c=db.execute("UPDATE jobs SET status='retry_lessons', detail='Resuming saved sections after memory repair.', updated=? WHERE status='needs_lessons' AND transcript!='' AND (detail LIKE '%HTTP 500%' OR detail LIKE '%insufficient memory%')",(time.time(),))
        print('Sources queued to resume:',c.rowcount)
if __name__=='__main__': resume()
