import os
import io
import numpy as np
import uvicorn
from typing import Optional
from fastapi import FastAPI, File, Form, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from DRUID import sf

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Set up static files and templates
os.makedirs("app/static", exist_ok=True)
os.makedirs("app/templates", exist_ok=True)
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

UPLOAD_DIR = "./DRUID/temp"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.get("/")
async def serve_frontend(request: Request):
    return templates.TemplateResponse(
        request=request, name="index.html", context={"request": request}
    )


@app.post("/api/run-druid")
async def run_druid(
    file_type: str = Form(...),
    file: Optional[UploadFile] = File(None),
    mode: str = Form("radio"),
    det_thresh: float = Form(5.0),
    an_thresh: float = Form(3.0),
    area_limit: int = Form(15),
    box_size: int = Form(50),
    lifetime_limit_fraction: float = Form(1.4),
    smooth_sigma: float = Form(1),
):
    file_obj_or_path = None

    if file_type == "3c98":
        file_obj_or_path = os.path.join(UPLOAD_DIR, "3C98.fits")

    elif file_type == "gal":
        file_obj_or_path = "./DRUID/example_images/gal.fits"

    elif file_type == "file":
        if not file:
            return {"status": "error", "message": "No file uploaded."}

        file_bytes = await file.read()

        file_obj_or_path = io.BytesIO(file_bytes)

    try:
        findmysource = sf(
            image=file_obj_or_path,
            mode=mode,
            area_limit=area_limit,
            smooth_sigma=smooth_sigma,
            num_threads=1,
            chunksize=20,
            max_area_limit=1e5,
            working_directory=".",
            cache=False,
        )

        findmysource.set_background(
            detection_threshold=det_thresh,
            analysis_threshold=an_thresh,
            box_size=box_size,
        )

        findmysource.phsf(lifetime_limit_fraction=lifetime_limit_fraction)

        catalog = findmysource.catalog
        image_data = findmysource.image
        background_map = findmysource.background_map
        background_map_rms = findmysource.background_rms_map
        norm_img = np.nan_to_num(image_data)
        norm_img = (
            255
            * (norm_img - np.min(norm_img))
            / (np.ptp(norm_img) if np.ptp(norm_img) > 0 else 1.0)
        ).astype(np.uint8)

        sources = []
        if catalog is not None and len(catalog) > 0:
            contours = catalog["contour"].to_list()
            island_x = catalog["Island_X"].to_list()
            island_y = catalog["Island_Y"].to_list()
            x1 = catalog["x1"].to_list()
            y1 = catalog["y1"].to_list()

            for i in range(len(catalog)):
                cx = float(y1[i] + island_x[i])
                cy = float(x1[i] + island_y[i])

                raw_contour = np.array(contours[i])
                formatted_contour = []
                if raw_contour.size > 0:
                    formatted_contour = [
                        [float(pt[0]) + 0.5, float(pt[1]) + 0.5] for pt in raw_contour
                    ]

                sources.append(
                    {
                        "id": i,
                        "x": cx,
                        "y": cy,
                        "contour": formatted_contour,
                    }
                )

    except Exception as e:
        return {"status": "error", "message": str(e)}

    return {
        "status": "success",
        "image_shape": image_data.shape,
        "sources": sources,
        "preview_matrix": norm_img.tolist(),
        "background_map": background_map.tolist(),
        "background_map_rms": background_map_rms.tolist(),
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
