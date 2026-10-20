"""WorkTool cue sheet: shared timing, restrained UI cues, two energy lifts."""
import sys
from audiolib import Mix,timing,load,seg,muffle,build_in,sub_boom,blip,flick,envelope
tm=timing()
sc={k:v[0] for k,v in tm["scenes"].items()}
mix=Mix(tm["duration"])
music=seg(load("music.mp3"),tm["musicOffset"],tm["musicOffset"]+tm["duration"])
music=build_in(music,tm["drop"],hp_hz=450,g0=0.25,g1=1)
music=muffle(music,sc["events"],sc["tags"],hz=1200,gain=0.62)
mix.place(music,0,gain=0.8,fade_in=0.3,fade_out=1.8,tag="music")
for name,at in sc.items():
 if at:
  mix.place(flick(0.14,0.25),at,gain=0.4)
  mix.place(sub_boom(0.3,120,70,15),at,gain=0.10)
for name in ["brand","tags","hero"]:
 mix.place(sub_boom(0.65,85,42,7),sc[name],gain=0.28)
for i in range(8):
 mix.place(flick(0.06,0.15),sc["montage"]+i*tm["pace"]["montageStep"],gain=0.4)
for name in ["robots","rules","providers","scheduled","events","tags","monitor"]:
 mix.place(blip(1320,0.09,0.12),sc[name]+tm["pace"]["detailAt"],gain=0.2)
mix.master()
if "--env" in sys.argv:envelope()
