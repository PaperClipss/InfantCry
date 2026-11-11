
import gc
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

DATASET_ROOT = Path(
    "/kaggle/input/datasets/bnskartheek/infantcry-dbl/Datasets/Datasets"
)

METADATA_PATH = DATASET_ROOT / "metadata.csv"

OUTPUT_DIR = PROJECT_ROOT / "processed" / "waveform_transformer"
CACHE_DIR = PROJECT_ROOT / "processed" / "waveform_cache"

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

DEVICE = torch.device(
    "cuda" if torch.cuda.is_available()
    else "mps" if torch.backends.mps.is_available()
    else "cpu"
)


def normalize_folder_name(name):
    return " ".join(str(name).strip().lower().split())


def resolve_audio_path(relative_path):
    parts = Path(str(relative_path).replace("\\", "/")).parts

    aliases = {
        "1214 collcted data": "1214 collected data",
        "dunstan 337": "dunstan 337"
    }

    current_path = DATASET_ROOT

    for part in parts:
        normalized_part = normalize_folder_name(part)
        normalized_part = aliases.get(normalized_part, normalized_part)

        if not current_path.exists() or not current_path.is_dir():
            return None

        matching_path = None

        for child in current_path.iterdir():
            if normalize_folder_name(child.name) == normalized_part:
                matching_path = child
                break

        if matching_path is None:
            return None

        current_path = matching_path

    return current_path if current_path.is_file() else None


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

        waveform = resample_poly(
            waveform,
            TARGET_SAMPLE_RATE // divisor,
            sample_rate // divisor
        ).astype(np.float32)

    if len(waveform) > TARGET_SAMPLES:
        waveform = waveform[:TARGET_SAMPLES]

    elif len(waveform) < TARGET_SAMPLES:
        waveform = np.pad(
            waveform,
            (0, TARGET_SAMPLES - len(waveform)),
            mode="constant"
        )

    return waveform.astype(np.float32)


def create_splits():
    if not METADATA_PATH.exists():
        raise FileNotFoundError(f"Metadata not found: {METADATA_PATH}")

    metadata = pd.read_csv(METADATA_PATH)

    required_columns = {
        "relative_path",
        "tier",
        "class",
        "tier_name"
    }

    missing_columns = required_columns - set(metadata.columns)

    if missing_columns:
        raise ValueError(f"Missing columns: {missing_columns}")

    if metadata["relative_path"].isna().any():
        raise ValueError("Missing relative paths in metadata.")

    if metadata["relative_path"].duplicated().any():
        raise ValueError("Duplicate relative paths in metadata.")

    metadata["class"] = metadata["class"].astype(str).str.strip().str.lower()

    unknown_labels = set(metadata["class"].unique()) - set(LABEL_MAPPING)

    if unknown_labels:
        raise ValueError(f"Unknown classes: {unknown_labels}")

    metadata["class_name"] = metadata["class"].map(LABEL_MAPPING)
    metadata["label_id"] = metadata["class_name"].map(CLASS_TO_IDX)

    metadata["tier"] = (
        metadata["tier"]
        .astype(str)
        .str.extract(r"([12])")[0]
        .astype(int)
    )

    if set(metadata["tier"].unique()) != {1, 2}:
        raise ValueError("Expected Tier 1 and Tier 2 samples.")

    print("Resolving audio paths...")

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
    tier2 = metadata[metadata["tier"] == 2].copy().reset_index(drop=True)

    splitter = StratifiedKFold(
        n_splits=N_SPLITS,
        shuffle=True,
        random_state=RANDOM_STATE
    )

    tier2["split"] = ""

    for fold_index, (_, indices) in enumerate(
        splitter.split(tier2, tier2["class"])
    ):
        if fold_index < TRAIN_FOLDS:
            split_name = "train"
        elif fold_index < TRAIN_FOLDS + VALIDATION_FOLDS:
            split_name = "validation"
        else:
            split_name = "test"

        tier2.loc[indices, "split"] = split_name

    tier1["split"] = "train"

    train = pd.concat(
        [tier1, tier2[tier2["split"] == "train"]],
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

    combined.to_csv(OUTPUT_DIR / "dataset_splits.csv", index=False)

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
        "format": "raw_waveform",
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
        "random_state": RANDOM_STATE
    }

    with open(OUTPUT_DIR / "preprocessing_config.json", "w") as file:
        json.dump(config, file, indent=4)

    print("\nDATASET SPLITS")
    print("-" * 50)

    for name, dataframe in [
        ("Train", train),
        ("Validation", validation),
        ("Test", test)
    ]:
        print(f"\n{name}: {len(dataframe)} samples")
        print(dataframe["class_name"].value_counts().sort_index())

    print("\nSplits saved to:", OUTPUT_DIR)

    return train, validation, test


def build_binary_cache():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    split_files = {
        "train": OUTPUT_DIR / "train.csv",
        "validation": OUTPUT_DIR / "validation.csv",
        "test": OUTPUT_DIR / "test.csv"
    }

    cache_counts = {}

    for split_name, csv_path in split_files.items():
        metadata = pd.read_csv(csv_path)

        split_dir = CACHE_DIR / split_name
        split_dir.mkdir(parents=True, exist_ok=True)

        waveform_path = split_dir / "waveforms.dat"
        labels_path = split_dir / "labels.dat"

        count = len(metadata)
        cache_counts[split_name] = count

        if count == 0:
            raise ValueError(f"{split_name} split is empty.")

        waveforms = np.memmap(
            waveform_path,
            dtype=np.float32,
            mode="w+",
            shape=(count, TARGET_SAMPLES)
        )

        labels = np.memmap(
            labels_path,
            dtype=np.int64,
            mode="w+",
            shape=(count,)
        )

        print(f"\nBUILDING {split_name.upper()} CACHE")
        print("-" * 50)

        for index, row in metadata.iterrows():
            waveform = load_waveform(row["audio_path"])

            waveforms[index] = waveform
            labels[index] = int(row["label_id"])

            if (index + 1) % 100 == 0 or index + 1 == count:
                print(
                    f"{index + 1}/{count} recordings processed",
                    flush=True
                )

        waveforms.flush()
        labels.flush()

        del waveforms
        del labels

        gc.collect()

        print(f"Saved {split_name} binary files.")

    cache_config = {
        "sample_rate": TARGET_SAMPLE_RATE,
        "duration_seconds": TARGET_DURATION,
        "target_samples": TARGET_SAMPLES,
        "dtype": "float32",
        "label_dtype": "int64",
        "channels": 1,
        "format": "raw_binary_memmap",
        "normalization": "none",
        "class_to_idx": CLASS_TO_IDX,
        "sample_counts": cache_counts
    }

    with open(CACHE_DIR / "cache_config.json", "w") as file:
        json.dump(cache_config, file, indent=4)

    print("\nBINARY CACHE COMPLETED")
    print("Cache directory:", CACHE_DIR)


class InfantCryWaveformDataset(Dataset):

    def __init__(self, split_name):
        self.split_dir = CACHE_DIR / split_name

        config_path = CACHE_DIR / "cache_config.json"

        if not config_path.exists():
            raise FileNotFoundError("Cache configuration not found.")

        with open(config_path, "r") as file:
            config = json.load(file)

        self.count = config["sample_counts"][split_name]
        self.target_samples = config["target_samples"]

        waveform_path = self.split_dir / "waveforms.dat"
        labels_path = self.split_dir / "labels.dat"

        if not waveform_path.exists() or not labels_path.exists():
            raise FileNotFoundError(
                f"Binary cache missing for {split_name}."
            )

        expected_waveform_size = (
            self.count * self.target_samples * np.dtype(np.float32).itemsize
        )

        expected_label_size = (
            self.count * np.dtype(np.int64).itemsize
        )

        if waveform_path.stat().st_size != expected_waveform_size:
            raise ValueError("Waveform binary file has an incorrect size.")

        if labels_path.stat().st_size != expected_label_size:
            raise ValueError("Label binary file has an incorrect size.")

        self.waveforms = np.memmap(
            waveform_path,
            dtype=np.float32,
            mode="r",
            shape=(self.count, self.target_samples)
        )

        self.labels = np.memmap(
            labels_path,
            dtype=np.int64,
            mode="r",
            shape=(self.count,)
        )

    def __len__(self):
        return self.count

    def __getitem__(self, index):
        waveform = np.array(
            self.waveforms[index],
            dtype=np.float32,
            copy=True
        )

        waveform = torch.from_numpy(waveform).unsqueeze(0)

        label = torch.tensor(
            int(self.labels[index]),
            dtype=torch.long
        )

        return {
            "waveform": waveform,
            "label": label
        }


def waveform_collate_fn(batch):
    waveforms = torch.stack(
        [item["waveform"] for item in batch]
    )

    labels = torch.stack(
        [item["label"] for item in batch]
    )

    return {
        "waveforms": waveforms,
        "labels": labels
    }


def create_dataloaders():
    train_dataset = InfantCryWaveformDataset("train")
    validation_dataset = InfantCryWaveformDataset("validation")
    test_dataset = InfantCryWaveformDataset("test")

    pin_memory = DEVICE.type == "cuda"

    train_loader = DataLoader(
        train_dataset,
        batch_size=BATCH_SIZE,
        shuffle=True,
        num_workers=NUM_WORKERS,
        collate_fn=waveform_collate_fn,
        pin_memory=pin_memory
    )

    validation_loader = DataLoader(
        validation_dataset,
        batch_size=BATCH_SIZE,
        shuffle=False,
        num_workers=NUM_WORKERS,
        collate_fn=waveform_collate_fn,
        pin_memory=pin_memory
    )

    test_loader = DataLoader(
        test_dataset,
        batch_size=BATCH_SIZE,
        shuffle=False,
        num_workers=NUM_WORKERS,
        collate_fn=waveform_collate_fn,
        pin_memory=pin_memory
    )

    return train_loader, validation_loader, test_loader


def main():
    print("INFANTCRY BINARY WAVEFORM PREPROCESSING")
    print("=" * 60)

    create_splits()
    build_binary_cache()

    train_loader, validation_loader, test_loader = create_dataloaders()

    batch = next(iter(train_loader))

    print("\nCACHE SMOKE TEST")
    print("-" * 50)
    print("Device:", DEVICE)
    print("Waveform shape:", batch["waveforms"].shape)
    print("Label shape:", batch["labels"].shape)
    print("Waveform dtype:", batch["waveforms"].dtype)
    print("Labels dtype:", batch["labels"].dtype)
    print("Finite values:", torch.isfinite(batch["waveforms"]).all().item())

    assert batch["waveforms"].shape[1:] == (1, TARGET_SAMPLES)
    assert batch["waveforms"].dtype == torch.float32
    assert batch["labels"].dtype == torch.long

    print("\nTraining batches:", len(train_loader))
    print("Validation batches:", len(validation_loader))
    print("Test batches:", len(test_loader))

    print("\nPREPROCESSING COMPLETED SUCCESSFULLY")


if __name__ == "__main__":
    main()
