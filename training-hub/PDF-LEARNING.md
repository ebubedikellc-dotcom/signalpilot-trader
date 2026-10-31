# PDF page images and direct links

This additive upgrade changes the existing PDF upload field. PDFs are retained and queued; each page is rendered at up to 1600 pixels on its long edge, sent to the installed vision model through the existing question-aware model gate, and saved with extracted text and page provenance. Scanned pages can be visually reviewed, but exact OCR transcription and small chart labels are not guaranteed. No model weights are retrained.

Clickable URL annotations and literal HTTP(S) URLs in extracted text are collected and deduplicated. Public HTTPS HTML/text pages become bounded reference parts. YouTube links join the existing video queue; existing video URLs are reused, including blocked ones, without automatically retrying them. A PDF remains unfinished if any linked video is waiting, failed or needs upload. There is no recursive traversal, login, cookies, proxy rotation, restriction bypass or trading execution.

Limits: 8 MiB per PDF, 100 pages, 200,000 extracted text characters, 50 unique direct links. Extra links are explicitly reported as omitted. HTTP-only links, credential URLs, private addresses, encrypted PDFs, other video hosts and non-HTML/text links fail visibly. URLs visible only inside an image are not followed. Web-page images and nested links are not processed. Large or blocked pages are reported rather than silently considered learned. Images are interpreted, not guaranteed correctly understood.

Each page and link has an independent persisted task. Completed reference rows are idempotent; a process restart resumes interrupted tasks but does not retry failed ones. The original PDF and completed page notes remain on disk. The existing transfer/export format includes saved job notes but does **not** include PDF source files or the new PDF task table; keep original PDFs for reupload on a new server. Existing imports and video processing are not rewritten.

## Installation

Run `bash deploy_pdf_learning.sh FULL_COMMIT_SHA` on the VPS. The script requires the existing PDF/question repair, copies the **running** web/vision source, verifies the shared model gate, patches the file uploader, builds from the current web image and runs isolated tests before deployment. A new 512 MiB document worker shares the database and model gate. It reads one page at a time. The web container restarts; the existing video worker is not recreated. No model or server upgrade is performed.

The deployment saves a backup image and restores the previous web image on failed checks. For later Compose operations, include `-f compose.pdf-learning.yaml` last, after the existing question repair override. The script refuses an existing PDF override rather than silently replacing it.

After installation, reload the control panel, upload a permitted PDF and open **PDF page and link progress**. Use a short document with a known chart, a page link and a YouTube link first. Inspect saved page text and actual visual notes, then ask a question with an expected answer prepared from the source. Installation tests do not verify live vision accuracy, remote-site access, video completion or trading competence.

Existing text-only PDF imports lack original files. Reupload their originals to request visual and link processing; existing notes are preserved.

## Checks

`python -m unittest -v test_pdf_learning test_pdf_install`

The first suite checks real Poppler extraction/rendering and uses a **stub** visual response: this verifies image delivery and saving, not model intelligence. It also checks duplicate uploads/links, failures and waiting states, direct link boundaries, chunk preservation, public-address enforcement and redirect revalidation. The installation suite reconstructs the existing uploader/question patches in a temporary directory, exercises HTTP upload/readback and JavaScript syntax, and runs legacy importer tests against their required installed endpoint.
