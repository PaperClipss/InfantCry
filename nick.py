import pandas as pd
import numpy as np
import librosa as lib
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import confusion_matrix , classification_report , accuracy_score
from sklearn.model_selection import train_test_split
from pathlib import Path
import matplotlib.pyplot as plt
import kagglehub

path = kagglehub.dataset_download("rajipri/infant-cry")
Dataset_path = Path(path) / "FYP dataset"

data = []
spectrograms = []
labels = []
TARGET_LENGTH = 16000 * 3
for subfolder in Dataset_path.iterdir():
    if subfolder.is_dir():
        wav_files = list(subfolder.glob("*.wav"))
        if len(wav_files) < 400:
            continue # remove classes with less than 400 recordings

    for file  in subfolder.glob("*.wav"):
        label = subfolder.name
        if label == 'noise':
            continue # remove the nosie if thats a class
        audio , sr = lib.load(file , sr = 16000)
        audio , _ = lib.effects.trim(audio , top_db=30)
        audio = lib.util.normalize(audio)
        rms = lib.feature.rms(
                y = audio
            )
        if rms.mean() < 0.001:
            continue
        if len(audio) < TARGET_LENGTH:
            audio = np.pad(
            audio,
            (0, TARGET_LENGTH - len(audio))
            )
        else:
            audio = audio[:TARGET_LENGTH]
        spectrogram = lib.stft(audio)
        spectrogram_db = lib.amplitude_to_db(
            np.abs(spectrogram),
            ref=np.max
        )

        spectrograms.append(spectrogram_db.astype(np.float32))
        labels.append(label)
        mfcc = lib.feature.mfcc(
            y = audio,
            sr = sr,
            n_mfcc = 13
        )
        mfcc_mean = mfcc.mean(axis = 1)
        mfcc_std = mfcc.std(axis = 1)

        centroid = lib.feature.spectral_centroid(
            y = audio,
            sr = sr
        )
        bandwidth = lib.feature.spectral_bandwidth(
            y = audio,
            sr = sr
        )
        rolloff = lib.feature.spectral_rolloff(
            y = audio,
            sr = sr
        )
        zcr = lib.feature.zero_crossing_rate(
            audio
        )
        row = {
            "file_name" : file.name,
            "label" : label
        }
        for i, value in enumerate(mfcc_mean):
            row[f"mfcc_mean_{i+1}"] = value

        for i, value in enumerate(mfcc_std):
            row[f"mfcc_std_{i+1}"] = value

        row["centroid_mean"] = centroid.mean()
        row["centroid_std"] = centroid.std()

        row["bandwidth_mean"] = bandwidth.mean()
        row["bandwidth_std"] = bandwidth.std()

        row["rolloff_mean"] = rolloff.mean()
        row["rolloff_std"] = rolloff.std()

        row["zcr_mean"] = zcr.mean()
        row["zcr_std"] = zcr.std()

        row["rms_mean"] = rms.mean()
        row["rms_std"] = rms.std()
        data.append(row)
df = pd.DataFrame(data)

df.head()

df = df.drop(columns = ['file_name'])
y = df['label']
X = df.drop(columns = ['label'])
X_train , X_test , y_train , y_test = train_test_split(X , y , train_size=0.8 , test_size = 0.2 , random_state=42)
(X_train.shape[0] , X_test.shape[0])

model = RandomForestClassifier(max_depth=None , n_estimators=300 , bootstrap=True , criterion='gini' , random_state = 42)
model.fit(X_train , y_train)

y_pred = model.predict(X_test)
acc = accuracy_score(y_test , y_pred)
acc

from tensorflow.keras.layers import Dense , Conv2D , Dropout , SimpleRNN , Bidirectional , LSTM , Normalization , Reshape , Input , MaxPool2D , Permute
from tensorflow.keras.models import Sequential

X_cnn = np.array(spectrograms)
y_cnn = np.array(labels)
print(X_cnn.shape)


X_cnn = X_cnn[..., np.newaxis]


from sklearn.preprocessing import LabelEncoder
encoder = LabelEncoder()
y_y = encoder.fit_transform(y)
X_cnn_train , X_cnn_test , y_train_cnn , y_test_cnn = train_test_split(X_cnn , y_y , random_state=42 , train_size = 0.8)
X_cnn_train.shape

from tensorflow.keras.callbacks import EarlyStopping
early_stopping = EarlyStopping(
    monitor='val_accuracy',
    patience=3,
    restore_best_weights=True
)

normalizer = Normalization(axis=1)
normalizer.adapt(X_cnn_train)

model = Sequential()

model.add(
    Input(shape=(1025, 94, 1))
)

model.add(normalizer)

model.add(
    Conv2D(
        16,
        (3, 3),
        activation='relu'
    )
)

model.add(
    MaxPool2D((2, 2))
)

model.add(
    Conv2D(
        32,
        (3, 3),
        activation='relu'
    )
)

model.add(
    MaxPool2D((2, 2))
)

model.add(
    Conv2D(
        64,
        (3, 3),
        activation='relu'
    )
)

model.add(
    MaxPool2D((2, 2))
)

model.add(
    Permute((2, 1, 3))
)

model.add(
    Reshape((10, 126 * 64))
)

model.add(
    Dense(
        128,
        activation='relu'
    )
)

model.add(
    SimpleRNN(
        64,
        activation='relu',
        return_sequences=True
    )
)

model.add(
    SimpleRNN(
        32,
        activation='relu',
        return_sequences=True
    )
)

model.add(
    SimpleRNN(
        16,
        activation='relu'
    )
)

model.add(
    Dropout(0.1)
)

model.add(
    Dense(
        128,
        activation='relu'
    )
)

model.add(
    Dropout(0.2)
)

model.add(
    Dense(
        64,
        activation='relu'
    )
)

model.add(
    Dropout(0.3)
)

model.add(
    Dense(
        32,
        activation='relu'
    )
)

model.add(
    Dropout(0.4)
)

model.add(
    Dense(
        13,
        activation='softmax'
    )
)

model.compile(
    loss = 'sparse_categorical_crossentropy',
    optimizer = 'adam',
    metrics = ['accuracy']
)

model.fit(
    X_cnn_train,
    y_train_cnn,
    validation_data = (X_cnn_test , y_test_cnn),
    epochs = 100,
    batch_size = 32,
    callbacks = [early_stopping]
)

hist = model.history.history['val_accuracy'][-1]
final_val_acc = round(hist , 3)
print(final_val_acc)