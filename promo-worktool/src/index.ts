import React from 'react';
import {registerRoot,Composition} from 'remotion';
import {Main} from './Main';
import {TOTAL,FPS} from './timeline';
const Root=()=>React.createElement(Composition,{id:'WorkToolPromo',component:Main,durationInFrames:TOTAL,fps:FPS,width:1920,height:1080,defaultProps:{bgm:true}});
registerRoot(Root);
