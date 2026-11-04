"""Read-only public DOGE/USD market data. No keys or order/account endpoints."""
import json
import time
from decimal import Decimal as D
from urllib.parse import urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler

BASE = 'https://api.kraken.com/0/public/'
PAIR = 'XDGUSD'
MAX_AGE = 60
DOCS = [
    'https://docs.kraken.com/api-reference/market-data/get-order-book',
    'https://docs.kraken.com/api-reference/market-data/get-ohlc-data',
    'https://docs.kraken.com/api-reference/market-data/get-tradable-asset-pairs',
]

class FeedError(ValueError): pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise FeedError('Unexpected market-feed redirect; no alternate host used.')

def number(x):
    try:
        d = D(str(x))
        if not d.is_finite() or d <= 0: raise ValueError()
        return d
    except Exception as e: raise FeedError('Invalid market number.') from e

def one(result, ignore=()):
    entries = [v for k,v in result.items() if k not in ignore]
    if len(entries) != 1: raise FeedError('Ambiguous market instrument.')
    return entries[0]

def fresh(q, now):
    if q.get('symbol') != 'DOGE/USD' or q.get('venue') != 'Kraken':
        raise FeedError('Wrong instrument or venue.')
    for key in ('observed_at','bid_time','ask_time'):
        t=float(q[key])
        if not 0 <= now-t <= MAX_AGE: raise FeedError('Stale or future-dated market quote.')
    if number(q['bid']) >= number(q['ask']): raise FeedError('Crossed or locked order book.')
    number(q['bid_size']); number(q['ask_size'])
    return q

class KrakenFeed:
    """Only GETs fixed public endpoints. All values retain decimal strings."""
    def __init__(self, clock=time.time, transport=None):
        self.clock = clock
        self.transport = transport

    def get(self, endpoint, **params):
        if endpoint not in ('Depth','OHLC','AssetPairs','SystemStatus'):
            raise FeedError('Endpoint is outside the read-only feed allowlist.')
        try:
            if self.transport:
                data = self.transport(endpoint, params)
            else:
                req=Request(BASE+endpoint+'?'+urlencode(params), headers={'Accept':'application/json','User-Agent':'TradeLord-Paper/1.0'})
                with build_opener(NoRedirect).open(req, timeout=8) as res:
                    if int(res.headers.get('Age','0')) > 5: raise FeedError('Cached market response.')
                    raw=res.read(2_000_001)
                    if len(raw)>2_000_000: raise FeedError('Oversized market response.')
                    data=json.loads(raw, parse_float=str)
            if not isinstance(data,dict) or data.get('error') or not isinstance(data.get('result'),dict):
                raise FeedError('Public market feed rejected the request.')
            return data['result']
        except FeedError: raise
        except Exception as e: raise FeedError('Public market feed unavailable; no price invented.') from e

    def quote(self):
        began=self.clock()
        status=self.get('SystemStatus')
        if status.get('status')!='online': raise FeedError('Venue is not in normal online trading status.')
        book=one(self.get('Depth',pair=PAIR,count=1))
        try:
            ask, bid=book['asks'][0], book['bids'][0]
            q=dict(symbol='DOGE/USD',venue='Kraken',observed_at=self.clock(),
                bid=str(number(bid[0])),ask=str(number(ask[0])),bid_size=str(number(bid[1])),ask_size=str(number(ask[1])),
                bid_time=float(bid[2]),ask_time=float(ask[2]))
            if q['observed_at']-began>15: raise FeedError('Market snapshot took too long.')
            return fresh(q,self.clock())
        except (KeyError,IndexError,TypeError) as e: raise FeedError('Incomplete market quote.') from e

    def snapshot(self):
        pair=one(self.get('AssetPairs',pair=PAIR))
        if pair.get('wsname') not in ('XDG/USD','DOGE/USD') or pair.get('status')!='online':
            raise FeedError('DOGE/USD identity or trading status not established.')
        raw=one(self.get('OHLC',pair=PAIR,interval=5),ignore=('last',))
        # Kraken explicitly documents the final bar as unfinished; never use it.
        if not isinstance(raw,list) or len(raw)<3: raise FeedError('Two completed candles are unavailable.')
        bars=[]
        for r in raw[-3:-1]:
            if len(r)<8: raise FeedError('Incomplete OHLC candle.')
            bars.append(dict(time=int(r[0]),open=str(number(r[1])),high=str(number(r[2])),low=str(number(r[3])),close=str(number(r[4])),completed=True))
        q=self.quote()
        if bars[1]['time']-bars[0]['time']!=300 or not 0<=q['observed_at']-(bars[1]['time']+300)<=360:
            raise FeedError('Completed candles are stale, missing or future dated.')
        if not 0 <= int(pair['lot_decimals']) <= 18: raise FeedError('Unsupported quantity precision.')
        return dict(quote=q,bars=bars,minimum_quantity=str(number(pair['ordermin'])),
            minimum_notional=str(number(pair['costmin'])),quantity_step=str(D(1).scaleb(-int(pair['lot_decimals']))),
            price_step=str(number(pair['tick_size'])),provider='Kraken public REST',docs=DOCS)
