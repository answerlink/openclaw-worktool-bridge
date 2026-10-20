import pathlib,librosa,numpy as np,json
p=pathlib.Path(__file__).resolve().parents[1];out={}
for f in (p/'public/audio').glob('*'):
 if f.suffix not in ['.wav','.mp3'] or f.name=='music.wav':continue
 y,sr=librosa.load(f,sr=48000);rms=np.convolve(y*y,np.ones(480)/480,'same');peak=np.argmax(rms)/sr
 out[f.name]={'peakSeconds':float(peak),'peakFrames':float(peak*30),'maxDB':float(20*np.log10(max(abs(y))+1e-9)),'duration':float(len(y)/sr)}
(p/'analysis/sfx-peaks.json').write_text(json.dumps(out,indent=2));print(out)
