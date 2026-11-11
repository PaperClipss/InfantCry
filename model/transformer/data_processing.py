
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import soundfile as sf
import torch

from scipy.signal import resample_poly
from sklearn.model_selection import StratifiedKFold
from torch.utils.data import Dataset, DataLoader


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATASET_ROOT = PROJECT_ROOT / "Datasets" / "Datasets"
METADATA_PATH = DATASET_ROOT / "metadata.csv"
OUTPUT_DIR = PROJECT_ROOT / "processed" / "waveform_transformer"

TARGET_SAMPLE_RATE = 16000
TARGET_DURATION = 7
TARGET_SAMPLES = TARGET_SAMPLE_RATE * TARGET_DURATION

RANDOM_STATE = 42
N_SPLITS = 20
TRAIN_FOLDS = 14
VALIDATION_FOLDS = 3
TEST_FOLDS = 3

BATCH_SIZE = 16
NUM_WORKERS = 0

LABEL_MAPPING = {
    "neh": "hunger",
    "owh": "sleepy",
    "eh": "needs_to_burp",
    "eairh": "gas_lower_wind_pain",
    "heh": "physical_discomfort"
}

CLASS_TO_IDX = {
    "hunger": 0,
    "sleepy": 1,
    "needs_to_burp": 2,
    "gas_lower_wind_pain": 3,
    "physical_discomfort": 4
}

DEVICE = (
    torch.device("cuda")
    if torch.cuda.is_available()
    else torch.device("mps")
    if torch.backends.mps.is_available()
    else torch.device("cpu")
)


def normalize_folder_name(name):
    return " ".join(name.strip().lower().split())


def resolve_audio_path(relative_path):
    relative_path = str(relative_path).replace("\\", "/")
    parts = Path(relative_path).parts

    aliases = {
        "1214 collcted data": "1214 Collected Data",
        "1214 collected data": "1214 Collected Data",
        "dunstan 337": "dunstan  337"
    }

    current_path = DATASET_ROOT

    for part in parts:
        alias = aliases.get(normalize_folder_name(part), part)
        candidate = current_path / alias

        if candidate.exists():
            current_path = candidate
            continue

        if not current_path.exists() or not current_path.is_dir():
            return None

        matching_path = None
        normalized_part = normalize_folder_name(alias)

        for child in current_path.iterdir():
            if normalize_folder_name(child.name) == normalized_part:
                matching_path = child
                break

        if matching_path is None:
            return None

        current_path = matching_path

    if current_path.is_file():
        return current_path

    return None


def load_waveform(audio_path):
    waveform, sample_rate = sf.read(
        str(audio_path),
        dtype="float32",
        always_2d=True
    )

    waveform = waveform.mean(axis=1)

    if waveform.size == 0:
        raise ValueError(f"Empty audio file: {audio_path}")

    if sample_rate <= 0:
        raise ValueError(f"Invalid sample rate: {audio_path}")

    if not np.isfinite(waveform).all():
        raise ValueError(f"Non-finite audio values: {audio_path}")

    if sample_rate != TARGET_SAMPLE_RATE:
        divisor = math.gcd(sample_rate, TARGET_SAMPLE_RATE)
        up = TARGET_SAMPLE_RATE // divisor
        down = sample_rate // divisor

        waveform = resample_poly(
            waveform,
            up,
            down
        ).astype(np.float32)

    if len(waveform) > TARGET_SAMPLES:
        waveform = waveform[:TARGET_SAMPLES]

    elif len(waveform) < TARGET_SAMPLES:
        padding = TARGET_SAMPLES - len(waveform)
        waveform = np.pad(
            waveform,
            (0, padding),
            mode="constant"
        )

    return waveform.astype(np.float32)


def create_splits():
    if not METADATA_PATH.exists():
        raise FileNotFoundError(
            f"Metadata file not found: {METADATA_PATH}"
        )

    metadata = pd.read_csv(METADATA_PATH)

    required_columns = {
        "relative_path",
        "tier",
        "class",
        "tier_name"
    }

    missing_columns = required_columns - set(metadata.columns)

    if missing_columns:
        raise ValueError(
            f"Missing metadata columns: {missing_columns}"
        )

    if metadata["relative_path"].isna().any():
        raise ValueError("Metadata contains missing relative paths.")

    if metadata["relative_path"].duplicated().any():
        raise ValueError("Metadata contains duplicate relative paths.")

    metadata["class"] = metadata["class"].astype(str).str.strip().str.lower()

    unknown_labels = set(metadata["class"].unique()) - set(LABEL_MAPPING)

    if unknown_labels:
        raise ValueError(f"Unknown classes found: {unknown_labels}")

    metadata["class_name"] = metadata["class"].map(LABEL_MAPPING)
    metadata["label_id"] = metadata["class_name"].map(CLASS_TO_IDX)

    metadata["tier"] = (
        metadata["tier"]
        .astype(str)
        .str.extract(r"([12])")[0]
        .astype(int)
    )

    if set(metadata["tier"].unique()) != {1, 2}:
        raise ValueError("Expected both Tier 1 and Tier 2 samples.")

    metadata["audio_path"] = metadata["relative_path"].apply(
        resolve_audio_path
    )

    missing_paths = metadata.loc[
        metadata["audio_path"].isna(),
        "relative_path"
    ].tolist()

    if missing_paths:
        raise FileNotFoundError(
            f"{len(missing_paths)} audio files missing. "
            f"Examples: {missing_paths[:10]}"
        )

    metadata["audio_path"] = metadata["audio_path"].apply(str)

    tier1 = metadata[metadata["tier"] == 1].copy()
    tier2 = metadata[metadata["tier"] == 2].copy()

    tier2 = tier2.reset_index(drop=True)

    splitter = StratifiedKFold(
        n_splits=N_SPLITS,
        shuffle=True,
        random_state=RANDOM_STATE
    )

    tier2["split"] = ""

    for fold_index, (_, test_indices) in enumerate(
        splitter.split(tier2, tier2["class"])
    ):
        if fold_index < TRAIN_FOLDS:
            split_name = "train"
        elif fold_index < TRAIN_FOLDS + VALIDATION_FOLDS:
            split_name = "validation"
        else:
            split_name = "test"

        tier2.loc[test_indices, "split"] = split_name

    tier1["split"] = "train"

    train = pd.concat(
        [
            tier1,
            tier2[tier2["split"] == "train"]
        ],
        ignore_index=True
    )

    validation = tier2[tier2["split"] == "validation"].copy()
    test = tier2[tier2["split"] == "test"].copy()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    train.to_csv(OUTPUT_DIR / "train.csv", index=False)
    validation.to_csv(OUTPUT_DIR / "validation.csv", index=False)
    test.to_csv(OUTPUT_DIR / "test.csv", index=False)

    combined = pd.concat(
        [train, validation, test],
        ignore_index=True
    )

    combined.to_csv(
        OUTPUT_DIR / "dataset_splits.csv",
        index=False
    )

    with open(OUTPUT_DIR / "label_mapping.json", "w") as file:
        json.dump(
            {
                "label_mapping": LABEL_MAPPING,
                "class_to_idx": CLASS_TO_IDX
            },
            file,
            indent=4
        )

    config = {
        "sample_rate": TARGET_SAMPLE_RATE,
        "duration_seconds": TARGET_DURATION,
        "target_samples": TARGET_SAMPLES,
        "channels": 1,
        "audio_format": "raw_waveform",
        "padding": "right_zero_padding",
        "truncation": "first_7_seconds",
        "normalization": "none",
        "tier_1": "all_training",
        "tier_2_split": {
            "train": 0.70,
            "validation": 0.15,
            "test": 0.15
        },
        "stratification": "original_class",
        "random_state": RANDOM_STATE,
        "n_splits": N_SPLITS,
        "train_folds": TRAIN_FOLDS,
        "validation_folds": VALIDATION_FOLDS,
        "test_folds": TEST_FOLDS
    }

    with open(
        OUTPUT_DIR / "preprocessing_config.json",
        "w"
    ) as file:
        json.dump(config, file, indent=4)

    print("\nDATASET SPLIT SUMMARY")
    print("-" * 50)

    for name, dataframe in [
        ("Train", train),
        ("Validation", validation),
        ("Test", test)
    ]:
        print(f"\n{name}: {len(dataframe)} samples")
        print(dataframe["class_name"].value_counts().sort_index())

    print("\nTier distribution:")
    print(combined.groupby(["split", "tier"]).size())

    print("\nSaved split files to:", OUTPUT_DIR)

    return train, validation, test


class InfantCryWaveformDataset(Dataset):

    def __init__(self, csv_path):
        self.metadata = pd.read_csv(csv_path)

        required_columns = {
            "audio_path",
            "label_id",
            "class_name"
        }

        missing_columns = required_columns - set(self.metadata.columns)

        if missing_columns:
            raise ValueError(
                f"Missing dataset columns: {missing_columns}"
            )

    def __len__(self):
        return len(self.metadata)

    def __getitem__(self, index):
        row = self.metadata.iloc[index]

        waveform = load_waveform(row["audio_path"])

        waveform = torch.from_numpy(waveform).unsqueeze(0)

        label = torch.tensor(
            int(row["label_id"]),
            dtype=torch.long
        )

        return {
            "waveform": waveform,
            "label": label,
            "audio_path": row["audio_path"],
            "class_name": row["class_name"]
        }


def waveform_collate_fn(batch):
    waveforms = torch.stack(
        [item["waveform"] for item in batch]
    )

    labels = torch.stack(
        [item["label"] for item in batch]
    )

    audio_paths = [
        item["audio_path"] for item in batch
    ]

    class_names = [
        item["class_name"] for item in batch
    ]

    return {
        "waveforms": waveforms,
        "labels": labels,
        "audio_paths": audio_paths,
        "class_names": class_names
    }


def create_dataloaders():
    train_dataset = InfantCryWaveformDataset(
        OUTPUT_DIR / "train.csv"
    )

    validation_dataset = InfantCryWaveformDataset(
        OUTPUT_DIR / "validation.csv"
    )

    test_dataset = InfantCryWaveformDataset(
        OUTPUT_DIR / "test.csv"
    )

    train_loader = DataLoader(
        train_dataset,
        batch_size=BATCH_SIZE,
        shuffle=True,
        num_workers=NUM_WORKERS,
        collate_fn=waveform_collate_fn,
        pin_memory=DEVICE.type == "cuda"
    )

    validation_loader = DataLoader(
        validation_dataset,
        batch_size=BATCH_SIZE,
        shuffle=False,
        num_workers=NUM_WORKERS,
        collate_fn=waveform_collate_fn,
        pin_memory=DEVICE.type == "cuda"
    )

    test_loader = DataLoader(
        test_dataset,
        batch_size=BATCH_SIZE,
        shuffle=False,
        num_workers=NUM_WORKERS,
        collate_fn=waveform_collate_fn,
        pin_memory=DEVICE.type == "cuda"
    )

    return train_loader, validation_loader, test_loader


def main():
    print("INFANTCRY WAVEFORM PREPROCESSING")
    print("=" * 50)

    train, validation, test = create_splits()

    train_loader, validation_loader, test_loader = create_dataloaders()

    batch = next(iter(train_loader))

    waveforms = batch["waveforms"]
    labels = batch["labels"]

    print("\nSMOKE TEST")
    print("-" * 50)
    print("Device:", DEVICE)
    print("Waveform batch shape:", waveforms.shape)
    print("Label batch shape:", labels.shape)
    print("Waveform dtype:", waveforms.dtype)
    print("Label dtype:", labels.dtype)
    print("All values finite:", torch.isfinite(waveforms).all().item())
    print("Minimum waveform value:", waveforms.min().item())
    print("Maximum waveform value:", waveforms.max().item())

    assert waveforms.shape[1:] == (1, TARGET_SAMPLES)
    assert waveforms.dtype == torch.float32
    assert labels.dtype == torch.long
    assert torch.isfinite(waveforms).all()
    assert labels.min() >= 0
    assert labels.max() < len(CLASS_TO_IDX)

    print("\nDATALOADER SUMMARY")
    print("-" * 50)
    print("Training batches:", len(train_loader))
    print("Validation batches:", len(validation_loader))
    print("Test batches:", len(test_loader))

    print("\nPREPROCESSING COMPLETED SUCCESSFULLY")


if __name__ == "__main__":
    main()
