import json
import random
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.metrics import accuracy_score, classification_report, f1_score
from torch.utils.data import DataLoader

from model import CRNN, InfantCryDataset

SEED = 42
DATA_DIR = Path("processed")
METADATA_PATH = DATA_DIR / "processed_metadata_semantic.csv"
FEATURE_PATH = DATA_DIR / "logmel_features.dat"
CONFIG_PATH = DATA_DIR / "preprocessing_config_semantic.json"
CHECKPOINT_PATH = Path("crnn_semantic_weighted_no_aug_best.pth")

# Single experiment: weighted cross-entropy, no augmentation.
BATCH_SIZE = 16
NUM_EPOCHS = 200
LEARNING_RATE = 3e-4
WEIGHT_DECAY = 1e-4
EARLY_STOP_PATIENCE = 12
CLASS_NAMES = [
    "hunger",
    "sleepiness",
    "burping",
    "gas_lower_wind_pain",
    "physical_discomfort",
]


def set_seed(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def ensure_finite(name, tensor, context=""):
    if not torch.isfinite(tensor).all():
        finite = tensor[torch.isfinite(tensor)]
        details = (
            f"finite_min={finite.min().item():.6g}, "
            f"finite_max={finite.max().item():.6g}"
            if finite.numel() else "no finite values"
        )
        raise RuntimeError(f"Non-finite {name}. {context} {details}")


def evaluate(model, loader, criterion, device, split_name):
    model.eval()
    loss_sum = 0.0
    predictions, targets = [], []
    with torch.no_grad():
        for batch_idx, (x, y) in enumerate(loader):
            x = x.to(device, non_blocking=(device.type == "cuda"))
            y = y.to(device, non_blocking=(device.type == "cuda"))
            ensure_finite("inputs", x, f"{split_name} batch={batch_idx}")
            logits = model(x)
            ensure_finite("logits", logits, f"{split_name} batch={batch_idx}")
            loss = criterion(logits, y)
            ensure_finite("loss", loss, f"{split_name} batch={batch_idx}")
            loss_sum += loss.item() * y.size(0)
            predictions.extend(logits.argmax(1).cpu().numpy())
            targets.extend(y.cpu().numpy())

    avg_loss = loss_sum / len(loader.dataset)
    acc = accuracy_score(targets, predictions)
    macro_f1 = f1_score(
        targets, predictions, average="macro",
        labels=list(range(len(CLASS_NAMES))), zero_division=0
    )
    return avg_loss, acc, macro_f1, predictions, targets


def main():
    set_seed(SEED)
    device = torch.device(
        "cuda" if torch.cuda.is_available()
        else "mps" if torch.backends.mps.is_available()
        else "cpu"
    )
    print("Device:", device)

    for path in (METADATA_PATH, FEATURE_PATH, CONFIG_PATH):
        if not path.exists():
            raise FileNotFoundError(
                f"Required file not found: {path}. Check DATA_DIR and run preprocessing first."
            )

    metadata = pd.read_csv(METADATA_PATH)
    with CONFIG_PATH.open(encoding="utf-8") as f:
        config = json.load(f)

    class_to_idx = config["class_to_idx"]
    expected_mapping = {name: i for i, name in enumerate(CLASS_NAMES)}
    if class_to_idx != expected_mapping:
        raise ValueError(
            f"Unexpected class_to_idx mapping: {class_to_idx}; expected {expected_mapping}"
        )
    if set(metadata["class"].unique()) != set(CLASS_NAMES):
        raise ValueError(f"Unexpected metadata classes: {sorted(metadata['class'].unique())}")
    if len(metadata) != config["feature_shape"][0]:
        raise ValueError("Metadata row count does not match feature_shape.")
    if metadata["feature_idx"].tolist() != list(range(len(metadata))):
        raise ValueError("feature_idx must be contiguous and match memmap row order.")
    if metadata["label"].isna().any():
        raise ValueError("Metadata contains missing numeric labels.")
    if not np.array_equal(
        metadata["label"].to_numpy(dtype=np.int64),
        metadata["class"].map(class_to_idx).to_numpy(dtype=np.int64),
    ):
        raise ValueError("Numeric labels do not match class_to_idx.")

    feature_shape = tuple(config["feature_shape"])
    features = np.memmap(
        FEATURE_PATH, dtype=np.float32, mode="r", shape=feature_shape
    )
    # Validate memmap in blocks without loading all features into RAM.
    for start in range(0, feature_shape[0], 128):
        block = features[start:start + 128]
        if not np.isfinite(block).all():
            raise ValueError(f"Non-finite feature values in rows {start}:{start + len(block)}")

    train_ds = InfantCryDataset(metadata, features, "train")
    val_ds = InfantCryDataset(metadata, features, "val")
    test_ds = InfantCryDataset(metadata, features, "test")
    print("Dataset sizes:", len(train_ds), len(val_ds), len(test_ds))
    print("Class distribution:")
    print(pd.crosstab(metadata["split"], metadata["class"]).reindex(
        index=["train", "val", "test"], columns=CLASS_NAMES, fill_value=0
    ))

    pin_memory = device.type == "cuda"
    train_loader = DataLoader(
        train_ds, batch_size=BATCH_SIZE, shuffle=True,
        pin_memory=pin_memory, num_workers=0
    )
    val_loader = DataLoader(
        val_ds, batch_size=BATCH_SIZE, shuffle=False,
        pin_memory=pin_memory, num_workers=0
    )
    test_loader = DataLoader(
        test_ds, batch_size=BATCH_SIZE, shuffle=False,
        pin_memory=pin_memory, num_workers=0
    )

    model = CRNN(num_classes=len(CLASS_NAMES)).to(device)
    counts = (
        train_ds.df["label"].value_counts()
        .reindex(range(len(CLASS_NAMES)), fill_value=0)
        .sort_index()
    )
    if (counts == 0).any():
        raise ValueError(f"At least one class has no training samples: {counts.to_dict()}")

    # Inverse-frequency weights calculated only from training labels.
    weights = len(train_ds) / (len(CLASS_NAMES) * counts.to_numpy(dtype=np.float32))
    class_weights = torch.tensor(weights, dtype=torch.float32, device=device)
    criterion = nn.CrossEntropyLoss(weight=class_weights)
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY
    )
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="max", factor=0.5, patience=3
    )

    best_val_f1 = -1.0
    best_val_loss = float("inf")
    patience = 0

    for epoch in range(NUM_EPOCHS):
        model.train()
        loss_sum = 0.0
        train_preds, train_targets = [], []

        for batch_idx, (x, y) in enumerate(train_loader):
            x = x.to(device, non_blocking=(device.type == "cuda"))
            y = y.to(device, non_blocking=(device.type == "cuda"))
            ensure_finite("inputs", x, f"epoch={epoch + 1}, batch={batch_idx}")

            optimizer.zero_grad(set_to_none=True)
            logits = model(x)
            ensure_finite("logits", logits, f"epoch={epoch + 1}, batch={batch_idx}")
            loss = criterion(logits, y)
            ensure_finite("loss", loss, f"epoch={epoch + 1}, batch={batch_idx}")
            loss.backward()

            try:
                grad_norm = torch.nn.utils.clip_grad_norm_(
                    model.parameters(), max_norm=1.0, error_if_nonfinite=True
                )
            except RuntimeError as exc:
                raise RuntimeError(
                    f"Non-finite gradient at epoch={epoch + 1}, batch={batch_idx}"
                ) from exc
            if not torch.isfinite(grad_norm):
                raise RuntimeError(
                    f"Non-finite gradient norm at epoch={epoch + 1}, batch={batch_idx}"
                )

            optimizer.step()
            # Check parameters after the update, to catch an optimizer-induced issue.
            for name, param in model.named_parameters():
                if not torch.isfinite(param).all():
                    raise RuntimeError(
                        f"Non-finite parameter {name} after optimizer step "
                        f"at epoch={epoch + 1}, batch={batch_idx}"
                    )

            loss_sum += loss.item() * y.size(0)
            train_preds.extend(logits.argmax(1).detach().cpu().numpy())
            train_targets.extend(y.detach().cpu().numpy())

        train_loss = loss_sum / len(train_ds)
        train_acc = accuracy_score(train_targets, train_preds)
        train_f1 = f1_score(
            train_targets, train_preds, average="macro",
            labels=list(range(len(CLASS_NAMES))), zero_division=0
        )

        val_loss, val_acc, val_f1, _, _ = evaluate(
            model, val_loader, criterion, device, "validation"
        )
        scheduler.step(val_f1)
        lr = optimizer.param_groups[0]["lr"]

        improved = (val_f1 > best_val_f1) or (
            np.isclose(val_f1, best_val_f1) and val_loss < best_val_loss
        )
        if improved:
            best_val_f1 = val_f1
            best_val_loss = val_loss
            patience = 0
            torch.save({
                "epoch": epoch + 1,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "best_val_macro_f1": best_val_f1,
                "best_val_loss": best_val_loss,
                "class_to_idx": class_to_idx,
                "preprocessing_config": config,
                "class_weights": class_weights.detach().cpu(),
            }, CHECKPOINT_PATH)
        else:
            patience += 1

        print(
            f"Epoch {epoch + 1:03d}/{NUM_EPOCHS} | LR {lr:.2e} | "
            f"Train loss {train_loss:.4f} acc {train_acc:.4f} macro-F1 {train_f1:.4f} | "
            f"Val loss {val_loss:.4f} acc {val_acc:.4f} macro-F1 {val_f1:.4f}"
        )
        if patience >= EARLY_STOP_PATIENCE:
            print(f"Early stopping at epoch {epoch + 1}.")
            break

    checkpoint = torch.load(CHECKPOINT_PATH, map_location=device, weights_only=True)
    model.load_state_dict(checkpoint["model_state_dict"])
    test_loss, test_acc, test_f1, test_preds, test_targets = evaluate(
        model, test_loader, criterion, device, "test"
    )
    print("\nBest epoch:", checkpoint["epoch"])
    print("Test loss (weighted):", test_loss)
    print("Test accuracy:", test_acc)
    print("Test macro F1:", test_f1)
    print(classification_report(
        test_targets, test_preds,
        labels=list(range(len(CLASS_NAMES))),
        target_names=CLASS_NAMES, zero_division=0
    ))


if __name__ == "__main__":
    main()
