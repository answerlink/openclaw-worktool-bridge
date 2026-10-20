import puppeteer from '../../frontend/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import path from 'node:path';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage();await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});await page.goto('file://'+path.resolve('design/styleframes.html'));await page.evaluate(()=>document.fonts.ready);let i=0;for(const el of await page.$$('.frame'))await el.screenshot({path:`design/styleframe-${++i}.png`});await browser.close();
