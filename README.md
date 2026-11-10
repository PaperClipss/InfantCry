# InfantCry

**InfantCry** is a deep learning-based infant cry classification system that uses audio signal processing and a Convolutional Recurrent Neural Network (CRNN) to identify patterns in infant crying sounds.

The project combines a trained audio classification model, a FastAPI backend, a web frontend, and a mobile application to provide an accessible interface for infant cry analysis.

## Overview

Infants primarily communicate their needs through crying. Understanding the possible reason behind a cry can be challenging for parents and caregivers.

InfantCry explores the application of deep learning to this problem by analyzing acoustic features extracted from infant cry recordings and classifying them using a trained CRNN model.

The system processes audio recordings, converts them into log-Mel spectrograms, and passes these features through the trained model to generate predictions.

## Features

- **Audio Classification:** Classifies infant cry recordings using a trained deep learning model.
- **Audio Signal Processing:** Extracts log-Mel spectrogram features from raw audio.
- **CRNN Architecture:** Combines CNN-based feature extraction with recurrent temporal learning.
- **REST API:** Uses FastAPI to expose model inference functionality.
- **Web Interface:** Provides a frontend for interacting with the classification system.
- **Mobile Application:** Includes a separate mobile application for accessing the project.

## System Architecture

The project consists of four main components:

| Component | Description |
|---|---|
| Model | Trained CRNN model for infant cry classification |
| Backend | FastAPI application responsible for preprocessing and inference |
| Frontend | Web interface for interacting with the model |
| Mobile App | Mobile application interface |

### Audio Processing Pipeline

The classification pipeline follows these steps:

1. **Audio Input:** Receives an infant cry recording.
2. **Resampling:** Standardizes the audio sampling rate to 16 kHz.
3. **Feature Extraction:** Uses Short-Time Fourier Transform (STFT) and Mel filter banks.
4. **Log-Mel Transformation:** Converts the extracted features into log-Mel spectrograms.
5. **Model Inference:** Passes the processed spectrogram through the trained CRNN.
6. **Prediction:** Returns the model's predicted class to the application.

## Model Architecture

InfantCry uses a Convolutional Recurrent Neural Network (CRNN), combining two neural network architectures:

- **Convolutional Neural Network (CNN):** Extracts spatial and spectral patterns from log-Mel spectrograms.
- **Recurrent Neural Network (RNN):** Learns temporal dependencies in the extracted audio features.

This combination allows the model to learn both acoustic characteristics and their temporal variations.

## Technology Stack

| Category | Technologies |
|---|---|
| Language | Python |
| Deep Learning | PyTorch |
| Audio Processing | Librosa, NumPy |
| Backend | FastAPI |
| Frontend | HTML, CSS, JavaScript |
| Mobile | See `infantCry-mobile-app/` |

## Repository Structure

```text
InfantCry/
│
├── backend/                 # FastAPI backend
│
├── frontend/                # Web application
│
├── infantCry-mobile-app/    # Mobile application
│
├── model/                   # Model-related files
│
├── processed/               # Processed audio data
│
├── .gitignore
│
└── README.md
```

## Getting Started

### Prerequisites

- Python 3.10 or later
- Git
- pip

### Clone the Repository

```bash
git clone https://github.com/PaperClipss/InfantCry.git

cd InfantCry
```

### Backend Setup

Navigate to the backend directory:

```bash
cd backend
```

Create a virtual environment:

```bash
python -m venv venv
```

Activate it:

**macOS / Linux**
```bash
source venv/bin/activate
```

**Windows**
```bash
venv\Scripts\activate
```

Install the dependencies using the backend requirements file, if provided:

```bash
pip install -r requirements.txt
```

Start the FastAPI application using its configured entry point.

### Frontend Setup

Navigate to the `frontend/` directory and serve the frontend using a local development server.

Ensure that the frontend API configuration points to the correct backend URL.

### Mobile Application

The mobile application is maintained separately in:

```text
infantCry-mobile-app/
```

Refer to its project configuration for the required dependencies and startup instructions.

## Deployment

InfantCry uses a separated frontend and backend deployment architecture.

- The frontend can be hosted independently using a static hosting platform such as Vercel.
- The FastAPI backend runs separately on a Python-compatible hosting platform.
- The frontend communicates with the backend through HTTP API requests.

The deployed backend URL must be configured in the frontend application for production use.

## Limitations

- Prediction quality depends on audio quality and recording conditions.
- Background noise and other overlapping sounds can affect classification.
- Model generalization depends on the diversity of the training dataset.
- Predictions represent model estimates and should not be treated as definitive explanations of infant behavior.

## Disclaimer

InfantCry is an experimental machine learning project developed for educational and research purposes.

It is not a medical device and is not intended to diagnose medical conditions or replace professional medical advice.

Always consult a qualified healthcare professional if an infant shows signs of illness or persistent distress.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
