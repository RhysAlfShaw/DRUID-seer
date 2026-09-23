document.addEventListener("DOMContentLoaded", () => {

    const zoomSlider = document.getElementById('zoom_level');
    const zoomValDisplay = document.getElementById('zoom_val');
    const stretchSelect = document.getElementById('stretch_scale');
    const layerSelect = document.getElementById('layer_select');
    const canvas = document.getElementById('viewerCanvas');
    const ctx = canvas.getContext('2d');
    
    let dataMain = null;
    let dataBg = null;
    let dataRms = null;

    let currentMatrix = null;
    let currentSources = null;
    let dataMin = 0;
    let dataMax = 255;

    function setActiveMatrix() {
        if (!dataMain) return;
        
        const layer = layerSelect.value;
        if (layer === 'main') currentMatrix = dataMain;
        else if (layer === 'bg') currentMatrix = dataBg;
        else if (layer === 'rms') currentMatrix = dataRms;
        
        dataMin = Infinity;
        dataMax = -Infinity;
        for (let y = 0; y < currentMatrix.length; y++) {
            for (let x = 0; x < currentMatrix[y].length; x++) {
                const val = currentMatrix[y][x];
                if (val < dataMin) dataMin = val;
                if (val > dataMax) dataMax = val;
            }
        }
        
        updateCanvasZoom();
    }

    function updateCanvasZoom() {
        if (!currentMatrix || !currentSources) return;
        
        const zoomPercent = zoomSlider.value;
        zoomValDisplay.innerText = zoomPercent + '%';
        const zoom = zoomPercent / 100;
        const stretch = stretchSelect.value;

        const baseHeight = currentMatrix.length;
        const baseWidth = currentMatrix[0].length;

        canvas.width = baseWidth * zoom;
        canvas.height = baseHeight * zoom;

        const offscreen = document.createElement('canvas');
        offscreen.width = baseWidth;
        offscreen.height = baseHeight;
        const offCtx = offscreen.getContext('2d');
        const imgData = offCtx.createImageData(baseWidth, baseHeight);

        const range = dataMax - dataMin || 1; // Prevent division by zero

        for (let y = 0; y < baseHeight; y++) {
            for (let x = 0; x < baseWidth; x++) {
                const rawVal = currentMatrix[y][x];
                
                // 1. Normalize to 0.0 - 1.0 range
                let normVal = (rawVal - dataMin) / range;
                if (normVal < 0) normVal = 0;
                if (normVal > 1) normVal = 1;

                let stretched = normVal;
                if (stretch === 'sqrt') {
                    stretched = Math.sqrt(normVal);
                } else if (stretch === 'log') {
                    const a = 1000;
                    stretched = Math.log(1 + a * normVal) / Math.log(1 + a);
                } else if (stretch === 'asinh') {
                    const a = 10;
                    stretched = Math.asinh(a * normVal) / Math.asinh(a);
                }

                const pixelVal = Math.floor(stretched * 255);

                const idx = (y * baseWidth + x) * 4;
                imgData.data[idx] = pixelVal;
                imgData.data[idx+1] = pixelVal;
                imgData.data[idx+2] = pixelVal;
                imgData.data[idx+3] = 255;
            }
        }
        offCtx.putImageData(imgData, 0, 0);

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);

        currentSources.forEach(src => {
            if (src.contour && src.contour.length > 0) {
                ctx.strokeStyle = "#75c4e7ff"; 
                ctx.lineWidth = 1.5; 
                ctx.beginPath();
                ctx.moveTo(src.contour[0][0] * zoom, src.contour[0][1] * zoom);
                for (let i = 1; i < src.contour.length; i++) {
                    ctx.lineTo(src.contour[i][0] * zoom, src.contour[i][1] * zoom);
                }
                ctx.closePath();
                ctx.stroke();
            }

            ctx.fillStyle = "#ef4444"; 
            ctx.beginPath();
            ctx.arc(src.x * zoom, src.y * zoom, 3, 0, 2 * Math.PI);
            ctx.fill();
        });
    }

    zoomSlider.addEventListener('input', updateCanvasZoom);
    stretchSelect.addEventListener('change', updateCanvasZoom);
    layerSelect.addEventListener('change', setActiveMatrix);
    
    const fileTypeSelect = document.getElementById('file_type');
    const fileUploadContainer = document.getElementById('file_upload_container');

    fileTypeSelect.addEventListener('change', (event) => {
        if (event.target.value === 'file') {
            fileUploadContainer.style.display = 'block'; // Show it
        } else {
            fileUploadContainer.style.display = 'none';  // Hide it
            document.getElementById('fitsFile').value = ""; 
        }
    });

    const bindSlider = (id, valId) => {
        const slider = document.getElementById(id);
        const display = document.getElementById(valId);
        slider.addEventListener('input', () => {
            display.innerText = slider.value;
        });
    };

    bindSlider('det_thresh', 'det_val');
    bindSlider('an_thresh', 'an_val');
    bindSlider('area_limit', 'area_val');
    bindSlider('box_size', 'box_val');
    bindSlider('lifetime_limit_fraction','lifetime_val');
    bindSlider('smooth_sigma','smoothsigma_val');

    const form = document.getElementById('druid-form');
    const statusText = document.getElementById('status');
        
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const fileType = document.getElementById('file_type').value;
        const fileInput = document.getElementById('fitsFile').files[0];

        if (fileType === 'file' && !fileInput) {
            statusText.innerText = "Please select a local FITS file.";
            return;
        }

        statusText.innerText = "Processing image with persistent homology...";

        const formData = new FormData();
        formData.append("file_type", fileType); 
        
        if (fileType === 'file') {
            formData.append("file", fileInput); 
        }
        
        formData.append("mode", document.getElementById('mode').value);
        formData.append("det_thresh", document.getElementById('det_thresh').value);
        formData.append("an_thresh", document.getElementById('an_thresh').value);
        formData.append("area_limit", document.getElementById('area_limit').value);
        formData.append("box_size", document.getElementById('box_size').value);
        formData.append("lifetime_limit_fraction", document.getElementById('lifetime_limit_fraction').value);
        formData.append("smooth_sigma", document.getElementById('smooth_sigma').value)

        try {
            const response = await fetch('/api/run-druid', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            
            if(data.status === "success") {
                statusText.innerText = `Found ${data.sources.length} Source.`;
                
                renderImageAndContours(
                    data.preview_matrix, 
                    data.background_map, 
                    data.background_map_rms, 
                    data.sources
                );
            } else {
                statusText.innerText = "Error: " + data.message;
            }
        } catch (err) {
            statusText.innerText = "Error connecting to back-end pipeline.";
            console.error(err);
        }
    });

    function renderImageAndContours(main, bg, rms, sources) {
        dataMain = main;
        dataBg = bg;
        dataRms = rms;
        currentSources = sources;

        setActiveMatrix();
    }
});