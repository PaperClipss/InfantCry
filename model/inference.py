import json
from pathlib import Path

import librosa
import numpy as np
import torch

from model import CRNN

SR, N_FFT, HOP, N_MELS = 16000, 1024, 256, 80
FMIN, FMAX, DURATION = 20, 8000, 7
MAX_SAMPLES = SR * DURATION
MAX_FRAMES = 1 + MAX_SAMPLES // HOP

CLASS_NAMES = [
    "hunger",
    "sleepiness",
    "burping",
    "gas_lower_wind_pain",
    "physical_discomfort",
]


def audio_to_logmel(audio_path):
    audio, _ = librosa.load(str(audio_path), sr=SR, mono=True, dtype=np.float32)
    audio = audio[:MAX_SAMPLES]

    power = librosa.feature.melspectrogram(
        y=audio,
        sr=SR,
        n_fft=N_FFT,
        hop_length=HOP,
        n_mels=N_MELS,
        fmin=FMIN,
        fmax=FMAX,
        power=2.0,
    )
    spec = librosa.power_to_db(power, ref=np.max, top_db=80.0)
    spec = np.pad(
        spec[:, :MAX_FRAMES],
        ((0, 0), (0, max(0, MAX_FRAMES - spec.shape[1]))),
        constant_values=-80.0,
    ).astype(np.float32)

    return torch.from_numpy(spec).unsqueeze(0).unsqueeze(0)


class CryInference:

    def __init__(
        self,
        checkpoint_path="InfantCry/model/crnn_semantic_weighted_no_aug_best.pth",
        config_path="InfantCry/model/preprocessing_config_semantic.json",
        device=None,
    ):
        self.device = torch.device(
            device if device else (
                "cuda" if torch.cuda.is_available()
                else "mps" if torch.backends.mps.is_available()
                else "cpu"
            )
        )

        with open(config_path, encoding="utf-8") as f:
            config = json.load(f)

        checkpoint = torch.load(
            checkpoint_path, map_location=self.device, weights_only=True
        )

        self.model = CRNN(num_classes=len(CLASS_NAMES)).to(self.device)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.eval()

    def predict_cry(self, audio_path, top_k=5):
        x = audio_to_logmel(audio_path).to(self.device)

        with torch.inference_mode():
            logits = self.model(x)
            probabilities = torch.softmax(logits, dim=1)[0].cpu().numpy()

        order = np.argsort(probabilities)[::-1][:top_k]
        top_predictions = [
            {
                "label": CLASS_NAMES[int(i)],
                "confidence": float(probabilities[i]),
            }
            for i in order
        ]

        return {
            "predicted_class": top_predictions[0]["label"],
            "confidence": top_predictions[0]["confidence"],
            
        }


def load_inference_model(checkpoint_path="model/crnn_semantic_weighted_no_aug_best.pth",config_path="processed/preprocessing_config_semantic.json",device=None,):
    return CryInference(checkpoint_path, config_path, device)


def predict_cry(audio_path, inference, top_k=5):
    return inference.predict_cry(audio_path, top_k=top_k)


crymodel = load_inference_model()
result = predict_cry("model/baby-crying-01.wav", inference=crymodel)
print(result)
"""
Usage:
cry_model = load_inference_model()

result = predict_cry(temp_audio_path, inference=cry_model)
"""