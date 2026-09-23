from dataclasses import asdict

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .contracts import HeroGenerationRequest, Sam3MaskRequest, Sam3Prompt
from .probe import collect_runtime_probe
from .service import HeroGenerationService, RuntimeUnavailable, Sam3Backend


class Sam3PromptBody(BaseModel):
    type: str = Field(pattern="^(text|point|box)$")
    text: str | None = None
    x: float | None = None
    y: float | None = None
    label: str | None = None
    x_min: float | None = None
    y_min: float | None = None
    x_max: float | None = None
    y_max: float | None = None


class Trellis2GenerateBody(BaseModel):
    input_key: str
    output_key: str
    mask_key: str | None = None
    seed: int | None = Field(default=None, ge=0)


class Sam3MaskBody(BaseModel):
    input_key: str
    output_mask_key: str
    prompt: Sam3PromptBody


def create_app(
    service: HeroGenerationService | None = None,
    sam3: Sam3Backend | None = None,
) -> FastAPI:
    app = FastAPI(title="PlaceEcho TRELLIS.2 Hero Worker", version="0.1.0")

    @app.get("/v1/hero/sam3/probe")
    def sam3_probe() -> dict[str, object]:
        return asdict(collect_runtime_probe().sam3)

    @app.get("/v1/hero/trellis2/probe")
    def trellis2_probe() -> dict[str, object]:
        return asdict(collect_runtime_probe().trellis2)

    @app.post("/v1/hero/sam3/mask")
    def sam3_mask(body: Sam3MaskBody) -> dict[str, object]:
        if sam3 is None:
            raise HTTPException(
                status_code=503,
                detail="SAM 3 runtime is not provisioned; run the readiness probe first.",
            )
        try:
            prompt = Sam3Prompt(**body.prompt.model_dump())
            artifact = sam3.create_mask(
                Sam3MaskRequest(
                    input_key=body.input_key,
                    output_mask_key=body.output_mask_key,
                    prompt=prompt,
                )
            )
            return {
                "status": "completed",
                **asdict(artifact),
                "elapsed_ms": 0,
            }
        except RuntimeUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.post("/v1/hero/trellis2/generate")
    def trellis2_generate(body: Trellis2GenerateBody) -> dict[str, object]:
        if service is None:
            raise HTTPException(
                status_code=503,
                detail="TRELLIS.2 runtime is not provisioned; run the readiness probe first.",
            )
        try:
            artifact = service.generate(
                HeroGenerationRequest(
                    input_key=body.input_key,
                    output_key=body.output_key,
                    mask_key=body.mask_key,
                    seed=body.seed,
                )
            )
            return {"status": "completed", **asdict(artifact)}
        except RuntimeUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    return app


app = create_app()
