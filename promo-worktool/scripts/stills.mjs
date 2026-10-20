import {bundle} from '@remotion/bundler';
import {selectComposition,renderStill,openBrowser} from '@remotion/renderer';
import fs from 'node:fs';
const serveUrl=await bundle({entryPoint:'src/index.ts',publicDir:'public'});
const browserExecutable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=await openBrowser('chrome',{browserExecutable});const composition=await selectComposition({serveUrl,id:'WorkToolPromo',puppeteerInstance:browser});
const T=JSON.parse(fs.readFileSync('analysis/beat_data.json')).T;
const ranges=[[0,8],[8,20],[20,32],[32,36],[36,48],[48,60],[60,68],[68,80]];
const frames=process.argv.slice(2).length?process.argv.slice(2).map(Number):ranges.flatMap(([a,b])=>{const start=Math.round(a*T*30),end=Math.round(b*T*30);return [start+20,start+Math.round((end-start)*.5),end-15]});
for(const frame of frames){await renderStill({composition,serveUrl,output:`out/qa/f${frame}.png`,frame,puppeteerInstance:browser,imageFormat:'png'});console.log('frame',frame);}
await browser.close({silent:true});
