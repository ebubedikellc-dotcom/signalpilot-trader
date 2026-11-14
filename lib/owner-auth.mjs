import {createHash, timingSafeEqual} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest();
export function createOwnerAuth({password='',now=Date.now}={}) {
  const configured=typeof password==='string'&&password.length>=16&&password.length<=256;
  const version=configured?digest('signalpilot-owner-session-v1:'+password).toString('hex'):null;
  let failures=0,windowStart=now();
  return {
    configured, version,
    verify(input) {
      if (!configured) throw Object.assign(new Error('Owner password must be configured on the server before login.'),{status:503});
      if(now()-windowStart>=60000){failures=0;windowStart=now();}
      if(failures>=5)throw Object.assign(new Error('Wait one minute before another login attempt.'),{status:429});
      const ok=typeof input==='string'&&input.length<=256&&timingSafeEqual(digest(input),digest(password));
      if(!ok)failures++;
      return ok;
    },
    accepts(session) { return configured&&session?.ownerAuthVersion===version; }
  };
}
