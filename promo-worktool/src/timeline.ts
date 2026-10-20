import beats from './beat-data.json';
export const FPS=30;
export const SOURCE_BEAT0=0;
export const OUTPUT_AUDIO_OFFSET_SEC=0.042666666666666665;
export const BEAT_INT=beats.T;
export const beatF=(n:number)=>Math.round((SOURCE_BEAT0+OUTPUT_AUDIO_OFFSET_SEC+n*BEAT_INT)*FPS);
const ranges=[['open',0,8],['robots',8,20],['providers',20,32],['bridge',32,36],['scheduled',36,48],['logs',48,60],['dashboard',60,68],['outro',68,80]] as const;
export const SHOTS=ranges.map(([id,a,b])=>({id,from:a===0?0:beatF(a),duration:beatF(b)-(a===0?0:beatF(a))}));
export const TOTAL=beatF(80);
