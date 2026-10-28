import socket
import unittest
from video_sources import validate_source

class SourceTests(unittest.TestCase):
    def resolver(self, ip):
        return lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (ip,443))]
    def test_public_host_is_pinned(self):
        parsed, ip = validate_source('https://media.example.org/a.mp4','media.example.org',self.resolver('8.8.8.8'))
        self.assertEqual(ip, '8.8.8.8')
        self.assertEqual(parsed.hostname, 'media.example.org')
    def test_private_and_metadata_addresses_rejected(self):
        for ip in ['127.0.0.1','10.0.0.1','169.254.169.254','::1','192.168.1.1']:
            with self.subTest(ip=ip), self.assertRaises(ValueError):
                validate_source('https://media.example.org/a.mp4','media.example.org',self.resolver(ip))
    def test_unapproved_hosts_and_secrets_rejected(self):
        for url in ['http://media.example.org/a.mp4','https://evil.example/a.mp4','https://media.example.org:444/a.mp4','https://user:pass@media.example.org/a.mp4','https://media.example.org/a.mp4?key=secret','https://media.example.org/watch']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                validate_source(url,'media.example.org',self.resolver('8.8.8.8'))

if __name__ == '__main__':
    unittest.main()
