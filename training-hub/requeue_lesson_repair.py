"""Back up the database before requeuing confirmed incomplete lessons."""
import sqlite3,time
import store
with store.connect() as db:
    backup=store.ROOT/('before-lesson-repair-'+str(time.time_ns())+'.sqlite')
    with sqlite3.connect(backup) as dest: db.backup(dest)
    cursor=db.execute("UPDATE jobs SET status='retry_lessons', detail='Queued for section-by-section lesson repair; saved transcript retained.', updated=? WHERE transcript!='' AND (status='needs_lessons' OR (id=? AND status='ready'))",(time.time(),'0afae4bd-91ef-45a5-900c-ddaf9e32dd62'))
    print('Queued',cursor.rowcount,'lessons for repair. Database backup saved.')
