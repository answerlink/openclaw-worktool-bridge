import librosa,numpy as np,json,pathlib,soundfile as sf
from scipy.signal import butter,sosfilt,find_peaks
p=pathlib.Path(__file__).resolve().parents[1]
src='/Users/jialun/.codex/skills/video-shotcraft/assets/audio/bgm/house-vibez.mp3'
y,sr=librosa.load(src,sr=44100,mono=False);mono=y.mean(axis=0)
z=sosfilt(butter(3,[40,160],btype='band',fs=sr,output='sos'),mono[:int(15.6*sr)]);e=np.sqrt(np.convolve(z*z,np.ones(220)/220,'same'));pk,_=find_peaks(e,distance=int(sr*.17),prominence=e.max()*.06);ts=pk/sr
near=np.array([ts[np.argmin(abs(ts-(.085+i*60/122)))] for i in range(32)]);T,t0=np.polyfit(np.arange(32),near,1);err=near-(t0+np.arange(32)*T)
# Select first eight-bar steady groove; repeat at its measured length. No tempo change.
start=round(t0*sr);size=round(32*T*sr);loop=y[:,start:start+size];out=np.tile(loop,(1,3))[:,:round(42*sr)].T
sf.write(p/'public/audio/music.wav',out,sr,subtype='PCM_16')
beats=np.arange(0,42,T);report={'source':'House Vibez — Lily J (Mixkit 745)','source_t0':float(t0),'T':float(size/sr/32),'bpm':float(60/T),'t0':0,'beats':beats.tolist(),'hits':[{**h,'t':h['t']-t0+j*32*T} for j in range(3) for h in json.loads((p/'analysis/beat_data.json').read_text())['hits'] if t0<=h['t']<t0+32*T],'rms':librosa.feature.rms(y=out.mean(axis=1),hop_length=2048)[0].tolist(),'sections':[{'from':0,'to':42,'description':'First 8 bars of steady instrumental groove, looped without tempo change'}]}
(p/'analysis/beat_data.json').write_text(json.dumps(report,indent=2));grid={'selected_source_section':[float(t0),float(t0+32*T)],'match':float(np.mean(abs(err)<.033)),'mean_abs_ms':float(np.mean(abs(err))*1000),'max_abs_ms':float(max(abs(err))*1000),'drift_ms':float(np.polyfit(np.arange(32)*T,err,1)[0]*32*T*1000),'reason':'Full song has breakdown; use first 32 steady beats, repeat source segment. Half/double tempo rejected from prior candidate report.'};(p/'analysis/grid-final.json').write_text(json.dumps(grid,indent=2));print(grid);print('T',size/sr/32)
