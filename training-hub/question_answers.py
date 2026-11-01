"""Question-only model transport. Video/PDF generation keeps its own settings."""
import json
import os
import socket
import time
import urllib.error
import urllib.request

import question_queue
from model_gate import turn


def ask(prompt, timeout=300):
    # The old five-minute response timeout was shorter than a 700-token
    # CPU response. Keep the same model/memory limits, request concise output,
    # and expose actual progress instead of labelling all phases "waiting".
    request_timeout = 900
    question_queue.progress('waiting', 'waiting_for_model')
    with turn(question=True, wait_seconds=2100):
        question_queue.progress('generating', 'preparing_answer')
        body = {
            'model': os.getenv('QWEN_MODEL', 'qwen3:8b-q4_K_M'),
            'prompt': prompt + '\nAnswer the question directly and concisely, normally within 120 words. '
            'When asked, apply the saved rule to the hypothetical numbers in the question. '
            'Include the source title or section. Do not invent missing information.',
            'stream': True, 'think': False, 'keep_alive': 0,
            'options': {'num_ctx': 4096, 'num_batch': 128,
                        'num_predict': 384, 'temperature': 0.2},
        }
        request = urllib.request.Request(
            os.getenv('OLLAMA_URL', 'http://ollama:11434') + '/api/generate',
            data=json.dumps(body).encode(),
            headers={'Content-Type': 'application/json'})
        pieces = []
        characters = 0
        final = None
        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=request_timeout) as response:
                for raw in response:
                    if time.monotonic() - started > request_timeout:
                        raise TimeoutError('Answer generation deadline exceeded')
                    if not raw.strip():
                        continue
                    event = json.loads(raw)
                    if event.get('error'):
                        raise ValueError('The model reported a generation error. Check the model service logs.')
                    piece = event.get('response', '')
                    if not isinstance(piece, str):
                        raise ValueError('The model returned an invalid response.')
                    if piece:
                        pieces.append(piece)
                        characters += len(piece)
                        if characters > 20000:
                            raise ValueError('The answer exceeded the allowed response size.')
                        question_queue.progress('generating', 'writing_answer', characters)
                    if event.get('done'):
                        final = event
                        break
        except urllib.error.HTTPError as exc:
            # Server logs may contain prompts and infrastructure information.
            # Return a fixed description rather than forwarding the raw body.
            try:
                detail = exc.read(8192).decode('utf-8', errors='replace').lower()
            except Exception:
                detail = ''
            if any(v in detail for v in ('out of memory', 'requires more system memory', 'cannot allocate memory')):
                message = 'The model reported insufficient memory.'
            else:
                message = 'The model service returned an error; check its logs.'
            raise ValueError('Qwen HTTP ' + str(exc.code) + ': ' + message) from exc
        except (TimeoutError, socket.timeout) as exc:
            raise ValueError('The Qwen request timed out before a complete answer arrived. Saved lessons are unchanged.') from exc
        except urllib.error.URLError as exc:
            if isinstance(exc.reason, (TimeoutError, socket.timeout)):
                raise ValueError('Qwen timed out while connecting or waiting for data. No complete answer was verified.') from exc
            raise ValueError('The website could not connect to Qwen. Check that the model service is running and reachable.') from exc
        except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
            raise ValueError('The response from Qwen was interrupted or unreadable. No complete answer was verified.') from exc
        if final is None:
            raise ValueError('Qwen stopped before completing the answer. No complete answer was verified.')
        if final.get('done_reason') == 'length':
            raise ValueError('Qwen reached the answer-length limit. No complete answer was verified; ask a narrower question.')
        answer = ''.join(pieces).strip()
        if not answer:
            raise ValueError('Qwen completed without returning answer text.')
        return answer
