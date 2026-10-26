import argparse
import json
import re
from pathlib import Path

import librosa
import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold

SR, N_FFT, HOP, N_MELS = 16000, 1024, 256, 80
FMIN, FMAX, DURATION = 20, 8000, 7
MAX_SAMPLES = SR * DURATION
MAX_FRAMES = 1 + MAX_SAMPLES // HOP
SEED = 42

REASONS = {
    "neh": "hunger",
    "owh": "sleepiness",
    "eh": "burping",
    "eairh": "gas_lower_wind_pain",
    "heh": "physical_discomfort",
}
CLASS_NAMES = [
    "hunger", "sleepiness", "burping",
    "gas_lower_wind_pain", "physical_discomfort",
]
CLASS_TO_IDX = {name: i for i, name in enumerate(CLASS_NAMES)}
REQUIRED = {"relative_path", "filename", "tier", "class", "clip_id", "gender"}


def find_root(folder):
    folder = folder.expanduser().resolve()
    if not folder.exists():
        raise FileNotFoundError(folder)
    matches = []
    for p in folder.rglob("metadata.csv"):
        try:
            columns = set(pd.read_csv(p, nrows=0).columns)
        except Exception:
            continue
        if REQUIRED.issubset(columns):
            matches.append(p.parent)
    if (folder / "metadata.csv").exists() and folder not in matches:
        try:
            if REQUIRED.issubset(set(pd.read_csv(folder / "metadata.csv", nrows=0).columns)):
                matches.append(folder)
        except Exception:
            pass
    matches = list(dict.fromkeys(matches))
    if len(matches) != 1:
        raise ValueError(f"Expected one dataset root with metadata.csv; found: {matches}")
    return matches[0]


def make_group_id(row):
    if int(row["tier"]) == 1:
        return f"tier1:{row['filename']}"
    stem = Path(str(row["filename"])).stem
    match = re.match(r"^([^_]+)_([MF])_", stem, flags=re.I)
    return f"tier2:{match[1]}:{match[2].upper()}" if match else f"tier2:clip:{stem}"


def split_tier2(df):
    if df["group_id"].nunique() < 7:
        raise ValueError("Not enough Tier-2 groups to split.")
    outer = StratifiedGroupKFold(n_splits=7, shuffle=True, random_state=SEED)
    trainval_idx, test_idx = next(outer.split(df, df["class"], df["group_id"]))
    trainval = df.iloc[trainval_idx]
    test = df.iloc[test_idx]
    inner = StratifiedGroupKFold(n_splits=6, shuffle=True, random_state=SEED + 1)
    train_idx, val_idx = next(inner.split(trainval, trainval["class"], trainval["group_id"]))
    train, val = trainval.iloc[train_idx], trainval.iloc[val_idx]
    for a, b in ((train, val), (train, test), (val, test)):
        if set(a["group_id"]) & set(b["group_id"]):
            raise ValueError("Group leakage between splits.")
    result = pd.Series(index=df.index, dtype="object")
    result.loc[train.index] = "train"
    result.loc[val.index] = "val"
    result.loc[test.index] = "test"
    return result


def logmel(path):
    audio, _ = librosa.load(path, sr=SR, mono=True, dtype=np.float32)
    if audio.size == 0 or not np.isfinite(audio).all():
        raise ValueError(f"Invalid audio: {path}")
    audio = audio[:MAX_SAMPLES]
    power = librosa.feature.melspectrogram(
        y=audio, sr=SR, n_fft=N_FFT, hop_length=HOP,
        n_mels=N_MELS, fmin=FMIN, fmax=FMAX, power=2.0,
    )
    spec = librosa.power_to_db(power, ref=np.max, top_db=80.0)
    spec = np.pad(
        spec[:, :MAX_FRAMES],
        ((0, 0), (0, max(0, MAX_FRAMES - spec.shape[1]))),
        constant_values=-80.0,
    ).astype(np.float32)
    if spec.shape != (N_MELS, MAX_FRAMES) or not np.isfinite(spec).all():
        raise ValueError(f"Invalid spectrogram: {path}")
    return spec


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-root", type=Path, default=Path("Datasets"))
    parser.add_argument("--output-dir", type=Path, default=Path("processed"))
    parser.add_argument(
        "--reuse-existing-split", action="store_true",
        help="Reuse splits from output-dir/processed_metadata.csv when present, matched by filename + source_class."
    )
    args = parser.parse_args()

    root = find_root(args.dataset_root)
    output = args.output_dir.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)

    release = pd.read_csv(root / "metadata.csv")
    if not REQUIRED.issubset(release.columns):
        raise ValueError(f"Missing release metadata columns: {REQUIRED - set(release.columns)}")
    release["source_class"] = release["class"].astype(str).str.strip().str.lower()
    if not set(release["source_class"]).issubset(REASONS):
        raise ValueError(f"Unknown source classes: {set(release['source_class']) - set(REASONS)}")

    # Resolve files using authoritative source class folder + filename.
    audio_index = {}
    for path in root.rglob("*.wav"):
        key = (path.name.casefold(), path.parent.name.casefold())
        if key in audio_index:
            raise ValueError(f"Duplicate audio key: {key}")
        audio_index[key] = path.resolve()

    paths = []
    for row in release.itertuples(index=False):
        key = (str(row.filename).casefold(), str(row.source_class).casefold())
        if key not in audio_index:
            raise FileNotFoundError(f"Missing audio for key={key}")
        paths.append(str(audio_index[key]))

    df = release.copy()
    df["audio_path"] = paths
    df["class"] = df["source_class"].map(REASONS)
    df["label"] = df["class"].map(CLASS_TO_IDX).astype(np.int64)
    df["group_id"] = df.apply(make_group_id, axis=1)

    existing_path = output / "processed_metadata.csv"
    if args.reuse_existing_split and existing_path.exists():
        old = pd.read_csv(existing_path)
        required_old = {"filename", "source_class", "split"}
        if not required_old.issubset(old.columns):
            raise ValueError(
                f"Cannot reuse split: existing metadata lacks {required_old - set(old.columns)}"
            )
        old_key = old["filename"].astype(str).str.casefold() + "||" + old["source_class"].astype(str).str.casefold()
        if old_key.duplicated().any():
            raise ValueError("Existing metadata has duplicate filename/source_class keys.")
        split_map = dict(zip(old_key, old["split"]))
        new_key = df["filename"].astype(str).str.casefold() + "||" + df["source_class"].astype(str).str.casefold()
        missing = [key for key in new_key if key not in split_map]
        if missing:
            raise ValueError(f"{len(missing)} release samples not found in old metadata; refusing to invent split.")
        df["split"] = [split_map[key] for key in new_key]
        print("Reused existing split assignments from", existing_path)
    else:
        df["split"] = None
        tier1 = df["tier"].astype(int) == 1
        tier2 = df["tier"].astype(int) == 2
        df.loc[tier1, "split"] = "train"
        tier2_df = df.loc[tier2].copy()
        df.loc[tier2_df.index, "split"] = split_tier2(tier2_df)
        print("Created a new grouped split. This will NOT necessarily match a prior run.")

    if df["split"].isna().any() or not set(df["split"].unique()).issubset({"train", "val", "test"}):
        raise ValueError("Invalid or unassigned split values.")

    df = df.reset_index(drop=True)
    df["feature_idx"] = np.arange(len(df), dtype=np.int64)
    shape = (len(df), N_MELS, MAX_FRAMES)
    feature_path = output / "logmel_features.dat"
    features = np.memmap(feature_path, dtype=np.float32, mode="w+", shape=shape)
    try:
        for i, path in enumerate(df["audio_path"]):
            features[i] = logmel(Path(path))
            if (i + 1) % 100 == 0 or i + 1 == len(df):
                print(f"Processed {i + 1}/{len(df)}")
        features.flush()
    except Exception:
        del features
        feature_path.unlink(missing_ok=True)
        raise
    del features

    # Keep source_class for traceability; class is the semantic target.
    df.to_csv(output / "processed_metadata_semantic.csv", index=False)
    (output / "class_to_idx_semantic.json").write_text(json.dumps(CLASS_TO_IDX, indent=2))
    (df.groupby(["split", "class"]).size().rename("count").reset_index()
       .to_csv(output / "split_summary_semantic.csv", index=False))

    config = {
        "dataset": "InfantCry-DBL",
        "sample_rate": SR,
        "n_fft": N_FFT,
        "hop_length": HOP,
        "n_mels": N_MELS,
        "fmin": FMIN,
        "fmax": FMAX,
        "max_duration_seconds": DURATION,
        "max_frames": MAX_FRAMES,
        "feature_shape": list(shape),
        "dtype": "float32",
        "class_to_idx": CLASS_TO_IDX,
        "source_to_target": REASONS,
        "split_policy": (
            "Reused existing split from processed_metadata.csv by filename+source_class"
            if args.reuse_existing_split and existing_path.exists()
            else "Tier 1 train; Tier 2 grouped approximate stratified split"
        ),
        "padding_db": -80.0,
        "metadata_relative_path_note": "Audio resolved by source class folder and filename",
    }
    (output / "preprocessing_config_semantic.json").write_text(json.dumps(config, indent=2))

    print("\nClass distribution by split:")
    print(pd.crosstab(df["split"], df["class"]).reindex(
        index=["train", "val", "test"], columns=CLASS_NAMES, fill_value=0
    ))
    print("\nFeature shape:", shape)
    print("Feature file bytes:", feature_path.stat().st_size)
    print("Metadata:", output / "processed_metadata_semantic.csv")
    print("Config:", output / "preprocessing_config_semantic.json")
    print("Done.")


if __name__ == "__main__":
    main()
