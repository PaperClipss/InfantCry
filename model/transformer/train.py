
import json
import random
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn

from sklearn.metrics import (
    accuracy_score,
    precision_recall_fscore_support,
    classification_report,
    confusion_matrix
)

from model import InfantCryTransformer
from data_processing import (
    CACHE_DIR,
    CLASS_TO_IDX,
    BATCH_SIZE,
    create_dataloaders
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]

CHECKPOINT_DIR = PROJECT_ROOT / "checkpoints" / "transformer"
RESULTS_DIR = PROJECT_ROOT / "results" / "transformer"

SEED = 42
EPOCHS = 100
LEARNING_RATE = 3e-4
WEIGHT_DECAY = 1e-4

EARLY_STOPPING_PATIENCE = 15
MIN_DELTA = 0.0001
GRADIENT_CLIP = 1.0

NUM_CLASSES = len(CLASS_TO_IDX)

CLASS_NAMES = [
    name
    for name, index in sorted(CLASS_TO_IDX.items(), key=lambda item: item[1])
]


def check_device():
    if not torch.cuda.is_available():
        raise RuntimeError(
            "CUDA is unavailable. Enable GPU in Kaggle Notebook Settings."
        )

    print("Training device: CUDA")
    print("GPU:", torch.cuda.get_device_name(0))
    print("CUDA version:", torch.version.cuda)


def set_seed(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def get_class_weights():
    labels = np.memmap(
        CACHE_DIR / "train" / "labels.dat",
        dtype=np.int64,
        mode="r"
    )

    class_counts = np.bincount(
        np.asarray(labels),
        minlength=NUM_CLASSES
    )

    if np.any(class_counts == 0):
        raise ValueError(
            f"At least one class has no training samples: {class_counts}"
        )

    weights = class_counts.sum() / (NUM_CLASSES * class_counts)

    weights = torch.tensor(
        weights,
        dtype=torch.float32,
        device="cuda"
    )

    print("\nTRAINING CLASS DISTRIBUTION")
    print("-" * 50)

    for class_name, count, weight in zip(
        CLASS_NAMES,
        class_counts,
        weights.cpu().numpy()
    ):
        print(
            f"{class_name}: {count} samples | Weight: {weight:.4f}"
        )

    return weights


def calculate_metrics(targets, predictions):
    accuracy = accuracy_score(targets, predictions)

    precision, recall, f1, _ = precision_recall_fscore_support(
        targets,
        predictions,
        labels=list(range(NUM_CLASSES)),
        average="macro",
        zero_division=0
    )

    return {
        "accuracy": float(accuracy),
        "macro_precision": float(precision),
        "macro_recall": float(recall),
        "macro_f1": float(f1)
    }


def run_epoch(model, loader, criterion, optimizer=None):
    training = optimizer is not None

    if training:
        model.train()
    else:
        model.eval()

    total_loss = 0.0
    total_samples = 0

    all_targets = []
    all_predictions = []

    for batch in loader:
        waveforms = batch["waveforms"].to(
            "cuda",
            non_blocking=True
        )

        labels = batch["labels"].to(
            "cuda",
            non_blocking=True
        )

        if training:
            optimizer.zero_grad(set_to_none=True)

        with torch.set_grad_enabled(training):
            logits = model(waveforms)
            loss = criterion(logits, labels)

            if training:
                loss.backward()

                torch.nn.utils.clip_grad_norm_(
                    model.parameters(),
                    GRADIENT_CLIP
                )

                optimizer.step()

        batch_size = labels.size(0)

        total_loss += loss.item() * batch_size
        total_samples += batch_size

        predictions = torch.argmax(logits, dim=1)

        all_targets.extend(labels.detach().cpu().numpy())
        all_predictions.extend(predictions.detach().cpu().numpy())

    metrics = calculate_metrics(
        all_targets,
        all_predictions
    )

    metrics["loss"] = float(total_loss / total_samples)

    return metrics, all_targets, all_predictions


def save_checkpoint(
    model,
    optimizer,
    scheduler,
    epoch,
    best_val_f1,
    filename
):
    checkpoint = {
        "epoch": epoch,
        "model_state_dict": model.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "scheduler_state_dict": scheduler.state_dict(),
        "best_val_macro_f1": best_val_f1,
        "class_to_idx": CLASS_TO_IDX,
        "class_names": CLASS_NAMES,
        "seed": SEED,
        "config": {
            "epochs": EPOCHS,
            "learning_rate": LEARNING_RATE,
            "weight_decay": WEIGHT_DECAY,
            "batch_size": BATCH_SIZE,
            "early_stopping_patience": EARLY_STOPPING_PATIENCE,
            "gradient_clip": GRADIENT_CLIP,
            "device": "cuda"
        }
    }

    torch.save(
        checkpoint,
        CHECKPOINT_DIR / filename
    )


def save_json(data, path):
    with open(path, "w") as file:
        json.dump(data, file, indent=4)


def main():
    check_device()
    set_seed(SEED)

    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    print("\nINFANTCRY TRANSFORMER TRAINING")
    print("=" * 60)

    train_loader, validation_loader, test_loader = create_dataloaders()

    model = InfantCryTransformer(
        num_classes=NUM_CLASSES,
        embedding_dim=256,
        num_layers=4,
        num_heads=8,
        feedforward_dim=1024,
        dropout=0.1,
        max_tokens=350
    ).to("cuda")

    trainable_parameters = sum(
        parameter.numel()
        for parameter in model.parameters()
        if parameter.requires_grad
    )

    print("Trainable parameters:", f"{trainable_parameters:,}")

    criterion = nn.CrossEntropyLoss(
        weight=get_class_weights()
    )

    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=LEARNING_RATE,
        weight_decay=WEIGHT_DECAY
    )

    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer,
        mode="min",
        factor=0.5,
        patience=5,
        min_lr=1e-6
    )

    history = []

    best_val_f1 = -float("inf")
    best_epoch = 0
    patience_counter = 0

    print("\nSTARTING TRAINING")
    print("=" * 60)

    for epoch in range(1, EPOCHS + 1):
        train_metrics, _, _ = run_epoch(
            model,
            train_loader,
            criterion,
            optimizer
        )

        val_metrics, _, _ = run_epoch(
            model,
            validation_loader,
            criterion
        )

        scheduler.step(val_metrics["loss"])

        current_lr = optimizer.param_groups[0]["lr"]

        history.append({
            "epoch": epoch,
            "learning_rate": current_lr,
            "train": train_metrics,
            "validation": val_metrics
        })

        print(f"\nEpoch [{epoch}/{EPOCHS}] LR: {current_lr:.7f}")

        print(
            f"Train | Loss: {train_metrics['loss']:.4f} "
            f"Acc: {train_metrics['accuracy']:.4f} "
            f"Macro F1: {train_metrics['macro_f1']:.4f}"
        )

        print(
            f"Val   | Loss: {val_metrics['loss']:.4f} "
            f"Acc: {val_metrics['accuracy']:.4f} "
            f"Macro F1: {val_metrics['macro_f1']:.4f}"
        )

        if val_metrics["macro_f1"] > best_val_f1 + MIN_DELTA:
            best_val_f1 = val_metrics["macro_f1"]
            best_epoch = epoch
            patience_counter = 0

            save_checkpoint(
                model,
                optimizer,
                scheduler,
                epoch,
                best_val_f1,
                "best_model.pt"
            )

            print("Best model checkpoint saved.")

        else:
            patience_counter += 1

        save_checkpoint(
            model,
            optimizer,
            scheduler,
            epoch,
            best_val_f1,
            "latest_checkpoint.pt"
        )

        save_json(
            history,
            RESULTS_DIR / "training_history.json"
        )

        if patience_counter >= EARLY_STOPPING_PATIENCE:
            print(
                f"\nEarly stopping at epoch {epoch}. "
                f"Best epoch: {best_epoch}"
            )
            break

    print("\nTRAINING COMPLETED")
    print("=" * 60)

    print("Best epoch:", best_epoch)
    print(f"Best validation macro F1: {best_val_f1:.4f}")

    checkpoint = torch.load(
        CHECKPOINT_DIR / "best_model.pt",
        map_location="cuda",
        weights_only=True
    )

    model.load_state_dict(checkpoint["model_state_dict"])

    print("\nFINAL TEST EVALUATION")
    print("=" * 60)

    test_metrics, test_targets, test_predictions = run_epoch(
        model,
        test_loader,
        criterion
    )

    for metric, value in test_metrics.items():
        print(f"{metric}: {value:.4f}")

    report = classification_report(
        test_targets,
        test_predictions,
        labels=list(range(NUM_CLASSES)),
        target_names=CLASS_NAMES,
        output_dict=True,
        zero_division=0
    )

    matrix = confusion_matrix(
        test_targets,
        test_predictions,
        labels=list(range(NUM_CLASSES))
    )

    pd.DataFrame(
        matrix,
        index=CLASS_NAMES,
        columns=CLASS_NAMES
    ).to_csv(
        RESULTS_DIR / "confusion_matrix.csv"
    )

    save_json(
        test_metrics,
        RESULTS_DIR / "test_metrics.json"
    )

    save_json(
        report,
        RESULTS_DIR / "classification_report.json"
    )

    print("\nCLASSIFICATION REPORT")

    print(
        classification_report(
            test_targets,
            test_predictions,
            labels=list(range(NUM_CLASSES)),
            target_names=CLASS_NAMES,
            zero_division=0
        )
    )

    print("\nSaved checkpoints to:", CHECKPOINT_DIR)
    print("Saved results to:", RESULTS_DIR)


if __name__ == "__main__":
    main()
