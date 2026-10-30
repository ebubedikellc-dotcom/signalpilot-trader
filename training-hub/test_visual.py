import importlib, json, os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import visual_lessons as v

class VisualTests(unittest.TestCase):
    def test_sampling_is_bounded(self):
        self.assertEqual(v.sample_times(61),[0,60])
        self.assertEqual(len(v.sample_times(3600)),60)
        for bad in (0,-1,3601,float('nan')):
            with self.assertRaises(ValueError): v.sample_times(bad)
    def test_saved_frames_resume_and_skip_finished(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); src=root/'video';src.write_bytes(b'video')
            def frame(args,**kw): Path(args[-1]).write_bytes(b'image')
            with patch.object(v.store,'ROOT',root),patch.object(v.store,'update'),patch.object(v.subprocess,'check_output',return_value=b'61'),patch.object(v.subprocess,'run',side_effect=frame),patch.object(v,'see',side_effect=['Observed rising line',ValueError('offline')]):
                with self.assertRaises(ValueError): v.enrich('test',src,'[0.0s speech] A line')
                self.assertEqual(len(json.loads((root/'test.visual-checkpoint.json').read_text())['frames']),1)
            with patch.object(v.store,'ROOT',root),patch.object(v.store,'update'),patch.object(v.subprocess,'check_output',return_value=b'61'),patch.object(v.subprocess,'run',side_effect=frame),patch.object(v,'see',return_value='Uncertain') as see:
                text=v.enrich('test',src,'[0.0s speech] A line')
                self.assertEqual(see.call_count,1)
                self.assertIn('Events between frames may be missed',text)
                self.assertEqual(v.enrich('test',src,text),text)
                self.assertEqual(see.call_count,1)
    def test_incomplete_output_rejected_and_unloaded(self):
        class Reply:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self):return b'{"models":[]}'
        with tempfile.TemporaryDirectory() as temp,patch.object(v.store,'ROOT',Path(temp)),patch.object(v.urllib.request,'urlopen',return_value=Reply()),patch.object(v,'post',side_effect=[{'done':True,'done_reason':'length','message':{'content':'partial'}},{}]) as post:
            with self.assertRaises(ValueError):v.see(b'png','prompt')
            self.assertEqual(post.call_args.args[1]['keep_alive'],0)

if __name__=='__main__':unittest.main()
