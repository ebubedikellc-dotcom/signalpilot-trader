import {createPublicKey, verify} from 'node:crypto';

export function base58(bytes) {
  let n=BigInt('0x'+Buffer.from(bytes).toString('hex')), out='';
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  while(n){out=alphabet[Number(n%58n)]+out;n/=58n;}
  for(const b of bytes){if(b!==0)break;out='1'+out;}
  return out;
}

// A sponsored order can legitimately lack the fee payer's signature until
// Jupiter executes it. The owner's signature must still be valid and unchanged.
export function inspectSwapSignature(tx, original, wallet, order) {
  const message=Buffer.from(tx.message.serialize());
  if(!message.equals(Buffer.from(original.message.serialize()))) throw new Error('Signed swap message differs from the quoted order');
  const keys=tx.message.staticAccountKeys;
  const count=tx.message.header.numRequiredSignatures;
  const index=keys.slice(0,count).findIndex(k=>k.toBase58()===wallet);
  if(index<0)throw new Error('Trading wallet is not a required signer');
  const signature=tx.signatures[index];
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(keys[index].toBytes())]),format:'der',type:'spki'});
  if(!signature || signature.length!==64 || !verify(null,message,key,signature))throw new Error('Trading wallet signature is missing or invalid');
  const payerSignature=tx.signatures[0];
  if(payerSignature?.some(b=>b!==0))return base58(payerSignature);
  const payer=keys[0].toBase58();
  if(index===0 || !order.requestId || order.signatureFeePayer!==payer || payer===wallet) {
    throw new Error('Fee payer signature is missing and no matching Jupiter sponsor was provided');
  }
  return null; // Persist request identity before submission; learn txid from execute.
}
