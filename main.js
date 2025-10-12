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
    let animationFrameId;
    let isCapturing = false;
    let cellFrames = [];
    let gifWorkerBlob = null;

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
        }
    });

    thresholdInput.addEventListener('input', (event) => {
        thresholdValue.textContent = event.target.value;
    });

    [rowsInput, colsInput].forEach(input => {
        input.addEventListener('change', () => {
            if (video && video.videoWidth > 0) {
                resetGridLines();
                drawGridOverlay();
            }
        });
    });

    processButton.addEventListener('click', () => {
        if (!video || !video.src || video.src.endsWith('placeholder.png')) {
            alert('Please upload a video first.');
            return;
        }

        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        
        video.currentTime = 0;
        isCapturing = true;
        cellFrames = [];

        video.play().then(() => {
            setupGridAndProcess();
        }).catch(err => {
            alert("Could not play video. Make sure you've interacted with the page.");
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

            const statusEl = cellContainer.querySelector('.status');
            statusEl.textContent = 'Building...';

            const width = frames[0]?.width || 1;
            const height = frames[0]?.height || 1;
            
            const workerUrl = URL.createObjectURL(gifWorkerBlob);
            const gif = new GIF({
                workers: 2,
                quality: 10,
                width,
                height,
                workerScript: workerUrl,
                transparent: 0x000000 // Black will be transparent
            });

            frames.forEach(frame => {
                gif.addFrame(frame, { delay, copy: true });
            });

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

    function setupGridAndProcess() {
        if (video.videoWidth === 0) {
            video.addEventListener('loadedmetadata', () => setupGridAndProcess(), { once: true });
            return;
        }

        const rows = parseInt(rowsInput.value);
        const cols = parseInt(colsInput.value);

        gridContainer.innerHTML = '';
        gridContainer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        generateGifsButton.style.display = 'inline-block';
        
        const cellCanvases = [];
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

        const hiddenCanvas = document.createElement('canvas');
        hiddenCanvas.width = video.videoWidth;
        hiddenCanvas.height = video.videoHeight;
        const hiddenCtx = hiddenCanvas.getContext('2d', { willReadFrequently: true });

        function processFrame() {
            if (video.paused || video.ended) {
                animationFrameId = requestAnimationFrame(processFrame);
                return;
            }

            hiddenCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
            
            const captureDuration = parseFloat(gifDurationInput.value);
            if (video.currentTime >= captureDuration && isCapturing) {
                isCapturing = false;
                console.log(`Finished capturing ${captureDuration}s of frames.`);
            }

            const threshold = parseInt(thresholdInput.value);
            const paddingTop = parseInt(paddingTopInput.value) || 0;
            const paddingRight = parseInt(paddingRightInput.value) || 0;
            const paddingBottom = parseInt(paddingBottomInput.value) || 0;
            const paddingLeft = parseInt(paddingLeftInput.value) || 0;

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const cellIndex = r * cols + c;
                    const cellCanvas = cellCanvases[cellIndex];
                    const cellCtx = cellCanvas.getContext('2d');

                    const xStart = c === 0 ? 0 : verticalLines[c - 1];
                    const yStart = r === 0 ? 0 : horizontalLines[r - 1];
                    const xEnd = c === cols - 1 ? video.videoWidth : verticalLines[c];
                    const yEnd = r === rows - 1 ? video.videoHeight : horizontalLines[r];

                    let sx = xStart + paddingLeft;
                    let sy = yStart + paddingTop;
                    let sWidth = (xEnd - xStart) - (paddingLeft + paddingRight);
                    let sHeight = (yEnd - yStart) - (paddingTop + paddingBottom);
                    
                    if (sWidth < 0) sWidth = 0;
                    if (sHeight < 0) sHeight = 0;

                    if (cellCanvas.width !== sWidth) cellCanvas.width = sWidth > 0 ? sWidth : 1;
                    if (cellCanvas.height !== sHeight) cellCanvas.height = sHeight > 0 ? sHeight : 1;

                    if (sWidth > 0 && sHeight > 0) {
                        try {
                            const imageData = hiddenCtx.getImageData(sx, sy, sWidth, sHeight);
                            const data = imageData.data;

                            for (let i = 0; i < data.length; i += 4) {
                                if (data[i] <= threshold && data[i + 1] <= threshold && data[i + 2] <= threshold) {
                                    data[i + 3] = 0;
                                }
                            }
                            cellCtx.putImageData(imageData, 0, 0);

                            if(isCapturing) {
                                const frameCanvas = document.createElement('canvas');
                                frameCanvas.width = cellCanvas.width;
                                frameCanvas.height = cellCanvas.height;
                                frameCanvas.getContext('2d').drawImage(cellCanvas, 0, 0);
                                cellFrames[cellIndex].push(frameCanvas);
                            }

                        } catch (e) {
                             if (e instanceof DOMException && e.name === "IndexSizeError") {
                                // This can happen if padding is too large, just skip frame for this cell
                            } else {
                                console.error(`Error processing cell (${r},${c}):`, e);
                                cancelAnimationFrame(animationFrameId);
                                return;
                            }
                        }
                    } else {
                        cellCtx.clearRect(0, 0, cellCanvas.width, cellCanvas.height);
                    }
                }
            }
            animationFrameId = requestAnimationFrame(processFrame);
        }
        processFrame();
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