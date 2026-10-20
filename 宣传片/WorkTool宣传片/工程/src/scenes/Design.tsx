import React from "react";
import {AbsoluteFill, Img, staticFile} from "remotion";
import {C,FONT} from "../lib/theme";
import {ramp,T,scene,SceneName} from "../lib/anim";
import {BrowserFrame} from "../components/BrowserFrame";
import {SHOTS,THUMBS,FOCUS} from "../assets";

const ease=(t:number,at=0)=>ramp(t,[at,at+0.55]);
const label:React.CSSProperties={fontSize:24,fontWeight:500,letterSpacing:3,color:C.accent};
const title:React.CSSProperties={fontSize:76,fontWeight:600,lineHeight:1.24,letterSpacing:-2};
const muted:React.CSSProperties={fontSize:30,color:C.dim,lineHeight:1.7};
const lift=(t:number,at=0)=>({opacity:ease(t,at),transform:"translateY("+(1-ease(t,at))*34+"px)"});

export const Shell:React.FC<{children:React.ReactNode;t:number;blue?:boolean}> = ({children,t,blue=false})=>
<AbsoluteFill style={{fontFamily:FONT.body,color:blue?"white":C.fg,background:blue?C.accent:C.bg,overflow:"hidden"}}>
 <div style={{position:"absolute",width:1100,height:1100,borderRadius:"50%",border:"1px solid "+(blue?"#ffffff20":"#dce4f0"),right:-470,top:-350,transform:"translateY("+Math.sin(t*0.4)*18+"px)"}}/>
 <div style={{position:"absolute",left:80,top:46,fontWeight:600,fontSize:26,letterSpacing:-0.5}}>WorkTool<span style={{fontWeight:400,opacity:0.45,marginLeft:16,fontSize:19}}>CONSOLE</span></div>
 <div style={{position:"absolute",right:80,top:51,fontSize:18,letterSpacing:2,opacity:0.55}}>企业微信机器人管理平台</div>
 {children}
 <div style={{position:"absolute",bottom:33,left:80,fontSize:17,color:blue?"#ffffff88":"#91a0b4"}}>WORKTOOL / AUTOMATION, CONNECTED.</div>
 <div style={{position:"absolute",bottom:33,right:80,fontSize:16,color:blue?"#ffffff88":"#91a0b4"}}>真实产品界面 · 敏感信息已隐藏</div>
 <div style={{position:"absolute",bottom:0,height:4,width:(t/T.duration*100)+"%",background:blue?"white":C.accent,opacity:0.55}}/>
</AbsoluteFill>;

export const Open:React.FC<{t:number}> = ({t})=>{
 const s=scene("open");if(t<s.start||t>=s.end)return null; const u=t-s.start;
 return <Shell t={t}>
 <div style={{position:"absolute",left:130,top:230,...lift(u)}}>
 <div style={label}>每天，都在重复这些事？</div>
 <div style={{...title,fontSize:100,marginTop:34}}>企业微信里的重复工作，<br/><span style={{color:C.accent}}>还在手动做？</span></div>
 </div>
 <div style={{position:"absolute",left:130,top:640,display:"flex",gap:25}}>
 {["反复回复","逐群通知","来回核对"].map((v,i)=><div key={v} style={{...lift(u,0.5+i*0.35),background:"white",border:"1px solid #e0e6ef",padding:"30px 45px",borderRadius:20,fontSize:33,boxShadow:"0 16px 40px #21385b08"}}><span style={{color:C.accent,marginRight:20}}>0{i+1}</span>{v}</div>)}
 </div>
 <div style={{position:"absolute",left:132,top:815,...lift(u,2),fontSize:27,color:C.dim}}>把时间留给客户，把重复交给流程。</div>
 </Shell>
};

export const Brand:React.FC<{t:number}> = ({t})=>{
 const s=scene("brand");if(t<s.start||t>=s.end)return null;const u=t-s.start;
 return <Shell t={t}>
 <div style={{position:"absolute",left:105,top:285,width:620,...lift(u)}}>
 <div style={label}>让企业微信，接上自动化</div>
 <div style={{fontSize:115,fontWeight:600,letterSpacing:-6,marginTop:20}}>WorkTool<span style={{color:C.accent}}>.</span></div>
 <div style={{...muted,marginTop:20}}>机器人、AI 回复与任务，<br/>在一个控制台管理。</div>
 <div style={{...lift(u,2),marginTop:40,display:"flex",gap:12}}>{["接入","配置","执行","追踪"].map(v=><span key={v} style={{fontSize:23,padding:"11px 19px",background:"#e7eefe",color:C.accent,borderRadius:99}}>{v}</span>)}</div>
 </div>
 <div style={{position:"absolute",left:780,top:220,transform:"perspective(1800px) rotateY(-9deg) rotateX(3deg) translateY("+(Math.sin(u)*7+(1-ease(u))*80)+"px)",opacity:ease(u)}}>
 <BrowserFrame src={SHOTS[0]} ratio={16/9} width={1250} height={760} url="console.worktool.ymdyes.cn" style={{boxShadow:"0 35px 90px #20417424",border:"1px solid #dae2ed"}}/>
 </div>
 </Shell>
};

type Detail={name:SceneName;number:string;kicker:string;head:string[];sub:string;note:string;shot:string;ratio:number;layout:"split"|"wide"|"focus";focus?:string;focusRatio?:number};
export const Feature:React.FC<{t:number;d:Detail}>=({t,d})=>{
 const s=scene(d.name);if(t<s.start||t>=s.end)return null;const u=t-s.start;
 const wide=d.layout==="wide";
 return <Shell t={t}>
 <div style={{position:"absolute",left:100,top:wide?130:225,width:wide?1700:530,...lift(u)}}>
  <div style={label}>{d.number} / {d.kicker}</div>
  <div style={{...title,fontSize:wide?64:76,marginTop:22}}>{d.head.map((h,i)=><React.Fragment key={h}><span style={{color:i===d.head.length-1?C.accent:C.fg}}>{h}</span>{!wide&&i<d.head.length-1?<br/>:i<d.head.length-1?"，":""}</React.Fragment>)}</div>
  {!wide&&<div style={{...muted,marginTop:30,maxWidth:490}}>{d.sub}</div>}
 </div>
 <div style={{position:"absolute",left:wide?190:700,top:wide?335:d.ratio>2?300:195,transform:"translateY("+(1-ease(u,0.1))*55+"px)",opacity:ease(u,0.1)}}>
 <BrowserFrame src={d.shot} ratio={d.ratio} width={wide?1540:1120} height={wide?590:Math.min(690,1120/d.ratio+42)} url={"WorkTool / "+d.kicker} zoom={1+Math.min(u/4,1)*0.018} style={{border:"1px solid #dce4ef",boxShadow:"0 28px 65px #2d46631c"}}/>
 </div>
 {d.ratio>2&&<div style={{position:"absolute",left:700,top:790,display:"flex",gap:18,...lift(u,2)}}>
 {(d.name==="rules"?["收到消息","AI 判断","按规则回复"]:["设定时间","自动执行","查看记录"]).map((x,i)=><div key={x} style={{background:"#e7eefe",color:C.accent,padding:"18px 23px",borderRadius:14,fontSize:26}}>{x}{i<2?"  →":""}</div>)}
 </div>}
 {d.focus&&<div style={{position:"absolute",left:840,top:620,opacity:ease(u,1.65),transform:"translateY("+(1-ease(u,1.65))*28+"px)",width:870,padding:14,background:"white",borderRadius:18,boxShadow:"0 25px 65px #17345630",border:"2px solid #2264ef"}}>
 <Img src={staticFile(d.focus)} style={{width:838,height:838/(d.focusRatio||2.6),objectFit:"cover",maxHeight:265,objectPosition:"top"}}/>
 </div>}
 <div style={{position:"absolute",left:wide?190:100,top:wide?947:770,...lift(u,2),maxWidth:wide?1540:530}}>
 <div style={{background:wide?"#e7eefe":"white",color:C.accent,borderLeft:"4px solid "+C.accent,padding:"17px 22px",fontSize:25,fontWeight:500,borderRadius:"0 12px 12px 0"}}>{d.note}</div>
 </div>
 </Shell>
};
export const details:Detail[]=[
 {name:"robots",number:"01",kicker:"机器人配置",head:["统一管理","回复有规则"],sub:"设置群聊与私聊规则，决定哪些消息需要回复。",note:"群聊 / 私聊，分别配置",shot:SHOTS[1],ratio:16/9,layout:"split"},
 {name:"rules",number:"02",kicker:"群聊回复判断",head:["该回复时","再开口"],sub:"有人 @ 直接按规则回复；其他消息交给 AI 判断。",note:"减少群聊里的不必要打扰",shot:FOCUS[0],ratio:3310/1280,layout:"focus"},
 {name:"providers",number:"03",kicker:"AI 回复引擎",head:["接入 AI","用你需要的引擎"],sub:"集中管理机器人回复时调用的模型服务。",note:"统一配置，按规则调用",shot:SHOTS[2],ratio:16/9,layout:"wide"},
 {name:"scheduled",number:"04",kicker:"定时任务",head:["时间设好","任务按时执行"],sub:"填写任务内容和执行时间，让日常安排按计划运行。",note:"执行计划与运行记录，随时可查",shot:FOCUS[2],ratio:3320/1130,layout:"split"},
 {name:"events",number:"05",kicker:"事件任务",head:["事件发生","动作自动跟上"],sub:"发生指定事件时，自动执行配置好的指令。",note:"触发条件、执行动作，清楚可见",shot:SHOTS[4],ratio:16/9,layout:"wide"},
 {name:"tags",number:"06",kicker:"标签与批量下发",head:["按标签分组","批量下发消息"],sub:"维护群发范围，再通过指令任务下发消息或文件。",note:"手动目标 + 标签组，可同时使用",shot:SHOTS[6],ratio:16/9,layout:"split",focus:FOCUS[4],focusRatio:3320/1270},
 {name:"monitor",number:"07",kicker:"消息监控",head:["处理过程","看得见"],sub:"查看消息与事件记录，核对机器人是否按预期工作。",note:"回到真实记录，追踪处理情况",shot:SHOTS[7],ratio:16/9,layout:"wide"},
];

export const Montage:React.FC<{t:number}>=({t})=>{
 const s=scene("montage");if(t<s.start||t>=s.end)return null;const u=t-s.start;
 const i=Math.min(7,Math.floor(u/T.pace.montageStep));const q=u-i*T.pace.montageStep;
 const names=["运营概览","机器人规则","AI 回复引擎","定时任务","事件任务","标签分组","指令下发","消息监控"];
 return <Shell t={t}>
 <div style={{position:"absolute",left:100,top:124,fontSize:56,fontWeight:600}}>从配置，到执行，再到追踪。</div>
 <div style={{position:"absolute",left:200,top:235,transform:"scale("+(0.98+0.02*ease(q))+")"}}>
 <BrowserFrame src={SHOTS[i]} ratio={16/9} width={1520} height={690} url="console.worktool.ymdyes.cn" style={{boxShadow:"0 22px 65px #26416620",border:"1px solid #dce4ef"}}/>
 </div>
 <div style={{position:"absolute",left:680,top:930,width:560,textAlign:"center",background:C.fg,color:"white",borderRadius:99,padding:"16px 30px",fontSize:30}}><span style={{opacity:0.5,marginRight:22}}>0{i+1}</span>{names[i]}</div>
 </Shell>
};

export const Hero:React.FC<{t:number}>=({t})=>{
 const s=scene("hero");if(t<s.start||t>=s.end)return null;const u=t-s.start;
 return <Shell t={t}>
 <div style={{position:"absolute",left:0,right:0,top:135,textAlign:"center",...lift(u)}}>
 <div style={{...title,fontSize:76}}>让重复工作，<span style={{color:C.accent}}>自动运转。</span></div>
 <div style={{...muted,marginTop:20}}>WorkTool · 企业微信机器人管理平台</div>
 </div>
 <div style={{position:"absolute",left:120,top:345,display:"grid",gridTemplateColumns:"repeat(4, 400px)",gap:25,transform:"translateY("+Math.sin(u)*5+"px)"}}>
 {THUMBS.map((src,i)=><div key={src} style={{...lift(u,0.15+Math.floor(i/4)*0.4),borderRadius:12,overflow:"hidden",boxShadow:"0 12px 30px #24436916",border:"1px solid #d5e0ef"}}><Img src={staticFile(src)} style={{width:400,height:225}}/></div>)}
 </div>
 <div style={{position:"absolute",left:0,right:0,top:905,textAlign:"center",fontSize:31,fontWeight:500,color:C.accent}}>开启企业微信自动化 → console.worktool.ymdyes.cn</div>
 <div style={{position:"absolute",top:850,left:0,right:0,textAlign:"center",fontSize:22,color:C.dim,...lift(u,2)}}>配置 · 执行 · 监控，一个控制台串起来。</div>
 </Shell>
};
export const End:React.FC<{t:number}>=({t})=>{
 const s=scene("end");if(t<s.start||t>=s.end)return null;const u=t-s.start;
 return <Shell t={t} blue>
 <div style={{position:"absolute",left:0,right:0,top:240,textAlign:"center",...lift(u)}}>
 <div style={{fontSize:150,letterSpacing:-7,fontWeight:600,transform:"scale("+(1+u*0.002)+")"}}>WorkTool.</div>
 <div style={{fontSize:50,marginTop:22,fontWeight:400}}>把时间，留给更重要的事。</div>
 <div style={{display:"inline-block",marginTop:70,padding:"22px 50px",background:"white",borderRadius:99,color:C.accent,fontSize:33,fontWeight:500}}>开启企业微信自动化 ↗</div>
 <div style={{fontSize:35,marginTop:32,letterSpacing:1}}>console.worktool.ymdyes.cn</div>
 <div style={{fontSize:22,marginTop:35,opacity:ease(u,2)*0.7}}>机器人管理 / AI 回复 / 任务自动化 / 消息监控</div>
 </div>
 </Shell>
};
