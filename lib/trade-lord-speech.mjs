// Reference metadata only. No YouTube audio, transcripts or model weights are downloaded.
export const DEFAULT_SPEECH = Object.freeze({listenLocale:'en-NG',replyLocale:'en-GB',voiceURI:'',rate:0.95,readAloud:false});
const video=(id,title,focus,creator='')=>({id,title,focus,creator,url:`https://www.youtube.com/watch?v=${id}`,kind:'YouTube reference',status:'Reference only · not ingested',license:'Training permission not verified',reviewed:'2026-10-27'});
export const SPEECH_SOURCES = [
  video('dtPRiXJYqWU','Nigerian Accent Tutorial','Nigerian English pronunciation and words','perdix'),
  video('g1HVsYXXZrw','Nigerian vs British pronunciation: family members','Side-by-side pronunciation examples','Level Up with Coach Irene'),
  video('Qh916gSELxw','Nigerian, Ghanaian and British pronunciation challenge','Compare individual words; an informal comparison','Nurse_Dee'),
  video('8vip9oZKsQg','The Nigerian accent is truly unique','Short accent example; not a complete speech course','Refined NG'),
  video('OE93ul7nZKQ','British vs Nigerian Accent Challenge','Informal Nigerian–British word comparisons'),
  video('yIf82HTIYe8','Nigeria Accent vs British Accent Challenge, part 1','Informal Nigerian–British word comparisons'),
  video('8Cn67veiMvQ','Nigerian, Ghanaian and American Accent Tag','Compare varieties without treating one as superior'),
  video('jRiL2oRbY0Q','How to speak Pidgin English like a pro','Nigerian Pidgin · separate from Nigerian English','Bobby Ibo'),
  video('vkgMFZMBfqQ','The Teachers’ Room: Top tips about intonation','British English: intonation and contrastive stress','BBC Learning English'),
  video('aUSjlg1B3uI','UK Accent Tour: R sounds, glottal stops, TH sounds','Regional UK accent differences'),
  video('Aoj4HZlLQBY','Questions and Intonation: Up or Down?','US English: pitch patterns in questions',"Rachel’s English"),
  video('F8DMN6anQnk','45 Minute Accent Training Class','US English: examples from learners and pronunciation practice',"Rachel’s English"),
  video('7EdRAfOMfnU','American English vowel sounds','US English: vowel sounds and mouth position','Sounds American'),
  {id:'idea-nigeria-2',title:'An Igbo man speaking English — Nigeria 2',creator:'International Dialects of English Archive',url:'https://www.dialectsarchive.com/nigeria-2',kind:'Speech reference',focus:'Speaker identified by the archive as Igbo, from Ovim, Abia. Recorded in 2009 after many years in the US; not a claim that he matches your accent.',license:'Training permission not verified',status:'Reference only · not ingested',reviewed:'2026-10-27'},
  {id:'slr70',title:'Nigerian English recordings — OpenSLR 70',creator:'Google, Inc. (2018–2019) / OpenSLR',url:'https://openslr.org/70/',kind:'Licensed dataset candidate',focus:'Transcribed volunteer recordings from Lagos and London. Speakers are not identified as specifically Igbo.',license:'CC BY-SA 4.0 · retain attribution and share-alike obligations',status:'Not downloaded · not trained',reviewed:'2026-10-27'},
  {id:'vctk092',title:'UK accent research — VCTK 0.92',creator:'Junichi Yamagishi, Christophe Veaux and Kirsten MacDonald / University of Edinburgh',url:'https://doi.org/10.7488/ds/2645',kind:'Licensed dataset candidate',focus:'English speech with multiple accents. Select speakers using the corpus metadata for UK-specific evaluation.',license:'CC BY 4.0 · retain attribution',status:'Not downloaded · not trained',reviewed:'2026-10-27'}
];
export const SPEECH_LESSONS = [
  {id:'speech-respect',title:'Understand the speaker, respect the accent',category:'Speech',body:'Nigerian English, Igbo-influenced English, UK English and US English are not one uniform accent. Understand the intended meaning without mocking, exaggerating or correcting someone’s accent unasked. Nigerian Pidgin is a distinct variety; do not silently treat all Nigerian English as Pidgin. Ask one short question when the intended meaning is uncertain.'},
  {id:'speech-owner-context',title:'This owner’s words and preferences',category:'Speech',body:'In this project the owner uses “here” for this ChatGPT workspace or its cloud browser, “my own” for the owner area, “put it” for filling the relevant field, and “save” for a visible Save button that persists the change. These are contextual examples from the owner, not rules about every Nigerian speaker. Explain one step at a time in familiar English. Never treat a vague phrase as permission to trade or move money.'},
  {id:'speech-learning',title:'How speech improvement is measured',category:'Speech',body:'Reference links are a reading and listening queue, not audio already learned by the model. Speech improvement requires a suitable speech model, permitted recordings, checked transcripts and a held-out test with different speakers. Measure transcription mistakes and whether meaning, numbers, negation, names and questions are understood. Replaying a video does not update model weights. Voice selection changes playback, not comprehension.'}
];
export function validateSpeech(input,current=DEFAULT_SPEECH){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Choose valid speech settings.');
  const next={...DEFAULT_SPEECH,...current};
  for(const key of ['listenLocale','replyLocale'])if(input[key]!==undefined){if(!['en-NG','en-GB','en-US'].includes(input[key]))throw new Error('Choose Nigerian English, UK English or US English.');next[key]=input[key];}
  if(input.voiceURI!==undefined){if(typeof input.voiceURI!=='string'||input.voiceURI.length>300)throw new Error('Choose an available device voice.');next.voiceURI=input.voiceURI;}
  if(input.rate!==undefined){if(!Number.isFinite(input.rate)||input.rate<0.7||input.rate>1.2)throw new Error('Speech speed must be between 0.7 and 1.2.');next.rate=input.rate;}
  if(input.readAloud!==undefined){if(typeof input.readAloud!=='boolean')throw new Error('Read aloud must be true or false.');next.readAloud=input.readAloud;}
  return next;
}
