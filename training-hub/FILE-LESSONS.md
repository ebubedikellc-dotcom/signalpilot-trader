# File lessons

Adds **Upload a lesson file** above **Teach with writing** on the training control panel. Select a PDF, DOCX, TXT or Markdown document, optionally give it a title, confirm permission, and submit. Read the saved lesson parts under **Your sources**. The existing question interface can retrieve the saved text when the model is available.

This is document reference import, not model retraining. The feature does not claim a document has been understood just because text was saved. Video processing continues separately. Asking about a newly saved document may still encounter the existing model-busy response while a video is being processed.

Limits: 8 MiB per file, 100 PDF pages, 200,000 extracted characters, one document reader at a time. Long text is divided into labeled parts with file and page/paragraph references. Identical bytes do not create duplicate lessons. Only extracted notes are retained; keep your original file. Existing encrypted backups include these notes through the existing database backup.

PDFs need an extractable text layer. Scanned/image-only documents need OCR first. Charts and images are not interpreted by this importer. DOCX body paragraphs and table-cell text are included; headers, footers, comments and footnotes are excluded. PDF and table layout can be imperfect, so review the extraction warnings and saved text. Password-protected or extraction-restricted PDFs are not bypassed. CSV, spreadsheets, older DOC files, archives and arbitrary executables are not supported.

The parser runs in a separate process with time, memory and output limits. It does not call the model or execute document macros. Submitted content remains untrusted reference material under the existing question prompt.

## Install on the existing VPS

Run `bash deploy_file_lessons.sh FULL_COMMIT_SHA` on the server, using a pinned commit containing these files. The installer checks the expected Compose image, copies the running web source and patches it additively. It builds on the existing latest application image, installs `poppler-utils`, and exercises TXT/PDF uploads and readback against an isolated database before changing the web container. It restarts only the web service, verifies the page and existing database are readable, and confirms the worker container identity is unchanged. A failed deployment check restores the earlier web image and host source files. Backups are retained under `file-lessons-backup-*`.

Production installation and a real model response still need verification on the VPS. Passing import tests proves text storage and retrieval wiring, not understanding or profitable trading.

## Local checks

`python3 -m unittest test_file_lessons test_written_lessons` (requires the existing hub modules, `pdftotext`, and ReportLab for the generated PDF fixture).

`python3 file_lessons_smoke.py` verifies the installed endpoint with an isolated temporary database and a generated PDF, using only the standard library and `pdftotext`.
