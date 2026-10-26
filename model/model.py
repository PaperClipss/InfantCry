import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset


class InfantCryDataset(Dataset):
    """Log-mel dataset backed by a float32 memmap; augmentation is disabled."""
    def __init__(self, metadata, features, split):
        self.df = metadata.loc[metadata["split"] == split].copy().reset_index(drop=True)
        self.features = features
        if self.df.empty:
            raise ValueError(f"No samples found for split={split!r}")
        for column in ("feature_idx", "label"):
            if column not in self.df.columns:
                raise ValueError(f"Metadata must contain {column!r}")

    def __len__(self):
        return len(self.df)

    def __getitem__(self, idx):
        row = self.df.iloc[idx]
        feature_idx = int(row["feature_idx"])
        x = np.array(self.features[feature_idx], dtype=np.float32, copy=True)
        if not np.isfinite(x).all():
            raise ValueError(f"Non-finite feature values at feature_idx={feature_idx}")
        x = torch.from_numpy(x).unsqueeze(0)  # [1, mel, time]
        y = torch.tensor(int(row["label"]), dtype=torch.long)
        return x, y


class CRNN(nn.Module):
    """CNN + bidirectional LSTM + temporal attention for log-Mel spectrograms."""
    def __init__(self, num_classes=5):
        super().__init__()
        self.cnn = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Dropout2d(0.15),

            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Dropout2d(0.20),

            nn.Conv2d(64, 128, kernel_size=3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.Dropout2d(0.25),
        )
        # Input spectrogram height is 80; two 2x pools reduce it to 20.
        self.lstm = nn.LSTM(
            input_size=128 * 20,
            hidden_size=128,
            num_layers=2,
            batch_first=True,
            bidirectional=True,
            dropout=0.3,
        )
        self.attention = nn.Sequential(
            nn.Linear(256, 64),
            nn.Tanh(),
            nn.Linear(64, 1),
        )
        self.classifier = nn.Sequential(
            nn.Dropout(0.5),
            nn.Linear(256, num_classes),
        )

    def forward(self, x):
        x = self.cnn(x)
        batch_size, channels, height, width = x.shape
        x = x.permute(0, 3, 1, 2).contiguous()
        x = x.reshape(batch_size, width, channels * height)
        x, _ = self.lstm(x)
        attention_scores = self.attention(x)
        attention_weights = torch.softmax(attention_scores, dim=1)
        x = torch.sum(attention_weights * x, dim=1)
        return self.classifier(x)
