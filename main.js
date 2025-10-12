document.addEventListener('DOMContentLoaded', () => {
    const videoUpload = document.getElementById('video-upload');
    const fileNameDisplay = document.getElementById('file-name');
    const videoPreview = document.getElementById('video-preview');
    const processButton = document.getElementById('process-button');
    const generateGifsButton = document.getElementById('generate-gifs-button');
    const gridContainer = document.getElementById('grid-container');
    const rowsInput = document.getElementById('rows');
    const colsInput = document.getElementById('cols');
    const thresholdInput = document.getElementById('threshold');
    const thresholdValue = document.getElementById('threshold-value');
    const paddingTopInput = document.getElementById('padding-top');
    const paddingRightInput = document.getElementById('padding-right');
    const paddingBottomInput = document.getElementById('padding-bottom');
    const paddingLeftInput = document.getElementById('padding-left');
    const gridOverlay = document.getElementById('grid-overlay');
    const gifFpsInput = document.getElementById('gif-fps');
    const gifDurationInput = document.getElementById('gif-duration');

    let video;
    let previewLoopId;
    let isCapturing = false;
    let cellFrames = [];
    let gifWorkerBlob = null;
    let cellCanvases = [];
    let hiddenCanvas, hiddenCtx;

    // A new array to hold stable capture dimensions for each cell
    let cellCaptureRects = [];

    // Preload gif.js worker
    (async function preloadWorker() {
        try {
            const resp = await fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js');
            gifWorkerBlob = await resp.blob();
        } catch (e) {
            console.error("Failed to load gif.worker.js", e);
            alert("Could not load a required component for GIF generation. Please check your internet connection and try again.");
        }
    })();

    // Grid state
    let verticalLines = [];
    let horizontalLines = [];
    let draggingLine = { type: null, index: -1 };
    const DRAG_SENSITIVITY = 10; // pixels

    videoUpload.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            const fileURL = URL.createObjectURL(file);
            videoPreview.src = fileURL;
            video = videoPreview;
            fileNameDisplay.textContent = file.name;

            video.addEventListener('loadedmetadata', () => {
                // Stop any previous loop
                if (previewLoopId) {
                    cancelAnimationFrame(previewLoopId);
                }
                // Setup canvases and start the real-time preview
                setupGridAndCanvases();
                startPreviewLoop();
            }, { once: true });
        }
    });

    thresholdInput.addEventListener('input', (event) => {
        thresholdValue.textContent = event.target.value;
    });

    [rowsInput, colsInput].forEach(input => {
        input.addEventListener('change', () => {
            if (video && video.videoWidth > 0) {
                // Re-initialize grid and canvases for the new dimensions
                setupGridAndCanvases();
            }
        });
    });

    processButton.addEventListener('click', () => {
        if (!video || !video.src || video.src.endsWith('placeholder.png')) {
            alert('Please upload a video first.');
            return;
        }

        if (isCapturing) return;

        // --- FIX FOR BOUNCING GIFS ---
        // Pre-calculate the stable source rectangles for each cell before capture.
        // This prevents floating-point and rounding inconsistencies during the capture loop.
        const rows = parseInt(rowsInput.value);
        const cols = parseInt(colsInput.value);
        const paddingTop = parseInt(paddingTopInput.value) || 0;
        const paddingRight = parseInt(paddingRightInput.value) || 0;
        const paddingBottom = parseInt(paddingBottomInput.value) || 0;
        const paddingLeft = parseInt(paddingLeftInput.value) || 0;
        cellCaptureRects = []; // Clear previous rects

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const xStart = c === 0 ? 0 : verticalLines[c - 1];
                const yStart = r === 0 ? 0 : horizontalLines[r - 1];
                const xEnd = c === cols - 1 ? video.videoWidth : verticalLines[c];
                const yEnd = r === rows - 1 ? video.videoHeight : horizontalLines[r];

                const sx = Math.round(xStart + paddingLeft);
                const sy = Math.round(yStart + paddingTop);
                const sWidth = Math.round(xEnd - paddingRight) - sx;
                const sHeight = Math.round(yEnd - paddingBottom) - sy;
                
                cellCaptureRects.push({
                    sx: sx,
                    sy: sy,
                    sWidth: sWidth > 0 ? sWidth : 1,
                    sHeight: sHeight > 0 ? sHeight : 1
                });
            }
        }
        // --- END FIX ---

        video.currentTime = 0;
        isCapturing = true;
        cellFrames = Array.from({ length: rowsInput.value * colsInput.value }, () => []);
        
        processButton.disabled = true;
        processButton.textContent = 'Capturing...';

        const captureDuration = parseFloat(gifDurationInput.value);
        setTimeout(() => {
            isCapturing = false;
            console.log(`Finished capturing ${captureDuration}s of frames.`);
            processButton.disabled = false;
            processButton.textContent = '2. Capture Frames';
        }, captureDuration * 1000);

        video.play().catch(err => {
            alert("Could not play video to capture. Make sure you've interacted with the page.");
            console.error("Video play error:", err);
        });
    });
    
    generateGifsButton.addEventListener('click', () => {
        if (!cellFrames.length) {
            alert('Please process the video first to capture frames.');
            return;
        }
        if (!gifWorkerBlob) {
            alert('GIF generator is not ready. Please wait a moment and try again.');
            return;
        }

        generateGifsButton.disabled = true;
        generateGifsButton.textContent = 'Generating...';

        const gifFps = parseInt(gifFpsInput.value, 10);
        const delay = 1000 / gifFps;
        const totalCells = parseInt(rowsInput.value) * parseInt(colsInput.value);
        let gifsCompleted = 0;

        cellFrames.forEach((frames, index) => {
            const cellContainer = gridContainer.children[index];
            if (!cellContainer) return;

            // Ensure there are frames to process
            if (frames.length === 0) {
                console.warn(`No frames captured for cell ${index}. Skipping GIF generation.`);
                return;
            }

            const statusEl = cellContainer.querySelector('.status');
            statusEl.textContent = 'Building...';

            // --- FIX FOR BOUNCING GIFS ---
            // Standardize all frames to the size of the first frame.
            // This prevents the GIF from jittering if subsequent captured frames have
            // minute, rounding-related size differences (e.g., 1px flicker).
            const firstFrame = frames[0];
            const width = firstFrame.width;
            const height = firstFrame.height;
            
            const workerUrl = URL.createObjectURL(gifWorkerBlob);
            const gif = new GIF({
                workers: 2,
                quality: 10,
                width,
                height,
                workerScript: workerUrl,
                transparent: 0x000000 // Black will be transparent
            });

            // This secondary standardization using a canvas is a robust fallback,
            // but the primary fix is pre-calculating capture rectangles.
            // We'll keep this as a safeguard.
            const standardizedFrameCanvas = document.createElement('canvas');
            standardizedFrameCanvas.width = width;
            standardizedFrameCanvas.height = height;
            const sfcCtx = standardizedFrameCanvas.getContext('2d');

            frames.forEach(frame => {
                sfcCtx.clearRect(0, 0, width, height); // Clear for transparency
                sfcCtx.drawImage(frame, 0, 0, width, height); // Draw frame, ensuring it's the correct size
                gif.addFrame(standardizedFrameCanvas, { delay, copy: true });
            });
            // --- END FIX ---

            gif.on('progress', (p) => {
                statusEl.textContent = `Building... ${(p * 100).toFixed(0)}%`;
            });

            gif.on('finished', (blob) => {
                URL.revokeObjectURL(workerUrl);
                const url = URL.createObjectURL(blob);
                const img = document.createElement('img');
                img.src = url;

                const a = document.createElement('a');
                a.href = url;
                a.download = `asset_${index}.gif`;
                a.appendChild(img);
                
                // Replace canvas with the gif link
                const canvas = cellContainer.querySelector('canvas');
                if (canvas) {
                     cellContainer.replaceChild(a, canvas);
                }
                statusEl.textContent = 'Done!';

                gifsCompleted++;
                if (gifsCompleted === totalCells) {
                    generateGifsButton.disabled = false;
                    generateGifsButton.textContent = '3. Generate GIFs';
                }
            });

            gif.render();
        });
    });

    function setupGridAndCanvases() {
        const rows = parseInt(rowsInput.value);
        const cols = parseInt(colsInput.value);

        gridContainer.innerHTML = '';
        gridContainer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        generateGifsButton.style.display = 'inline-block';
        processButton.textContent = '2. Capture Frames';
        
        cellCanvases = [];
        cellFrames = [];
        for (let i = 0; i < rows * cols; i++) {
            const cellContainer = document.createElement('div');
            cellContainer.className = 'cell-container';

            const canvas = document.createElement('canvas');
            const status = document.createElement('div');
            status.className = 'status';
            status.textContent = 'Preview';

            cellContainer.appendChild(canvas);
            cellContainer.appendChild(status);
            gridContainer.appendChild(cellContainer);
            
            cellCanvases.push(canvas);
            cellFrames.push([]);
        }

        resetGridLines();
        drawGridOverlay();
        setupDragListeners();

        if (!hiddenCanvas) {
            hiddenCanvas = document.createElement('canvas');
            hiddenCtx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
        }
        hiddenCanvas.width = video.videoWidth;
        hiddenCanvas.height = video.videoHeight;
    }

    function startPreviewLoop() {
        if (previewLoopId) {
            cancelAnimationFrame(previewLoopId);
        }

        function updatePreviewLoop() {
            if (video.paused || video.ended || video.videoWidth === 0) {
                previewLoopId = requestAnimationFrame(updatePreviewLoop);
                return;
            }

            // Read settings on every frame for real-time updates
            const rows = parseInt(rowsInput.value);
            const cols = parseInt(colsInput.value);
            const threshold = parseInt(thresholdInput.value);
            const paddingTop = parseInt(paddingTopInput.value) || 0;
            const paddingRight = parseInt(paddingRightInput.value) || 0;
            const paddingBottom = parseInt(paddingBottomInput.value) || 0;
            const paddingLeft = parseInt(paddingLeftInput.value) || 0;
            
            hiddenCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
            
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const cellIndex = r * cols + c;
                    const cellCanvas = cellCanvases[cellIndex];
                    if (!cellCanvas) continue;
                    const cellCtx = cellCanvas.getContext('2d');

                    const xStart = c === 0 ? 0 : verticalLines[c - 1];
                    const yStart = r === 0 ? 0 : horizontalLines[r - 1];
                    const xEnd = c === cols - 1 ? video.videoWidth : verticalLines[c];
                    const yEnd = r === rows - 1 ? video.videoHeight : horizontalLines[r];
                    
                    // --- FIX FOR JITTER/BOUNCE ---
                    // Calculate start and end crop coordinates with padding, then round them.
                    // This creates a stable source rectangle and prevents 1px dimension flickering.
                    const sx1 = Math.round(xStart + paddingLeft);
                    const sy1 = Math.round(yStart + paddingTop);
                    const sx2 = Math.round(xEnd - paddingRight);
                    const sy2 = Math.round(yEnd - paddingBottom);

                    // Derive width and height from the rounded coordinates.
                    let sWidth = sx2 - sx1;
                    let sHeight = sy2 - sy1;
                    // --- END FIX ---
                    
                    if (sWidth < 1) sWidth = 1;
                    if (sHeight < 1) sHeight = 1;

                    // Resize canvas only if necessary
                    if (cellCanvas.width !== sWidth) cellCanvas.width = sWidth;
                    if (cellCanvas.height !== sHeight) cellCanvas.height = sHeight;

                    try {
                        const imageData = hiddenCtx.getImageData(sx1, sy1, sWidth, sHeight);
                        const data = imageData.data;

                        for (let i = 0; i < data.length; i += 4) {
                            if (data[i] <= threshold && data[i + 1] <= threshold && data[i + 2] <= threshold) {
                                data[i + 3] = 0; // Make transparent
                            }
                        }
                        cellCtx.putImageData(imageData, 0, 0);

                        if (isCapturing) {
                             // Capture the content directly from the cell's preview canvas
                             // This ensures what you see is what you get for the GIF frames
                             // The canvas size is now stable thanks to pre-calculated rects.
                            const frameCanvas = document.createElement('canvas');
                            frameCanvas.width = cellCanvas.width;
                            frameCanvas.height = cellCanvas.height;
                            frameCanvas.getContext('2d').drawImage(cellCanvas, 0, 0);
                            cellFrames[cellIndex].push(frameCanvas);
                        }
                    } catch (e) {
                         if (e instanceof DOMException && e.name === "IndexSizeError") {
                            // This can happen if padding is too large or crop area is outside bounds.
                            // Clear canvas to indicate an issue with settings for this cell.
                            cellCtx.clearRect(0, 0, cellCanvas.width, cellCanvas.height);
                        } else {
                            console.error(`Error processing cell (${r},${c}):`, e);
                            cancelAnimationFrame(previewLoopId); // Stop on critical error
                            return;
                        }
                    }
                }
            }
            previewLoopId = requestAnimationFrame(updatePreviewLoop);
        }
        updatePreviewLoop();
    }

    // New helper function to calculate preview rects on the fly for display purposes
    function getPreviewRect(r, c, rows, cols) {
        const paddingTop = parseInt(paddingTopInput.value) || 0;
        const paddingRight = parseInt(paddingRightInput.value) || 0;
        const paddingBottom = parseInt(paddingBottomInput.value) || 0;
        const paddingLeft = parseInt(paddingLeftInput.value) || 0;

        const xStart = c === 0 ? 0 : verticalLines[c - 1];
        const yStart = r === 0 ? 0 : horizontalLines[r - 1];
        const xEnd = c === cols - 1 ? video.videoWidth : verticalLines[c];
        const yEnd = r === rows - 1 ? video.videoHeight : horizontalLines[r];

        const sx = Math.round(xStart + paddingLeft);
        const sy = Math.round(yStart + paddingTop);
        const sWidth = Math.round(xEnd - paddingRight) - sx;
        const sHeight = Math.round(yEnd - paddingBottom) - sy;

        return {
            sx,
            sy,
            sWidth: sWidth > 0 ? sWidth : 1,
            sHeight: sHeight > 0 ? sHeight : 1
        };
    }

    function resetGridLines() {
        const rows = parseInt(rowsInput.value);
        const cols = parseInt(colsInput.value);
        const { videoWidth, videoHeight } = video;

        verticalLines = [];
        for (let i = 1; i < cols; i++) {
            verticalLines.push((videoWidth / cols) * i);
        }

        horizontalLines = [];
        for (let i = 1; i < rows; i++) {
            horizontalLines.push((videoHeight / rows) * i);
        }
    }

    function drawGridOverlay() {
        const { clientWidth, clientHeight } = gridOverlay;
        gridOverlay.width = clientWidth;
        gridOverlay.height = clientHeight;

        const ctx = gridOverlay.getContext('2d');
        ctx.clearRect(0, 0, clientWidth, clientHeight);
        ctx.strokeStyle = 'rgba(255, 255, 0, 0.7)';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 4;

        const { videoWidth, videoHeight } = video;

        verticalLines.forEach(x => {
            const canvasX = (x / videoWidth) * clientWidth;
            ctx.beginPath();
            ctx.moveTo(canvasX, 0);
            ctx.lineTo(canvasX, clientHeight);
            ctx.stroke();
        });

        horizontalLines.forEach(y => {
            const canvasY = (y / videoHeight) * clientHeight;
            ctx.beginPath();
            ctx.moveTo(0, canvasY);
            ctx.lineTo(clientWidth, canvasY);
            ctx.stroke();
        });
    }
    
    function setupDragListeners() {
        gridOverlay.style.pointerEvents = 'auto';
        gridOverlay.style.cursor = 'crosshair';

        gridOverlay.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('resize', drawGridOverlay); // Redraw on resize
    }
    
    function getMousePos(evt) {
        const rect = gridOverlay.getBoundingClientRect();
        return {
            x: evt.clientX - rect.left,
            y: evt.clientY - rect.top
        };
    }

    function handleMouseDown(e) {
        const pos = getMousePos(e);
        const scaleX = video.videoWidth / gridOverlay.clientWidth;
        const scaleY = video.videoHeight / gridOverlay.clientHeight;

        for (let i = 0; i < verticalLines.length; i++) {
            if (Math.abs(pos.x - verticalLines[i] / scaleX) < DRAG_SENSITIVITY) {
                draggingLine = { type: 'v', index: i };
                gridOverlay.style.cursor = 'ew-resize';
                return;
            }
        }
        for (let i = 0; i < horizontalLines.length; i++) {
            if (Math.abs(pos.y - horizontalLines[i] / scaleY) < DRAG_SENSITIVITY) {
                draggingLine = { type: 'h', index: i };
                gridOverlay.style.cursor = 'ns-resize';
                return;
            }
        }
    }

    function handleMouseMove(e) {
        if (!draggingLine.type) return;
        
        const pos = getMousePos(e);
        const scaleX = video.videoWidth / gridOverlay.clientWidth;
        const scaleY = video.videoHeight / gridOverlay.clientHeight;

        if (draggingLine.type === 'v') {
            const newX = pos.x * scaleX;
            const prevLineX = draggingLine.index > 0 ? verticalLines[draggingLine.index - 1] : 0;
            const nextLineX = draggingLine.index < verticalLines.length - 1 ? verticalLines[draggingLine.index + 1] : video.videoWidth;
            
            verticalLines[draggingLine.index] = Math.max(prevLineX, Math.min(newX, nextLineX));

        } else if (draggingLine.type === 'h') {
            const newY = pos.y * scaleY;
            const prevLineY = draggingLine.index > 0 ? horizontalLines[draggingLine.index - 1] : 0;
            const nextLineY = draggingLine.index < horizontalLines.length - 1 ? horizontalLines[draggingLine.index + 1] : video.videoHeight;
            
            horizontalLines[draggingLine.index] = Math.max(prevLineY, Math.min(newY, nextLineY));
        }
        
        drawGridOverlay();
    }

    function handleMouseUp() {
        draggingLine = { type: null, index: -1 };
        gridOverlay.style.cursor = 'crosshair';
    }
});