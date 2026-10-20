import numpy as np,librosa,json,pathlib
from scipy.signal import correlate
p=pathlib.Path(__file__).resolve().parents[1];sr=48000
mix,_=librosa.load(p/'analysis/render-audio.wav',sr=sr);dry,_=librosa.load(p/'analysis/render-sfx.wav',sr=sr);bgm,_=librosa.load(p/'public/audio/music-master.wav',sr=sr)
# Music correlation in 1-3 seconds, away from SFX.
a=bgm[sr:3*sr];b=mix[int(.8*sr):int(3.3*sr)];corr=correlate(b,a,mode='valid',method='fft');lag=(np.argmax(corr)+.8*sr-sr)/sr
T=json.loads((p/'analysis/beat_data.json').read_text())['T'];cuts=[]
for n in [8,20,32,36,48,60,68]:
 target=round(n*T*30+1.28);measured=(n*T+lag)*30;cuts.append({'beat':n,'cutFrame':target,'audioFrame':float(measured),'errorFrames':float(target-measured)})
peaks=json.loads((p/'analysis/sfx-peaks.json').read_text());targets=[(round(8*T*30+1.28)+45,'transition-soft.mp3'),(round(20*T*30+1.28),'swoosh-quick.mp3'),(round(68*T*30+1.28)+48,'impact-deep-whoosh.mp3')];probes=[]
for target,src in targets:
 start=max(0,round(target-peaks[src]['peakFrames']-1.28));ref,_=librosa.load(p/'public/audio'/src,sr=sr);ref=ref[:int(.8*sr)];lo=max(0,int((start/30-.15)*sr));hi=min(len(dry),int((start/30+1.2)*sr));cc=correlate(dry[lo:hi],ref,mode='valid',method='fft');offset=(np.argmax(cc)+lo)/sr-start/30;probes.append({'source':src,'target':target,'from':start,'offsetFrames':float(offset*30),'peakResidualFrames':float((start/30+offset+peaks[src]['peakSeconds'])*30-target)})
out={'pipeline':'Remotion 4.0.484 / AAC / 48000Hz / MP4','musicOffsetSeconds':float(lag),'cuts':cuts,'probes':probes,'mixedPeakDB':float(20*np.log10(max(abs(mix))+1e-9)),'sfxPeakDB':float(20*np.log10(max(abs(dry))+1e-9))}
(p/'analysis/audio-qa.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
