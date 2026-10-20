import librosa,numpy as np,json,pathlib
from scipy.signal import butter,sosfilt,find_peaks
p=pathlib.Path(__file__).resolve().parents[1]
y,sr=librosa.load('/Users/jialun/.codex/skills/video-shotcraft/assets/audio/bgm/house-vibez.mp3',sr=22050,duration=46)
tempo,beats=librosa.beat.beat_track(y=y,sr=sr,hop_length=128,tightness=400,units='time')
T,t0=np.polyfit(np.arange(len(beats)),beats,1); print('initial',T,t0,flush=True)
hits=[]
for k,lo,hi in [('kick',40,160),('snare',180,3000),('hihat',6000,10000)]:
 z=sosfilt(butter(3,[lo,hi],btype='band',fs=sr,output='sos'),y)
 e=np.sqrt(np.convolve(z*z,np.ones(110)/110,'same')); peaks,_=find_peaks(e,distance=int(sr*.17),prominence=np.max(e)*.06)
 hits.extend({'t':float(x/sr),'s':float(e[x]),'k':k} for x in peaks)
k=np.array([x['t'] for x in hits if x['k']=='kick']);candidates=[]
for factor in [.5,1,2]:
 tt=T*factor; phase=t0%tt
 for _ in range(4):
  grid=np.arange(phase,44,tt);near=np.array([k[np.argmin(abs(k-x))] for x in grid]);good=abs(near-grid)<.07
  tt,phase=np.polyfit(np.arange(len(grid))[good],near[good],1)
 grid=np.arange(phase,44,tt);near=np.array([k[np.argmin(abs(k-x))] for x in grid]);err=near-grid
 candidates.append({'T':float(tt),'t0':float(phase),'bpm':float(60/tt),'match':float(np.mean(abs(err)<.033)),'mean_abs_ms':float(np.mean(abs(err))*1000),'drift_ms':float(np.polyfit(grid,err,1)[0]*44*1000)})
best=min(candidates,key=lambda a:a['mean_abs_ms']);T=best['T'];t0=best['t0'];
while t0-T>=0:t0-=T
rms=librosa.feature.rms(y=y,hop_length=1024)[0]
out={**best,'t0':t0,'beats':np.arange(t0,44,T).tolist(),'hits':hits,'rms':rms.tolist(),'sections':[{'from':0,'to':44,'description':'steady house beat; scene boundaries at 8/20/32/36/48/60/68/80 beats'}]}
(p/'analysis/beat_data.json').write_text(json.dumps(out,indent=2));(p/'analysis/grid_drift.json').write_text(json.dumps(candidates,indent=2));print(candidates)
