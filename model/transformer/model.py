
import torch
import torch.nn as nn


class ConvFeatureExtractor(nn.Module):

    def __init__(self, embedding_dim=256):
        super().__init__()

        self.network = nn.Sequential(
            nn.Conv1d(1, 64, kernel_size=10, stride=5, padding=3),
            nn.BatchNorm1d(64),
            nn.GELU(),

            nn.Conv1d(64, 128, kernel_size=8, stride=4, padding=2),
            nn.BatchNorm1d(128),
            nn.GELU(),

            nn.Conv1d(128, 192, kernel_size=8, stride=4, padding=2),
            nn.BatchNorm1d(192),
            nn.GELU(),

            nn.Conv1d(192, embedding_dim, kernel_size=8, stride=4, padding=2),
            nn.BatchNorm1d(embedding_dim),
            nn.GELU()
        )

    def forward(self, x):
        x = self.network(x)
        return x.transpose(1, 2)


class AttentionPooling(nn.Module):

    def __init__(self, embedding_dim):
        super().__init__()

        self.attention = nn.Sequential(
            nn.Linear(embedding_dim, embedding_dim // 2),
            nn.Tanh(),
            nn.Linear(embedding_dim // 2, 1)
        )

    def forward(self, x):
        scores = self.attention(x)
        weights = torch.softmax(scores, dim=1)
        pooled = torch.sum(x * weights, dim=1)

        return pooled


class InfantCryTransformer(nn.Module):

    def __init__(
        self,
        num_classes=5,
        embedding_dim=256,
        num_layers=4,
        num_heads=8,
        feedforward_dim=1024,
        dropout=0.1,
        max_tokens=350
    ):
        super().__init__()

        self.feature_extractor = ConvFeatureExtractor(
            embedding_dim=embedding_dim
        )

        self.position_embedding = nn.Parameter(
            torch.randn(1, max_tokens, embedding_dim) * 0.02
        )

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=embedding_dim,
            nhead=num_heads,
            dim_feedforward=feedforward_dim,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True
        )

        self.transformer = nn.TransformerEncoder(
            encoder_layer,
            num_layers=num_layers,
            norm=nn.LayerNorm(embedding_dim)
        )

        self.pooling = AttentionPooling(embedding_dim)

        self.classifier = nn.Sequential(
            nn.LayerNorm(embedding_dim),
            nn.Dropout(dropout),
            nn.Linear(embedding_dim, 128),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(128, num_classes)
        )

    def forward(self, waveform):
        x = self.feature_extractor(waveform)

        if x.size(1) > self.position_embedding.size(1):
            raise ValueError(
                f"Input produced {x.size(1)} tokens, "
                f"but maximum supported tokens are "
                f"{self.position_embedding.size(1)}"
            )

        x = x + self.position_embedding[:, :x.size(1), :]

        x = self.transformer(x)

        x = self.pooling(x)

        logits = self.classifier(x)

        return logits


if __name__ == "__main__":
    device = (
        torch.device("cuda")
        if torch.cuda.is_available()
        else torch.device("mps")
        if torch.backends.mps.is_available()
        else torch.device("cpu")
    )

    model = InfantCryTransformer().to(device)

    dummy_input = torch.randn(16, 1, 112000).to(device)

    with torch.no_grad():
        output = model(dummy_input)

    parameters = sum(
        parameter.numel()
        for parameter in model.parameters()
        if parameter.requires_grad
    )

    print("Device:", device)
    print("Input shape:", dummy_input.shape)
    print("Output shape:", output.shape)
    print("Trainable parameters:", f"{parameters:,}")
    print("Model size:", f"{parameters * 4 / (1024 ** 2):.2f} MB")
