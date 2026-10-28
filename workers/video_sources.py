"""Download only permissioned direct videos from operator-approved public HTTPS hosts.
No cookies, credentials, redirects, YouTube scraping, or private-network requests.
"""
import http.client
import ipaddress
import os
import socket
import ssl
import time
from urllib.parse import urlsplit

MAX_BYTES = 100 * 1024 * 1024


def validate_source(url, hosts, resolver=socket.getaddrinfo):
    p = urlsplit(url)
    allowed = {h.strip().lower() for h in hosts.split(',') if h.strip()}
    if (p.scheme != 'https' or p.username or p.password or p.port or p.query or
            p.hostname not in allowed or not p.path.lower().endswith(('.mp4', '.mov', '.m4v', '.webm'))):
        raise ValueError('Use a permitted direct video from an approved host, or upload the video.')
    addresses = [r[4][0] for r in resolver(p.hostname, 443, type=socket.SOCK_STREAM)]
    if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
        raise ValueError('Video source must resolve only to public internet addresses.')
    return p, addresses[0]


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, address):
        super().__init__(host, timeout=30, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        # Pin the validated address; TLS still verifies the original hostname.
        raw = socket.create_connection((self.address, 443), timeout=self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except Exception:
            raw.close()
            raise


def download_video(url, destination, hosts):
    parsed, address = validate_source(url, hosts)
    connection = PinnedHTTPS(parsed.hostname, address)
    partial = str(destination) + '.part'
    try:
        connection.request('GET', parsed.path or '/', headers={'User-Agent': 'TradeLord-VideoProcessor/1.0', 'Accept': 'video/*'})
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError('Video host did not supply a direct file. Redirects and sign-in pages are not downloaded.')
        declared = response.getheader('Content-Length')
        if declared and (not declared.isdigit() or int(declared) > MAX_BYTES):
            raise ValueError('Video exceeds the 100 MB processing limit.')
        count, began = 0, time.monotonic()
        with open(partial, 'wb') as out:
            while True:
                if time.monotonic() - began > 180:
                    raise ValueError('Video download exceeded three minutes. Try a smaller file.')
                block = response.read(256 * 1024)
                if not block:
                    break
                count += len(block)
                if count > MAX_BYTES:
                    raise ValueError('Video exceeds the 100 MB processing limit.')
                out.write(block)
        if count < 12 or (declared and count != int(declared)):
            raise ValueError('Video download was incomplete.')
        with open(partial, 'rb') as source:
            head = source.read(12)
        if not (head[4:8] == b'ftyp' or head[:4] == b'\x1a\x45\xdf\xa3'):
            raise ValueError('The link returned a page rather than a supported video file.')
        os.chmod(partial, 0o600)
        os.replace(partial, destination)
        return count
    finally:
        connection.close()
        if os.path.exists(partial):
            os.unlink(partial)
