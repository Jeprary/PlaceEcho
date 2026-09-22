from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .stitching import MediaSdkStitcher, StitchError, StitchRequest

app = FastAPI(title="PlaceEcho GPU Worker", version="0.1.0")
stitcher = MediaSdkStitcher.from_environment()


class StitchImageBody(BaseModel):
    input_keys: list[str] = Field(min_length=1, max_length=9)
    output_key: str
    output_width: int = Field(default=8600, ge=1920, le=11904)
    output_height: int = Field(default=4300, ge=960, le=5952)
    stitch_type: str = Field(default="optflow", pattern="^(optflow|dynamicstitch|aistitch)$")
    enable_stitchfusion: bool = False


class StitchImageResponse(BaseModel):
    status: str
    output_key: str
    width: int
    height: int
    elapsed_ms: int
    cuda_enabled: bool


@app.get("/health")
async def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "media_sdk_ready": Path(stitcher.executable).is_file(),
        "cuda_requested": stitcher.cuda_enabled,
        "input_root": str(stitcher.input_root),
        "output_root": str(stitcher.output_root),
    }


@app.post("/v1/stitch/image", response_model=StitchImageResponse)
def stitch_image(body: StitchImageBody) -> StitchImageResponse:
    try:
        result = stitcher.stitch(
            StitchRequest(
                input_keys=body.input_keys,
                output_key=body.output_key,
                output_width=body.output_width,
                output_height=body.output_height,
                stitch_type=body.stitch_type,
                enable_stitchfusion=body.enable_stitchfusion,
            )
        )
    except (ValueError, FileNotFoundError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except StitchError as error:
        raise HTTPException(
            status_code=502,
            detail={"message": str(error), "sdk_output": error.sdk_output[-4000:]},
        ) from error

    return StitchImageResponse(**result.__dict__)
