import {Main,SCENES,CAPTIONS} from './Main';
import {Caption,C} from './Scenes';
import {SHOTS,TOTAL,FPS} from './timeline';
import {SFX,BGM} from './Sound';
const text=(key:string,label:string,value:string)=>({type:'text',key,label,default:value});
const schemas=[
 [text('title','主标题','让企微协作'),text('subtitle','强调语','自动运转。'),{type:'color',key:'accent',label:'强调色',default:C.accent}],
 [],[],[text('text','引导文案','把重复操作，交给自动化'),{type:'color',key:'accent',label:'强调色',default:C.accent}],[],[],[],
 [text('brand','品牌','WorkTool Console'),text('tagline','结尾文案','让团队专注更重要的事'),text('url','网址','console.worktool.ymdyes.cn'),{type:'color',key:'accent',label:'强调色',default:'#a8c8cd'}]
];
export const WORKBENCH={name:'WorkTool Console · 产品宣传片',fps:FPS,width:1920,height:1080,total:TOTAL,background:C.bg,revision:'1',shots:SHOTS.map((s,i)=>({...s,label:['品牌开场','统一管理','AI 回复引擎','自动化引导','定时任务','消息监控','运营概览','品牌收尾'][i],component:SCENES[i],schema:schemas[i]})),captions:CAPTIONS.map(c=>({id:'caption-'+c.shot,from:c.from,duration:c.duration,label:c.text,component:Caption,props:{text:c.text},schema:[text('text','字幕',c.text),{type:'number',key:'fontSize',label:'字号',default:64,min:32,max:110,step:1},{type:'color',key:'color',label:'颜色',default:C.ink}]})),sfx:SFX.map(s=>({...s,duration:Math.min(s.duration,TOTAL-s.from),src:'audio/'+s.src})),bgm:[BGM],original:Main};
