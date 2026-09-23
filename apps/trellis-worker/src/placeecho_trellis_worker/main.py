from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .runtime import (
    GenerateRequest,
    GenerationError,
    RuntimeUnavailableError,
    TrellisGenerationService,
    WorkerBusyError,
)


app = FastAPI(title="PlaceEcho TRELLIS Worker", version="0.1.0")
service = TrellisGenerationService.from_environment()


class GenerateBody(BaseModel):
    input_key: str = Field(min_length=1)
    output_glb_key: str = Field(min_length=1)
    output_ply_key: str | None = None
    seed: int = Field(default=1, ge=0, le=2_147_483_647)
    simplify: float = Field(default=0.95, ge=0, lt=1)
    texture_size: int = Field(default=1024)


class GenerateResponse(BaseModel):
    provider: str
    status: str
    input_key: str
    output_glb_key: str
    output_ply_key: str | None
    seed: int
    elapsed_ms: int
    cuda_enabled: bool


@app.get("/health")
def health() -> dict[str, str | bool]:
    return service.health()


@app.post("/v1/hero/trellis", response_model=GenerateResponse)
def generate(body: GenerateBody) -> GenerateResponse:
    try:
        result = service.generate(
            GenerateRequest(
                input_key=body.input_key,
                output_glb_key=body.output_glb_key,
                output_ply_key=body.output_ply_key,
                seed=body.seed,
                simplify=body.simplify,
                texture_size=body.texture_size,
            )
        )
    except WorkerBusyError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except (ValueError, FileNotFoundError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeUnavailableError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except GenerationError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return GenerateResponse(**result.__dict__)
