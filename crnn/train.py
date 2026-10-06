import torch
from model import InfantCryDataset, CRNN
from torch.utils.data import DataLoader
import pandas as pd
import numpy as np
import torch.nn as nn
import wandb
from sklearn.metrics import accuracy_score, classification_report, f1_score

chunk_df = pd.read_csv("chunk_metadata.csv")

target_classes = ["hungry", "discomfort", "belly pain", "tired", "scared"]
class_to_label = {name: i for i, name in enumerate(target_classes)}

chunk_df = chunk_df[chunk_df["class"].isin(target_classes)].copy()
chunk_df["label"] = chunk_df["class"].map(class_to_label)

features = np.memmap("logmel_features.dat", dtype=np.float32, mode="r", shape=(14475, 80, 251))

train_dataset = InfantCryDataset(chunk_df, features, "train")
val_dataset = InfantCryDataset(chunk_df, features, "val")
test_dataset = InfantCryDataset(chunk_df, features, "test")

train_loader = DataLoader(train_dataset, batch_size=32, shuffle=True)
val_loader = DataLoader(val_dataset, batch_size=32, shuffle=False)
test_loader = DataLoader(test_dataset, batch_size=32, shuffle=False)

model = CRNN(num_classes=5)

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print("Device:", device)

if torch.cuda.is_available():
    print("GPU:", torch.cuda.get_device_name(0))

model = model.to(device)

wandb.init(
    project="infant_cry",
    name="crnn-v1.3",
    config={
        "architecture": "3CNN-2Layer-BiLSTM",
        "num_classes": 5,
        "classes": target_classes,
        "sample_rate": 16000,
        "n_fft": 1024,
        "hop_length": 256,
        "n_mels": 80,
        "window_size": 4,
        "window_hop": 2,
        "batch_size": 32,
        "learning_rate": 3e-4,
        "weight_decay": 1e-4,
        "optimizer": "AdamW",
        "scheduler": "ReduceLROnPlateau",
        "loss": "cross_entropy",
        "spec_augment": True,
        "epochs": 100
    }
)

criterion = nn.CrossEntropyLoss()

optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-4)

scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=2)

best_val_loss = float("inf")
early_stop_patience = 10
epochs_without_improvement = 0
num_epochs = 200

for epoch in range(num_epochs):
    model.train()

    train_loss = 0.0
    train_correct = 0
    train_total = 0

    for x, y in train_loader:
        x = x.to(device)
        y = y.to(device)

        optimizer.zero_grad()
        outputs = model(x)
        loss = criterion(outputs, y)
        loss.backward()
        optimizer.step()

        train_loss += loss.item() * x.size(0)

        predictions = outputs.argmax(dim=1)
        train_correct += (predictions == y).sum().item()
        train_total += y.size(0)

    train_loss /= train_total
    train_acc = train_correct / train_total

    model.eval()

    val_loss = 0.0
    val_correct = 0
    val_total = 0
    val_preds = []
    val_labels = []

    with torch.no_grad():
        for x, y in val_loader:
            x = x.to(device)
            y = y.to(device)

            outputs = model(x)
            loss = criterion(outputs, y)

            val_loss += loss.item() * x.size(0)

            predictions = outputs.argmax(dim=1)
            val_correct += (predictions == y).sum().item()
            val_total += y.size(0)

            val_preds.extend(predictions.cpu().numpy())
            val_labels.extend(y.cpu().numpy())

    val_loss /= val_total
    val_acc = val_correct / val_total

    val_macro_f1 = f1_score(val_labels, val_preds, average="macro")

    scheduler.step(val_loss)

    current_lr = optimizer.param_groups[0]["lr"]

    wandb.log({
        "epoch": epoch + 1,
        "train/loss": train_loss,
        "train/accuracy": train_acc,
        "val/loss": val_loss,
        "val/accuracy": val_acc,
        "val/macro_f1": val_macro_f1,
        "learning_rate": current_lr
    })

    print(
        f"Epoch {epoch + 1}/{num_epochs} | LR: {current_lr:.2e} | "
        f"Train Loss: {train_loss:.4f} | Train Acc: {train_acc:.4f} | "
        f"Val Loss: {val_loss:.4f} | Val Acc: {val_acc:.4f} | "
        f"Val Macro F1: {val_macro_f1:.4f}"
    )


model.load_state_dict(torch.load("crnn_v1_best.pth", map_location=device))
model.eval()

all_preds = []
all_labels = []

with torch.no_grad():
    for x, y in test_loader:
        x = x.to(device)

        outputs = model(x)
        predictions = outputs.argmax(dim=1)

        all_preds.extend(predictions.cpu().numpy())
        all_labels.extend(y.numpy())

test_acc = accuracy_score(all_labels, all_preds)
test_f1 = f1_score(all_labels, all_preds, average="macro")

print("Test Accuracy:", test_acc)
print("Test Macro F1:", test_f1)
print(classification_report(all_labels, all_preds))

wandb.log({
    "test/accuracy": test_acc,
    "test/macro_f1": test_f1
})

wandb.finish()