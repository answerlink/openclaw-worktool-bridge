import React from "react";
import {Audio} from "@remotion/media";
import {AbsoluteFill,staticFile} from "remotion";
import "./lib/fonts";
import {useTime} from "./lib/anim";
import {Open,Brand,Feature,details,Montage,Hero,End} from "./scenes/Design";
export type PromoProps={withAudio:boolean;webMode?:boolean};
export const Promo:React.FC<PromoProps>=({withAudio})=>{
 const t=useTime();
 return <AbsoluteFill style={{background:"#F4F6FA"}}><Open t={t}/><Brand t={t}/>{details.map(d=><Feature key={d.name} t={t} d={d}/>)}<Montage t={t}/><Hero t={t}/><End t={t}/>{withAudio&&<Audio src={staticFile("audio/mix.wav")}/>}</AbsoluteFill>
};
