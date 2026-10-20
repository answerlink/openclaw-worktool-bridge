import React from 'react';
import {AbsoluteFill,Sequence} from 'remotion';
import {Open,Robots,Providers,Bridge,Scheduled,Logs,Dashboard,Outro,Caption,C} from './Scenes';
import {Sound} from './Sound';
import {SHOTS,TOTAL} from './timeline';
export const SCENES=[Open,Robots,Providers,Bridge,Scheduled,Logs,Dashboard,Outro];
export const CAPTIONS=[{shot:1,text:'机器人与回复规则，统一管理'},{shot:2,text:'连接 AI，让回复更有章法'},{shot:4,text:'设好时间，任务按计划执行'},{shot:5,text:'从问题到回答，每一步都有记录'},{shot:6,text:'消息趋势，一眼掌握'}].map(c=>({...c,from:SHOTS[c.shot].from+10,duration:SHOTS[c.shot].duration-10}));
export const Main:React.FC<{bgm?:boolean}>=({bgm=true})=><AbsoluteFill style={{background:C.bg}}>{SHOTS.map((s,i)=>{const Scene=SCENES[i];return <Sequence key={s.id} from={s.from} durationInFrames={s.duration}><Scene/></Sequence>})}{CAPTIONS.map(c=><Sequence key={c.shot} from={c.from} durationInFrames={c.duration}><Caption text={c.text}/></Sequence>)}<Sound bgm={bgm}/></AbsoluteFill>;
