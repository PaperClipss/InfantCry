import pandas as pd
import librosa
import numpy as np
import librosa.display
import matplotlib.pyplot as plt

SR = 16000

N_FFT = 1024
HOP_LENGTH = 256

N_MELS = 80
FMIN = 20
FMAX = 8000

def extract_logmel(chunk, sr):
    S = librosa.stft(chunk,n_fft=N_FFT,hop_length=HOP_LENGTH)
    magnitude = np.abs(S)
    power = magnitude ** 2

    mel = librosa.feature.melspectrogram(S=power,sr=sr,n_mels=N_MELS,fmin=FMIN,fmax=FMAX    )

    mel_db = librosa.power_to_db(mel,ref=np.max)

    return mel_db

df = pd.read_csv("dataset.csv")

chunk_records = []

window_size = 4 * 16000
hop_size = 2 * 16000

for _, row in df.iterrows():

    y, sr = librosa.load(
        row["file_path"],
        sr=16000,
        mono=True
    )

    for start in range(0, len(y) - window_size + 1, hop_size):

        end = start + window_size

        chunk_records.append({
            "file_path": row["file_path"],
            "class": row["class"],
            "label": row["label"],
            "start_sample": start,
            "end_sample": end
        })


chunk_df = pd.DataFrame(chunk_records)
print(chunk_df.shape)
# print(chunk_df.head())
# print(chunk_df["class"].value_counts())
# print(chunk_df.groupby("class")["file_path"].nunique())
# print(chunk_df.groupby("file_path").size().describe())

from sklearn.model_selection import train_test_split

train_df, temp_df = train_test_split(df,test_size=0.30,stratify=df["label"],random_state=42)

val_df, test_df = train_test_split(temp_df,test_size=0.50,stratify=temp_df["label"],random_state=42)

print(len(train_df))
print(len(val_df))
print(len(test_df))

train_files = set(train_df["file_path"])
val_files = set(val_df["file_path"])
test_files = set(test_df["file_path"])

def get_split(file_path):
    if file_path in train_files:
        return "train"
    elif file_path in val_files:
        return "val"
    elif file_path in test_files:
        return "test"

chunk_df["split"] = chunk_df["file_path"].apply(get_split)

row = chunk_df[chunk_df["split"] == "train"].iloc[0]

y, sr = librosa.load(row["file_path"],sr=16000,mono=True)

chunk = y[row["start_sample"]:row["end_sample"]]
S = librosa.stft(chunk,n_fft=1024,hop_length=256)

feature = extract_logmel(chunk, sr)

features = np.memmap(
    "logmel_features.dat",
    dtype=np.float32,
    mode="w+",
    shape=(len(chunk_df), N_MELS, 251)
)
for file_path, group in chunk_df.groupby("file_path"):
    y, sr = librosa.load(file_path,sr=SR,mono=True)

    for idx, row in group.iterrows():

        chunk = y[row["start_sample"]:row["end_sample"]]

        feature = extract_logmel(chunk, sr)

        features[idx] = feature

features.flush()


print(features.shape)
print(features[0].min(), features[0].max())
print(features[-1].min(), features[-1].max())
print("NaN:", np.isnan(features).sum())
print("Inf:", np.isinf(features).sum())
print("Shape:", features.shape)

