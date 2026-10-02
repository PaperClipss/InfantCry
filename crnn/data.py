from pathlib import Path
import pandas  as pd
import librosa
import numpy as np

data_path = Path("/Users/bnskartheek/Programming/PS_proj/FYP dataset")

classes = []
for item in data_path.iterdir():
    if(item.is_dir()):
        classes.append(item.name)
audio_extensions = {".wav", ".mp3", ".flac"}
records = []
for c in classes:
    class_path = Path(f"/Users/bnskartheek/Programming/PS_proj/FYP dataset/{c}")
    for file in class_path.iterdir():
        if file.is_file() and file.suffix.lower() in audio_extensions:
            records.append({
                "file_path":file,
                "class":c
            })


df = pd.DataFrame(records)
class_labels = {}
n = 0

for c in classes:
    class_labels[c] = n
    n += 1

df["label"] = df["class"].apply(lambda c: class_labels[c])

duration = []
sample_rate = []
channels = []
rms = []
peak_amp = []
for file_path in df["file_path"]:
    y,sr = librosa.load(file_path,sr = 16000,mono =True)
    duration.append(len(y)/sr)
    sample_rate.append(sr)
    channels.append(1 if y.ndim == 1 else y.shape[0])
    peak_amp.append(max(abs(y)))
    rms.append(sum(y**2)/len(y))

df["duration"] = duration
df["sample_rate"] = sample_rate
df["peak_amplitude"] = peak_amp
df["rms"] = rms

df = df[np.isfinite(df["duration"])].copy()
df["channels"] = channels

df.to_csv("dataset.csv")

print(df.head())
print(df["channels"].value_counts())
print(df["peak_amplitude"].describe())
print(df["rms"].describe())

# print(df["sample_rate"].value_counts())
# print(df["duration"].describe())

# print(df[df["duration"].isna()])
# print(df[df["sample_rate"].isna()])
# print(df["duration"].quantile([0.90, 0.95, 0.99]))
# print(df.groupby("class")["duration"].describe())
# print(df[df["sample_rate"] == 1600])