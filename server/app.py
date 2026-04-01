from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Music-To-Sheet API")


class ProcessRequest(BaseModel):
    audio_url: str
    instrument: str
    output_format: str


@app.get("/")
def root():
    return {"status": "Music-To-Sheet API is running"}


@app.post("/process")
def process_audio(body: ProcessRequest):
    # TODO: Replace mock response with real audio processing pipeline
    return {
        "status": "success",
        "track_name": "Sample Track",
        "instrument": "Piano",
        "format": "Score",
        "duration_seconds": 30,
        "notes": [
            {"pitch": "C4", "start": 0,   "duration": 0.5},
            {"pitch": "E4", "start": 0.5, "duration": 0.5},
            {"pitch": "G4", "start": 1.0, "duration": 0.5},
        ],
        "confidence": 0.82,
    }
