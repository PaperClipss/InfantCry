import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
import numpy as np
import pandas as pd
import torch

SR = 16000

N_FFT = 1024
HOP_LENGTH = 256

N_MELS = 80
FMIN = 20
FMAX = 8000

def spec_augment(x, freq_mask=8, time_mask=20):
    x = x.clone()
    f = torch.randint(0, freq_mask + 1, (1,)).item()

    if f > 0:
        f_start = torch.randint(0,x.shape[0] - f + 1,(1,)).item()
        mask_value = x.min()

        x[f_start:f_start + f, :] = mask_value


    t = torch.randint(0, time_mask + 1, (1,)).item()

    if t > 0:
        t_start = torch.randint(0,x.shape[1] - t + 1,(1,)).item()
        mask_value = x.min()
        x[:, t_start:t_start + t] = mask_value
    return x



class InfantCryDataset(Dataset):

    def __init__(self, chunk_df, features, split):
        self.df = chunk_df[chunk_df["split"] == split]
        self.features = features
        self.training = split == "train"

    def __len__(self):
        return len(self.df)
    
    def __getitem__(self, idx):

        original_idx = self.df.index[idx]
        x = self.features[original_idx]
        y = self.df.loc[original_idx, "label"]

        x = torch.tensor(x, dtype=torch.float32)

        if self.training: #augmentation
            x = spec_augment(x)
        x = x.unsqueeze(0)
        y = torch.tensor(y, dtype=torch.long)
        return x, y

    
class CRNN(nn.Module):

    def __init__(self, num_classes=13):
        super().__init__()

        self.cnn = nn.Sequential(
            # Block 1
            nn.Conv2d(1, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Dropout2d(0.15),

            # Block 2
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Dropout2d(0.20),

            # Block 3
            nn.Conv2d(64, 128, kernel_size=3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Dropout2d(0.25)
        )

        self.lstm = nn.LSTM(
            input_size=128 * 10,
            hidden_size=128,
            num_layers=2,
            batch_first=True,
            bidirectional=True,
            dropout=0.3
        )

        # BiLSTM → 128 × 2 directions = 256
        self.classifier = nn.Sequential(
            nn.Dropout(0.5),
            nn.Linear(256, num_classes)
        )

    def forward(self, x):

        x = self.cnn(x)

        B, C, H, W = x.shape
        x = x.permute(0, 3, 1, 2)

        # B × time × features
        x = x.reshape(B, W, C * H)

        x, _ = self.lstm(x)
        x = x.mean(dim=1)

        x = self.classifier(x)

        return x