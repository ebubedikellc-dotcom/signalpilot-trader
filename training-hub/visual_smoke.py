"""Two known synthetic images: functional gate, not trading validation."""
import struct, zlib
from visual_lessons import see

def chart(rising):
    width,height=480,320
    rows=[bytearray([255]*(width*3)) for _ in range(height)]
    def dot(x,y):
        if 0<=x<width and 0<=y<height: rows[y][x*3:x*3+3]=bytes((20,60,190))
    for x in range(40,440):
        y=int(270-(x-40)*.55) if rising else int(50+(x-40)*.55)
        for dy in range(-3,4): dot(x,y+dy)
    def chunk(kind,data):
        return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(b'\0'+bytes(r) for r in rows)))+chunk(b'IEND',b'')

if __name__=='__main__':
    for rising,expected in ((True,'rising'),(False,'falling')):
        print('Testing visual direction: '+expected,flush=True)
        answer=see(chart(rising),'Moving from LEFT to RIGHT, does the blue line rise or fall? Reply with only RISING or FALLING.').strip().lower().rstrip('.')
        if answer!=expected: raise SystemExit('Image-reading check failed. Upgrade not enabled. Output: '+answer[:100])
    print('Both image checks passed. Real chart accuracy still needs review.',flush=True)
